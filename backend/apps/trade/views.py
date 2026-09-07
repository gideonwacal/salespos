"""Wholesale endpoints.

Everything inherits `WorkspaceViewSet`, so each queryset is filtered and each
create is stamped with the caller's workspace — a new endpoint is tenant-safe by
inheritance rather than by remembering to add a filter.
"""

from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.tenancy import WorkspaceViewSet
from apps.trade.models import (
    BottleMovement,
    Customer,
    Debt,
    DebtPayment,
    Purchase,
    Quotation,
    Shift,
    Supplier,
)
from apps.trade.serializers import (
    BottleMovementSerializer,
    CustomerSerializer,
    DebtPaymentSerializer,
    DebtSerializer,
    PurchaseSerializer,
    QuotationSerializer,
    ShiftSerializer,
    SupplierSerializer,
    refresh_debt_status,
)


class CustomerViewSet(WorkspaceViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    # The counter looks a debtor up by whatever it has to hand — a name, the
    # number that called, or the national ID on the form.
    search_fields = ["name", "phone", "alt_phone", "nin", "location", "residence"]
    ordering_fields = ["name", "created_at", "bottles_owed"]

    def perform_destroy(self, instance):
        """Delete a customer, but never one who is still holding something.

        Debts cascade off the customer, so deleting someone mid-balance would
        take the record of the money with them and the books would simply be
        short. Empties are the same argument in crates. Clear the account
        first; then the row can go.
        """
        owed = sum(
            debt.total_value - debt.amount_paid
            for debt in instance.debts.exclude(status="cleared")
        )
        if owed > 0:
            raise ValidationError(
                f"{instance.name} still owes {owed:.0f}. Settle or write off the balance "
                "before deleting the customer."
            )
        if instance.bottles_owed > 0:
            raise ValidationError(
                f"{instance.name} is still holding {instance.bottles_owed} empties. "
                "Record the returns before deleting the customer."
            )
        instance.delete()


class DebtViewSet(WorkspaceViewSet):
    queryset = Debt.objects.select_related("customer").all()
    serializer_class = DebtSerializer
    filterset_fields = ["status", "customer"]
    ordering_fields = ["due_date", "created_at", "total_value"]

    def get_queryset(self):
        # Overdue is a function of today's date, so a debt can lapse into it
        # without anyone touching the row. Fix that up on read.
        qs = super().get_queryset()
        stale = qs.filter(
            status__in=["pending", "partially_paid"], due_date__lt=timezone.localdate()
        )
        for debt in stale:
            refresh_debt_status(debt)
        return qs

    @action(detail=False, methods=["get"])
    def summary(self, request):
        qs = self.get_queryset()
        outstanding = Decimal(0)
        for debt in qs.exclude(status="cleared"):
            outstanding += Decimal(debt.total_value or 0) - Decimal(debt.amount_paid or 0)
        return Response(
            {
                "count": qs.count(),
                "outstanding": outstanding,
                "overdue_count": qs.filter(status="overdue").count(),
                "cleared_count": qs.filter(status="cleared").count(),
            }
        )


class DebtPaymentViewSet(WorkspaceViewSet):
    queryset = DebtPayment.objects.select_related("debt").all()
    serializer_class = DebtPaymentSerializer
    filterset_fields = ["debt"]


class BottleMovementViewSet(WorkspaceViewSet):
    queryset = BottleMovement.objects.select_related("customer").all()
    serializer_class = BottleMovementSerializer
    filterset_fields = ["customer", "direction"]

    @action(detail=False, methods=["get"])
    def summary(self, request):
        qs = self.get_queryset()
        taken = qs.filter(direction="taken").aggregate(n=Sum("quantity"))["n"] or 0
        returned = qs.filter(direction="returned").aggregate(n=Sum("quantity"))["n"] or 0
        return Response(
            {"taken": taken, "returned": returned, "outstanding": max(0, taken - returned)}
        )


class SupplierViewSet(WorkspaceViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    search_fields = ["name", "contact"]
    ordering_fields = ["name", "balance"]


class PurchaseViewSet(WorkspaceViewSet):
    queryset = Purchase.objects.select_related("supplier").all()
    serializer_class = PurchaseSerializer
    filterset_fields = ["supplier", "status"]
    ordering_fields = ["purchase_date", "total_amount"]


class QuotationViewSet(WorkspaceViewSet):
    queryset = Quotation.objects.all()
    serializer_class = QuotationSerializer
    filterset_fields = ["status"]
    search_fields = ["number", "customer_name"]
    ordering_fields = ["created_at", "valid_until", "total_amount"]


class ShiftViewSet(WorkspaceViewSet):
    queryset = Shift.objects.all()
    serializer_class = ShiftSerializer
    filterset_fields = ["status", "shift_type"]
    ordering_fields = ["started_at"]

    def perform_create(self, serializer):
        # Whoever opens the shift is the person on the counter.
        serializer.save(workspace=self.request.workspace, user=self.request.user)
