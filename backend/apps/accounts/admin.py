from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.accounts.models import Membership, SubscriptionPayment, User, Workspace


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["email"]
    list_display = ["email", "full_name", "is_active", "is_staff", "created_at"]
    search_fields = ["email", "full_name"]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("full_name", "phone")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),
    )


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ["name", "plan", "subscribed", "configured", "created_at"]
    search_fields = ["name", "email"]


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ["user", "workspace", "role", "active", "created_at"]
    list_filter = ["role", "active"]


@admin.register(SubscriptionPayment)
class SubscriptionPaymentAdmin(admin.ModelAdmin):
    """Check each pending transaction ID against your MTN statement, then approve."""

    list_display = [
        "created_at",
        "workspace",
        "plan",
        "months",
        "amount",
        "payer_phone",
        "transaction_id",
        "status",
    ]
    list_filter = ["status", "plan"]
    search_fields = ["transaction_id", "payer_phone", "workspace__name"]
    readonly_fields = ["workspace", "submitted_by", "amount", "status", "reviewed_at", "created_at"]
    actions = ["approve_payments", "reject_payments"]

    # Approving a payment is what hands out a paid plan, so only a superuser
    # sees these records, and nobody can create or delete one here: a payment
    # always comes from the shop, and the trail of them is kept.
    def has_module_permission(self, request):
        return request.user.is_active and request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_active and request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_active and request.user.is_superuser

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.action(description="Approve: money received, activate the plan", permissions=["change"])
    def approve_payments(self, request, queryset):
        count = 0
        for payment in queryset.filter(status="pending"):
            payment.approve()
            count += 1
        self.message_user(request, f"Approved {count} payment(s).", messages.SUCCESS)

    @admin.action(description="Reject: money not received", permissions=["change"])
    def reject_payments(self, request, queryset):
        count = 0
        for payment in queryset.filter(status="pending"):
            payment.reject("Payment not found on the MTN statement.")
            count += 1
        self.message_user(request, f"Rejected {count} payment(s).", messages.WARNING)
