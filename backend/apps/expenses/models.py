from django.db import models

from apps.core.models import WorkspaceScoped


class Expense(WorkspaceScoped):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    ]

    category = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    description = models.TextField(blank=True, default="")
    vendor = models.CharField(max_length=200, blank=True, default="")
    expense_date = models.DateField()
    payment_method = models.CharField(max_length=40, default="cash")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    logged_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )

    class Meta:
        db_table = "expenses"
        ordering = ["-expense_date", "-created_at"]
        indexes = [models.Index(fields=["workspace", "-expense_date"])]

    def __str__(self):
        return f"{self.category} — {self.amount}"
