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
    # The product may be deleted out from under this line: the owner is allowed
    # to remove an item from the shop for good, and a sale that already happened
    # must not stand in the way of that. The line keeps its own numbers and the
    # name below, so the history still reads correctly once the shelf is gone.
    product = models.ForeignKey(
        "inventory.Product",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_items",
    )
    # What the item was called when it was sold. Snapshotted rather than looked
    # up, so a rename never rewrites history and a deletion never erases it.
    product_name = models.CharField(max_length=200, blank=True, default="")
    # How many of `unit_name` were sold: 2 quarter-kilos, or 1.5 kg typed
    # straight in. Not the amount that leaves the shelf — that is this times
    # `unit_factor`, and the two differ whenever anything is sold in parts.
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    # What the counter called it, and how big that is in base units.
    # Snapshotted beside product_name, and for the same reason: retiring a
    # unit must not rewrite the receipts it was sold on.
    unit_name = models.CharField(max_length=40, blank=True, default="")
    unit_factor = models.DecimalField(max_digits=12, decimal_places=4, default=1)
    # Per unit sold, not per base unit: a quarter-kilo line prices the quarter.
    unit_price = models.DecimalField(max_digits=14, decimal_places=2)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "sale_items"
        ordering = ["created_at"]

    def __str__(self):
        unit = f" {self.unit_name}" if self.unit_name else ""
        return f"{self.quantity}{unit} x {self.product_name or self.product_id}"

    @property
    def base_quantity(self):
        """What actually came off the shelf."""
        return self.quantity * self.unit_factor
