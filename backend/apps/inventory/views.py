from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.tenancy import WorkspaceViewSet
from apps.inventory.models import DamageReport, Product, StockTransaction
from apps.inventory.serializers import (
    DamageReportSerializer,
    ProductSerializer,
    StockTransactionSerializer,
)
from apps.inventory.services import low_stock_products, record_damage, record_stock_transaction


class ProductViewSet(WorkspaceViewSet):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer
    filterset_fields = ["category", "is_glass_bottle"]
    search_fields = ["name", "category"]
    ordering_fields = ["name", "stock_quantity", "created_at"]

    @action(detail=False, methods=["get"])
    def low_stock(self, request):
        rows = low_stock_products(request.workspace).order_by("name")
        return Response(self.get_serializer(rows, many=True).data)


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
