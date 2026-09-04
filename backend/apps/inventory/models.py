from django.db import models

from apps.core.models import WorkspaceScoped


class Product(WorkspaceScoped):
    """Matches the `Product` type in src/lib/data.ts, field for field."""

    name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, default="General Merchandise")
    unit_buying_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    unit_selling_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    wholesale_price = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    stock_quantity = models.IntegerField(default=0)
    reorder_level = models.IntegerField(default=10)
    expiry_date = models.DateField(null=True, blank=True)

    # Industry-specific columns. Each one is optional and only surfaced by the
    # industry profile that needs it, so a pharmacy never sees bottle deposits
    # and a hardware store never sees an expiry date.
    barcode = models.CharField(max_length=64, blank=True, default="")       # supermarket
    unit_of_measure = models.CharField(max_length=32, blank=True, default="")  # hardware
    batch_number = models.CharField(max_length=64, blank=True, default="")  # pharmacy
    prescription_only = models.BooleanField(default=False)                  # pharmacy

    # Bottle deposits and tiered pricing.
    is_glass_bottle = models.BooleanField(default=False)
    bottles_per_unit = models.IntegerField(default=1)
    bulk_min_qty = models.IntegerField(default=0)
    bulk_discount_percent = models.DecimalField(
        max_digits=6, decimal_places=2, default=0
    )

    class Meta:
        db_table = "products"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["workspace", "name"]),
            models.Index(fields=["workspace", "barcode"]),
        ]

    def __str__(self):
        return self.name

    @property
    def low_stock(self) -> bool:
        return self.stock_quantity <= self.reorder_level


class StockTransaction(WorkspaceScoped):
    """Every movement of stock. The product's quantity is derived from these."""

    TYPE_CHOICES = [
        ("stock_in", "Stock in"),
        ("sale", "Sale"),
        ("adjustment", "Adjustment"),
        ("damage", "Damage"),
    ]

    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="stock_transactions"
    )
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    quantity = models.IntegerField()
    notes = models.TextField(blank=True, default="")
    expiry_date = models.DateField(null=True, blank=True)
    performed_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_transactions",
    )

    class Meta:
        db_table = "stock_transactions"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "-created_at"])]

    def __str__(self):
        return f"{self.type} {self.quantity} x {self.product_id}"


class DamageReport(WorkspaceScoped):
    """A damage write-off. Creating one also files a `damage` stock transaction."""

    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="damage_reports"
    )
    quantity = models.IntegerField(default=1)
    reason = models.TextField(blank=True, default="")
    photo_url = models.TextField(null=True, blank=True)
    reported_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="damage_reports",
    )

    class Meta:
        db_table = "damage_reports"
        ordering = ["-created_at"]
