from django.contrib import admin

from apps.sales.models import Sale, SaleItem


class SaleItemInline(admin.TabularInline):
    model = SaleItem
    extra = 0


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ["id", "sale_type", "total_amount", "payment_method", "cashier", "created_at"]
    list_filter = ["sale_type", "payment_method", "workspace"]
    inlines = [SaleItemInline]
