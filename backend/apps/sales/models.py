from django.db import models

from apps.core.models import WorkspaceScoped


class Sale(WorkspaceScoped):
    SALE_TYPES = [("retail", "Retail"), ("wholesale", "Wholesale")]

    sale_type = models.CharField(max_length=20, choices=SALE_TYPES, default="retail")
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=40, default="cash")
    customer_name = models.CharField(max_length=200, blank=True, default="")
    cashier = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales",
    )

    class Meta:
        db_table = "sales"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "-created_at"])]

    def __str__(self):
        return f"Sale {self.id} — {self.total_amount}"

    @property
    def profit(self):
        return self.total_amount - self.total_cost


class SaleItem(WorkspaceScoped):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(
        "inventory.Product", on_delete=models.PROTECT, related_name="sale_items"
    )
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=14, decimal_places=2)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "sale_items"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.quantity} x {self.product_id}"
