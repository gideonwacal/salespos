"""Users, workspaces and membership.

`Workspace` is both the tenant boundary and the business profile — it carries the
fields the frontend's `Business` type expects, so `GET /api/workspaces/<id>/`
answers the settings page directly.
"""

import uuid
from datetime import timedelta

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
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

    plan = models.CharField(max_length=20, choices=PLAN_CHOICES, default="starter")
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
