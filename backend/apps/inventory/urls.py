from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.inventory.views import (
    DamageReportViewSet,
    ProductViewSet,
    StockTransactionViewSet,
    VehicleFitViewSet,
)

router = DefaultRouter()
router.register("products", ProductViewSet, basename="product")
router.register("stock-transactions", StockTransactionViewSet, basename="stock-transaction")
router.register("damage-reports", DamageReportViewSet, basename="damage-report")
router.register("vehicle-fits", VehicleFitViewSet, basename="vehicle-fit")

urlpatterns = [path("", include(router.urls))]
