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
    # Held in whole and part units of `unit_of_measure`: a shop that buys a
    # 50kg sack and sells quarters is carrying 48.25 kg after three of them,
    # and an integer here made that unsayable.
    #
    # Three decimal places, which covers a quarter, an eighth and a gram, and
    # stops short of pretending to a precision no counter scale has.
    stock_quantity = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    reorder_level = models.DecimalField(max_digits=14, decimal_places=3, default=10)
    expiry_date = models.DateField(null=True, blank=True)

    # Industry-specific columns. Each one is optional and only surfaced by the
    # industry profile that needs it, so a pharmacy never sees bottle deposits
    # and a hardware store never sees an expiry date.
    barcode = models.CharField(max_length=64, blank=True, default="")       # supermarket
    # What one of `stock_quantity` is: "kg", "litre", "bottle", "sachet",
    # "piece". The base unit everything else is measured against. Blank means
    # the item is simply counted, which is the old behaviour.
    unit_of_measure = models.CharField(max_length=32, blank=True, default="")
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


class ProductUnit(WorkspaceScoped):
    """A way this product can be sold, and what that way costs.

    A shop buys a 50kg sack of sugar and sells it as kilos, halves and
    quarters. Those are not the same price per kilo: breaking bulk earns a
    premium, and a quarter that sells for 1,200 when the kilo is 4,000 is
    normal rather than a mistake. So a unit carries its own price instead of
    being a fraction of one.

    Computing the price as `kilo price x factor` would have the till charge
    1,000 for that quarter — quietly, correctly-looking, and 200 short every
    single time.

    `factor` is how many of the product's base unit this is:

        1 kg          factor 1      of a product measured in kg
        1/2 kg        factor 0.5
        1/4 kg        factor 0.25
        50kg sack     factor 50
        Crate of 24   factor 24     of a product measured in bottles

    A product with no units behaves exactly as it always did: one implicit
    unit, factor 1, at `unit_selling_price`. Nothing has to be configured for
    a shop that only ever sells whole things.
    """

    product = models.ForeignKey(
        "inventory.Product", on_delete=models.CASCADE, related_name="units"
    )
    # What the counter calls it: "1/4 kg", "Half kg", "Crate of 24".
    name = models.CharField(max_length=40)
    factor = models.DecimalField(max_digits=12, decimal_places=4)
    price = models.DecimalField(max_digits=14, decimal_places=2)
    # Optional: what this unit goes for to a trade buyer.
    wholesale_price = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    # The one the till offers first. Enforced to a single unit per product in
    # save(), because two defaults is the same as none.
    is_default = models.BooleanField(default=False)
    # Smallest first reads best on a till: quarter, half, kilo, sack.
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "product_units"
        ordering = ["sort_order", "factor"]
        constraints = [
            models.UniqueConstraint(
                fields=["product", "name"], name="uniq_product_unit_name"
            ),
            # A unit of zero or negative size would divide the shelf by zero
            # or hand stock back on a sale.
            models.CheckConstraint(check=models.Q(factor__gt=0), name="unit_factor_positive"),
        ]
        indexes = [models.Index(fields=["workspace", "product"])]

    def __str__(self):
        return f"{self.name} ({self.factor} x {self.product_id})"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.is_default:
            # Exactly one default per product.
            ProductUnit.objects.filter(product_id=self.product_id).exclude(
                pk=self.pk
            ).update(is_default=False)


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
    # In base units, always. A delivery of two 50kg sacks is filed as 100,
    # with the sack recorded below so the ledger still reads the way the
    # delivery note did.
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    # How it was counted when it moved. Snapshotted rather than linked: a
    # shop that retires the "50kg sack" unit must not rewrite what last
    # month's deliveries said.
    unit_name = models.CharField(max_length=40, blank=True, default="")
    unit_factor = models.DecimalField(max_digits=12, decimal_places=4, default=1)
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
    quantity = models.DecimalField(max_digits=14, decimal_places=3, default=1)
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
