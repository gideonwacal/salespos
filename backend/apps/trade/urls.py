from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.trade.views import (
    BottleMovementViewSet,
    CustomerViewSet,
    DebtPaymentViewSet,
    DebtViewSet,
    PurchaseViewSet,
    QuotationViewSet,
    ShiftViewSet,
    SupplierViewSet,
)

router = DefaultRouter()
router.register("customers", CustomerViewSet, basename="customer")
router.register("debts", DebtViewSet, basename="debt")
router.register("debt-payments", DebtPaymentViewSet, basename="debt-payment")
router.register("bottle-movements", BottleMovementViewSet, basename="bottle-movement")
router.register("suppliers", SupplierViewSet, basename="supplier")
router.register("purchases", PurchaseViewSet, basename="purchase")
router.register("quotations", QuotationViewSet, basename="quotation")
router.register("shifts", ShiftViewSet, basename="shift")

urlpatterns = [path("", include(router.urls))]
