from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.clinical.models import Patient, Prescription, Visit
from apps.clinical.serializers import (
    PatientSerializer,
    PrescriptionSerializer,
    VisitSerializer,
)
from apps.core.tenancy import WorkspaceViewSet
from apps.inventory.models import StockTransaction
from apps.inventory.services import apply_stock_delta


class PatientViewSet(WorkspaceViewSet):
    queryset = Patient.objects.all()
    serializer_class = PatientSerializer
    search_fields = ["full_name", "patient_number", "phone", "nin", "village"]
    ordering_fields = ["full_name", "created_at", "patient_number"]


class VisitViewSet(WorkspaceViewSet):
    """A patient's attendance, from the queue to the closed record."""

    queryset = Visit.objects.select_related("patient").prefetch_related("prescriptions")
    serializer_class = VisitSerializer
    filterset_fields = ["status", "patient"]
    search_fields = ["patient__full_name", "patient__patient_number", "diagnosis"]
    ordering_fields = ["created_at", "status"]

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """Finish the visit.

        Refused while medicine is still owed: a visit closed over an
        undispensed prescription is how somebody goes home without their
        tablets and the record says they did not.
        """
        visit = self.get_object()
        owing = [p for p in visit.prescriptions.all() if p.outstanding > 0]
        if owing and request.data.get("force") is not True:
            raise ValidationError(
                {
                    "prescriptions": (
                        f"{len(owing)} medicine(s) not yet dispensed. "
                        "Dispense them, or close with force to record that they were not."
                    )
                }
            )

        visit.status = "closed"
        visit.closed_at = timezone.now()
        visit.save(update_fields=["status", "closed_at"])
        return Response(self.get_serializer(visit).data)


class PrescriptionViewSet(WorkspaceViewSet):
    """What was ordered, and the act of handing it over."""

    queryset = Prescription.objects.select_related("visit", "patient", "product")
    serializer_class = PrescriptionSerializer
    filterset_fields = ["visit", "patient"]
    search_fields = ["medicine", "patient__full_name", "patient__patient_number"]

    def get_queryset(self):
        rows = super().get_queryset()
        # The dispensary's working list: everything still owed, oldest first.
        if str(self.request.query_params.get("outstanding", "")).lower() in ("1", "true"):
            rows = rows.filter(quantity_dispensed__lt=F("quantity_ordered")).order_by(
                "created_at"
            )
        return rows

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def dispense(self, request, pk=None):
        """Hand medicine over, and take it off the shelf in the same breath.

        The quantity dispensed is what actually left the dispensary, which is
        not always what was written: a clinician orders thirty, there are
        twenty, and the record has to be able to say so.
        """
        prescription = self.get_object()

        try:
            quantity = int(request.data.get("quantity", prescription.outstanding))
        except (TypeError, ValueError):
            raise ValidationError({"quantity": "How many are being handed over?"})

        if quantity <= 0:
            raise ValidationError({"quantity": "Dispensing nothing is not dispensing."})
        if quantity > prescription.outstanding:
            raise ValidationError(
                {"quantity": f"Only {prescription.outstanding} still owed on this order."}
            )

        product = prescription.product
        if product is not None:
            if quantity > product.stock_quantity:
                raise ValidationError(
                    {"quantity": f"Only {product.stock_quantity} of {product.name} on the shelf."}
                )
            apply_stock_delta(product.pk, request.workspace, -quantity)
            # The movement ledger has to explain itself: this stock left as
            # medicine for a named patient, not as a counter sale.
            StockTransaction.objects.create(
                workspace=request.workspace,
                product=product,
                type="sale",
                quantity=quantity,
                notes=f"Dispensed to {prescription.patient.patient_number}",
                performed_by=request.user,
            )

        prescription.quantity_dispensed += quantity
        prescription.dispensed_at = timezone.now()
        prescription.dispensed_by = request.user
        prescription.save(
            update_fields=["quantity_dispensed", "dispensed_at", "dispensed_by"]
        )
        return Response(self.get_serializer(prescription).data)
