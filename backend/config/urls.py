from django.contrib import admin
from django.urls import include, path

from apps.core.views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    # Host health check. Must return 2xx or Render keeps restarting the service.
    path("api/health/", health, name="health"),
    path("api/", include("apps.accounts.urls")),
    path("api/", include("apps.inventory.urls")),
    path("api/", include("apps.sales.urls")),
    path("api/", include("apps.expenses.urls")),
    path("api/", include("apps.trade.urls")),
]
