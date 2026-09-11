from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core.tenancy import WorkspaceViewSet
from apps.inventory.models import DamageReport, Product, StockTransaction
from apps.inventory.serializers import (
    DamageReportSerializer,
    ProductSerializer,
    StockTransactionSerializer,
)
from apps.inventory.services import (
    clear_store,
    low_stock_products,
    record_damage,
    record_stock_transaction,
)


class ProductViewSet(WorkspaceViewSet):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer
    filterset_fields = ["category", "is_glass_bottle"]
    search_fields = ["name", "category"]
    ordering_fields = ["name", "stock_quantity", "created_at"]

    def perform_create(self, serializer):
        serializer.save(workspace=self.request.workspace, created_by=self.request.user)

    @action(detail=False, methods=["get"])
    def low_stock(self, request):
        rows = low_stock_products(request.workspace).order_by("name")
        return Response(self.get_serializer(rows, many=True).data)

    def perform_destroy(self, instance):
        """Remove the item for good — from the owner's shelf and the seller's.

        Deletion used to be refused the moment an item had ever been sold, which
        left the owner unable to clear out what a staff member had typed in. The
        sale line now carries its own name and figures, so the product row goes
        and the history it appears on is left reading exactly as it did. The
        stock ledger and damage reports cascade with it, because they describe a
        shelf that no longer exists.
        """
        instance.delete()

    @action(detail=False, methods=["post"], url_path="clear")
    def clear(self, request):
        """Empty the whole store. Owner only, and irreversible.

        A POST rather than a DELETE, so `OwnerOnlyDelete` does not cover it —
        the role is checked here instead. It is a single call on purpose: a
        thousand products cleared one request at a time can half-finish, and a
        half-cleared shop is worse than either end of the operation.
        """
        if getattr(request, "workspace_role", None) != "owner":
            raise PermissionDenied("Only the workspace owner can clear the store.")

        mode = str(request.data.get("mode", "")).strip()
        if mode not in ("zero", "delete"):
            return Response(
                {"mode": "Choose 'zero' to empty the shelves or 'delete' to remove the items."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            clear_store(workspace=request.workspace, mode=mode, performed_by=request.user)
        )


class StockTransactionViewSet(WorkspaceViewSet):
    """Create-only in practice: stock history is an append-only ledger."""

    queryset = StockTransaction.objects.select_related("product").all()
    serializer_class = StockTransactionSerializer
    filterset_fields = ["type", "product"]
    ordering_fields = ["created_at"]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def perform_create(self, serializer):
        data = serializer.validated_data
        serializer.instance = record_stock_transaction(
            workspace=self.request.workspace,
            product=data["product"],
            type=data["type"],
            quantity=data["quantity"],
            notes=data.get("notes", ""),
            expiry_date=data.get("expiry_date"),
            performed_by=self.request.user,
        )


class DamageReportViewSet(WorkspaceViewSet):
    queryset = DamageReport.objects.select_related("product").all()
    serializer_class = DamageReportSerializer
    filterset_fields = ["product"]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def perform_create(self, serializer):
        data = serializer.validated_data
        serializer.instance = record_damage(
            workspace=self.request.workspace,
            product=data["product"],
            quantity=data["quantity"],
            reason=data.get("reason", ""),
            photo_url=data.get("photo_url"),
            reported_by=self.request.user,
        )
