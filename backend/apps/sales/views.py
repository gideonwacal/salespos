from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.tenancy import WorkspaceViewSet
from apps.sales.models import Sale, SaleItem
from apps.sales.serializers import (
    AmendSaleSerializer,
    CheckoutSerializer,
    SaleItemSerializer,
    SaleSerializer,
)
from apps.core.timezones import business_today
from apps.sales.services import amend_sale, create_sale, sales_totals, void_sale


class SaleViewSet(WorkspaceViewSet):
    queryset = Sale.objects.prefetch_related("items__product").all()
    serializer_class = SaleSerializer
    filterset_fields = ["sale_type", "payment_method", "cashier"]
    ordering_fields = ["created_at", "total_amount"]
    # PATCH is open to any member: a cashier who mis-keys a sale must be able
    # to put it right. DELETE stays owner-only through OwnerOnlyDelete.
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def create(self, request, *args, **kwargs):
        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        sale = create_sale(
            workspace=request.workspace,
            cashier=request.user,
            items=data["items"],
            sale_type=data["sale_type"],
            payment_method=data["payment_method"],
            customer_name=data.get("customer_name", ""),
        )
        return Response(SaleSerializer(sale).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        sale = self.get_object()
        serializer = AmendSaleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        amend_sale(
            sale=sale,
            actor=request.user,
            items=data["items"],
            sale_type=data.get("sale_type"),
            payment_method=data.get("payment_method"),
            customer_name=data.get("customer_name"),
        )
        sale.refresh_from_db()
        return Response(SaleSerializer(sale).data)

    def perform_destroy(self, instance):
        # Owner-only, enforced by OwnerOnlyDelete on the base viewset.
        void_sale(instance)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Totals for the dashboard, computed in the database rather than the browser.

        `today` is the business's own today, not the server's. The project runs
        on UTC, so before this used the workspace timezone a shop in Kampala
        saw yesterday's takings until 3am.
        """
        sales = self.get_queryset()
        today = business_today(request.workspace)
        today_sales = sales.filter(created_at__date=today)
        return Response(
            {"today": sales_totals(today_sales), "all_time": sales_totals(sales)}
        )


class SaleItemViewSet(WorkspaceViewSet):
    """Read-only: line items are created through the checkout endpoint."""

    queryset = SaleItem.objects.select_related("product", "sale").all()
    serializer_class = SaleItemSerializer
    filterset_fields = ["sale", "product"]
    http_method_names = ["get", "head", "options"]
