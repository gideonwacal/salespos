from django.db import models

from apps.core.models import WorkspaceScoped


class Product(WorkspaceScoped):
    """Matches the `Product` type in src/lib/data.ts, field for field."""

    name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, default="General Merchandise")
    unit_buying_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    unit_selling_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # What the supplier invoiced for one unit. Kept apart from the buying price
    # the shop values stock at: the two are usually the same, but a delivery
    # charge or a haggled discount pulls them apart, and the owner wants to see
    # what was actually paid.
    supplier_price = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
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

    # Who put this item on the system. The owner is answerable for the stock
    # list but rarely types it in, so "who added this?" is a real question —
    # and until now the answer was nowhere.
    created_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="products_added",
    )

    # A consultation, a lab test, a bed-night or a delivery trip: charged like
    # goods but never on a shelf. Without this the counter refuses to sell one
    # the moment stock reads zero, which for a service it always does.
    is_service = models.BooleanField(default=False)

    # Spare parts. A barcode is the shop's own label; a part number is the
    # manufacturer's, and it is what a mechanic rings up asking for.
    part_number = models.CharField(max_length=80, blank=True, default="")
    brand = models.CharField(max_length=80, blank=True, default="")
    # Where it physically is. A catalogue that cannot tell you which rack is
    # a catalogue someone still has to walk the shop for.
    shelf_location = models.CharField(max_length=60, blank=True, default="")

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


class VehicleFit(WorkspaceScoped):
    """One vehicle a part fits.

    A row per fitment rather than columns on the product, because fitment is
    genuinely many-to-many: one filter fits a dozen models, and squeezing that
    into make/model fields on the part would either lose most of it or mean
    stocking the same filter a dozen times.

    Years are a range because that is how a part is listed — "Corolla 2002 to
    2008" — and both ends are optional, since plenty of parts are sold as
    fitting a model with no year qualifier at all.
    """

    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="fits"
    )
    make = models.CharField(max_length=60)
    model = models.CharField(max_length=80, blank=True, default="")
    year_from = models.PositiveSmallIntegerField(null=True, blank=True)
    year_to = models.PositiveSmallIntegerField(null=True, blank=True)
    engine = models.CharField(max_length=60, blank=True, default="")
    note = models.CharField(max_length=160, blank=True, default="")

    class Meta:
        db_table = "vehicle_fits"
        ordering = ["make", "model", "year_from"]
        indexes = [
            models.Index(fields=["workspace", "make", "model"]),
        ]

    def __str__(self):
        years = ""
        if self.year_from or self.year_to:
            years = f" {self.year_from or ''}-{self.year_to or ''}"
        return f"{self.make} {self.model}{years}".strip()

    def covers_year(self, year: int) -> bool:
        """Is this fitment valid for that model year?

        An open end means open: a part listed from 2002 with no end date fits
        everything since, which is how parts catalogues are actually written.
        """
        if self.year_from and year < self.year_from:
            return False
        if self.year_to and year > self.year_to:
            return False
        return True


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
