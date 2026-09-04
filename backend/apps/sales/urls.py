from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.sales.views import SaleItemViewSet, SaleViewSet

router = DefaultRouter()
router.register("sales", SaleViewSet, basename="sale")
router.register("sale-items", SaleItemViewSet, basename="sale-item")

urlpatterns = [path("", include(router.urls))]
