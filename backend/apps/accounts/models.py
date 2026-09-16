"""Users, workspaces and membership.

`Workspace` is both the tenant boundary and the business profile — it carries the
fields the frontend's `Business` type expects, so `GET /api/workspaces/<id>/`
answers the settings page directly.
"""

import uuid
from datetime import timedelta

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models, transaction
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra):
        if not email:
            raise ValueError("Users must have an email address")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if extra.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Email-login user. Replaces Supabase `auth.users` and the demo `users` table.

    Roles are deliberately NOT stored here — a user can be an owner of one
    workspace and a manager of another, so the role lives on Membership.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=200, blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        db_table = "users"
        ordering = ["created_at"]

    def __str__(self):
        return self.email


def default_trial_ends():
    return timezone.now() + timedelta(days=14)


class Workspace(models.Model):
    """One business. The tenant boundary for every other table."""

    PLAN_CHOICES = [
        ("starter", "Starter"),
        ("growth", "Growth"),
        ("enterprise", "Enterprise"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    tagline = models.CharField(max_length=200, blank=True, default="")
    industry = models.CharField(max_length=100, blank=True, default="")
    address = models.CharField(max_length=255, blank=True, default="")
    city = models.CharField(max_length=100, blank=True, default="")
    country = models.CharField(max_length=100, blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    tax_id = models.CharField(max_length=60, blank=True, default="")
    currency = models.CharField(max_length=8, default="UGX")
    currency_symbol = models.CharField(max_length=8, default="UGX")
    vat_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    receipt_footer = models.TextField(blank=True, default="")
    logo_url = models.TextField(null=True, blank=True)
    low_stock_alerts = models.BooleanField(default=True)
    expiry_alerts = models.BooleanField(default=True)

    # Set only by the platform owner from the console. "standard" is the normal
    # trial-then-pay path; "free" waives payment; "suspended" locks the business
    # out entirely, on the server as well as in the app.
    ACCESS_CHOICES = [
        ("standard", "Standard (trial, then pay)"),
        ("free", "Free (no subscription needed)"),
        ("suspended", "Suspended"),
    ]

    plan = models.CharField(max_length=20, choices=PLAN_CHOICES, default="starter")
    access = models.CharField(max_length=20, choices=ACCESS_CHOICES, default="standard")
    access_note = models.CharField(max_length=255, blank=True, default="")
    trial_ends = models.DateTimeField(default=default_trial_ends)
    subscribed = models.BooleanField(default=False)
    paid_until = models.DateTimeField(null=True, blank=True)
    configured = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workspaces"
        ordering = ["created_at"]

    def __str__(self):
        return self.name


class Membership(models.Model):
    """Which users belong to which workspace, and with what role."""

    ROLE_CHOICES = [("owner", "Owner"), ("manager", "Manager")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="manager")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "memberships"
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "workspace"], name="uniq_membership_user_workspace"
            )
        ]

    def __str__(self):
        return f"{self.user.email} @ {self.workspace.name} ({self.role})"


# Monthly price in shillings. Mirrors `price_ugx` on PLANS in src/lib/demo.ts;
# the server prices a payment itself so the browser can't name its own amount.
PLAN_PRICES_UGX = {"starter": 50_000, "growth": 100_000, "enterprise": 150_000}
MONTHS_CHOICES = [(1, "1 month"), (3, "3 months"), (6, "6 months"), (12, "12 months")]


class SubscriptionPayment(models.Model):
    """A shop's claim that it sent the subscription by mobile money.

    Nothing changes on the workspace until someone checks the money actually
    arrived and approves it in the admin — a transaction ID typed into a form
    proves nothing on its own.
    """

    STATUS_CHOICES = [
        ("pending", "Waiting for confirmation"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="subscription_payments"
    )
    submitted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    plan = models.CharField(max_length=20, choices=Workspace.PLAN_CHOICES)
    months = models.PositiveSmallIntegerField(choices=MONTHS_CHOICES, default=1)
    amount = models.DecimalField(max_digits=12, decimal_places=0)
    currency = models.CharField(max_length=8, default="UGX")
    network = models.CharField(max_length=20, default="mtn_momo")
    payer_phone = models.CharField(max_length=40)
    transaction_id = models.CharField(max_length=60, unique=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    note = models.CharField(max_length=255, blank=True, default="")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "subscription_payments"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.workspace.name} · {self.plan} x{self.months} · {self.transaction_id}"

    @transaction.atomic
    def approve(self):
        """Activate the plan, adding the paid months on top of any time left."""
        if self.status == "approved":
            return
        workspace = Workspace.objects.select_for_update().get(pk=self.workspace_id)
        now = timezone.now()
        start = max(now, workspace.paid_until) if workspace.paid_until else now
        workspace.plan = self.plan
        workspace.subscribed = True
        workspace.paid_until = start + timedelta(days=30 * self.months)
        workspace.save(update_fields=["plan", "subscribed", "paid_until", "updated_at"])
        self.status = "approved"
        self.reviewed_at = now
        self.save(update_fields=["status", "reviewed_at"])

    def reject(self, note=""):
        if self.status != "pending":
            return
        self.status = "rejected"
        self.note = note or self.note
        self.reviewed_at = timezone.now()
        self.save(update_fields=["status", "note", "reviewed_at"])
