"""Wholesale trading: credit customers, debts, bottle deposits, quotations,
suppliers, purchases and counter shifts.

These are the modules the Growth and Enterprise plans bill for. They ran on
localStorage until now, which meant a paying shop lost its whole debtor book
when the browser was cleared.

Every model is `WorkspaceScoped`, so a wholesaler's debtors are invisible to a
pharmacy on the same install.
"""

from django.db import models

from apps.core.models import WorkspaceScoped


class Customer(WorkspaceScoped):
    """Someone who buys on credit, and whose empties we track."""

    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=40, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    # Denormalised running total of empties held by the customer. Kept in step
    # by the bottle-movement service so the debtors page needs one query.
    bottles_owed = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers"
        ordering = ["name"]
        indexes = [models.Index(fields=["workspace", "name"])]

    def __str__(self):
        return self.name


class Debt(WorkspaceScoped):
    """One credit sale owed by a customer."""

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("partially_paid", "Partially paid"),
        ("overdue", "Overdue"),
        ("cleared", "Cleared"),
    ]

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="debts")
    sale = models.ForeignKey(
        "sales.Sale", on_delete=models.SET_NULL, null=True, blank=True, related_name="debts"
    )
    items_summary = models.TextField(blank=True, default="")
    total_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    issue_date = models.DateField()
    due_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "debts"
        ordering = ["due_date"]
        indexes = [models.Index(fields=["workspace", "status"])]

    def __str__(self):
        return f"{self.customer_id} owes {self.balance}"

    @property
    def balance(self):
        return self.total_value - self.amount_paid


class DebtPayment(WorkspaceScoped):
    """A payment against a debt. Recording one re-derives the debt's status."""

    debt = models.ForeignKey(Debt, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    payment_method = models.CharField(max_length=40, default="cash")
    note = models.TextField(blank=True, default="")

    class Meta:
        db_table = "debt_payments"
        ordering = ["-created_at"]


class BottleMovement(WorkspaceScoped):
    """Empties going out with a customer and coming back.

    Wholesale-specific: crates and glass bottles carry a deposit, so the shop
    needs to know who is holding how many.
    """

    DIRECTION_CHOICES = [("taken", "Taken"), ("returned", "Returned")]

    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, related_name="bottle_movements"
    )
    sale = models.ForeignKey(
        "sales.Sale",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bottle_movements",
    )
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES)
    quantity = models.IntegerField()
    note = models.TextField(blank=True, default="")

    class Meta:
        db_table = "bottle_movements"
        ordering = ["-created_at"]


class Supplier(WorkspaceScoped):
    """Who the shop buys from."""

    name = models.CharField(max_length=200)
    contact = models.CharField(max_length=120, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.CharField(max_length=255, blank=True, default="")
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        db_table = "suppliers"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Purchase(WorkspaceScoped):
    """A delivery from a supplier and what is still owed on it."""

    supplier = models.ForeignKey(
        Supplier, on_delete=models.CASCADE, related_name="purchases"
    )
    reference = models.CharField(max_length=80, blank=True, default="")
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=20, default="pending")
    purchase_date = models.DateField()

    class Meta:
        db_table = "purchases"
        ordering = ["-purchase_date"]


class Quotation(WorkspaceScoped):
    """A proforma the customer can accept, then be invoiced against."""

    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("sent", "Sent"),
        ("accepted", "Accepted"),
        ("expired", "Expired"),
        ("invoiced", "Invoiced"),
    ]

    number = models.CharField(max_length=40)
    customer_name = models.CharField(max_length=200)
    customer_phone = models.CharField(max_length=40, blank=True, default="")
    items_summary = models.TextField(blank=True, default="")
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    valid_until = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    notes = models.TextField(blank=True, default="")

    class Meta:
        db_table = "quotations"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "number"], name="uniq_quotation_number_per_workspace"
            )
        ]


class Shift(WorkspaceScoped):
    """A counter session, opened with a float and closed against counted cash."""

    TYPE_CHOICES = [
        ("morning", "Morning"),
        ("afternoon", "Afternoon"),
        ("evening", "Evening"),
        ("night", "Night"),
        ("full_day", "Full day"),
    ]

    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="shifts",
    )
    staff_name = models.CharField(max_length=200, blank=True, default="")
    shift_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="full_day")
    opening_float = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    closing_cash = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    expected_cash = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(
        max_length=10, choices=[("open", "Open"), ("closed", "Closed")], default="open"
    )
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "shifts"
        ordering = ["-started_at"]
