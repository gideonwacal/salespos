from django.contrib import admin

from apps.expenses.models import Expense


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ["category", "amount", "vendor", "status", "expense_date", "workspace"]
    list_filter = ["status", "category", "workspace"]
    search_fields = ["category", "vendor"]
