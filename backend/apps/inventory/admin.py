from django.contrib import admin

from apps.inventory.models import DamageReport, Product, StockTransaction


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "stock_quantity", "unit_selling_price", "workspace"]
    list_filter = ["category", "workspace"]
    search_fields = ["name"]


@admin.register(StockTransaction)
class StockTransactionAdmin(admin.ModelAdmin):
    list_display = ["product", "type", "quantity", "performed_by", "created_at"]
    list_filter = ["type", "workspace"]


@admin.register(DamageReport)
class DamageReportAdmin(admin.ModelAdmin):
    list_display = ["product", "quantity", "reported_by", "created_at"]
    list_filter = ["workspace"]
