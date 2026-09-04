from django.contrib import admin

from apps.trade.models import (
    BottleMovement,
    Customer,
    Debt,
    DebtPayment,
    Purchase,
    Quotation,
    Shift,
    Supplier,
)

for model in (
    Customer, Debt, DebtPayment, BottleMovement,
    Supplier, Purchase, Quotation, Shift,
):
    admin.site.register(model)
