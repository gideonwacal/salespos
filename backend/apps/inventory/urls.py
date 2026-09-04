from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.inventory.views import (
    DamageReportViewSet,
    ProductViewSet,
    StockTransactionViewSet,
)

router = DefaultRouter()
router.register("products", ProductViewSet, basename="product")
router.register("stock-transactions", StockTransactionViewSet, basename="stock-transaction")
router.register("damage-reports", DamageReportViewSet, basename="damage-report")

urlpatterns = [path("", include(router.urls))]
