"""Workspace resolution and the tenant-scoped viewset base.

The client sends `X-Workspace: <uuid>`. We only ever trust it after checking the
authenticated user has an active membership in it, so a forged header gets a 403
rather than another tenant's data.
"""

from django.conf import settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import IsWorkspaceMember, OwnerOnlyDelete

WORKSPACE_HEADER = "HTTP_X_WORKSPACE"


def resolve_workspace(request):
    """Return (workspace, role) for this request, or (None, None).

    Falls back to the user's first membership so a client that hasn't picked a
    workspace yet still works.
    """
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        return None, None

    from apps.accounts.models import Membership

    memberships = Membership.objects.filter(user=user, active=True).select_related(
        "workspace"
    )

    requested = request.META.get(WORKSPACE_HEADER) or ""
    requested = requested.strip()
    if requested:
        membership = memberships.filter(workspace_id=requested).first()
        if membership is None:
            # Do not fall back here: silently serving a different workspace than
            # the one asked for is how cross-tenant bugs get shipped.
            raise PermissionDenied("You are not a member of that workspace.")
        return membership.workspace, membership.role

    membership = memberships.order_by("created_at").first()
    if membership is None:
        return None, None
    return membership.workspace, membership.role


def ensure_workspace_open(workspace):
    """Refuse every request into a business the platform owner has suspended."""
    if workspace is not None and workspace.access == "suspended":
        raise PermissionDenied(
            "This business has been suspended. Contact SalesPos support to restore access."
        )


def ensure_email_verified(user, role):
    """Hold an owner out until they have confirmed their address.

    Owners only. A cashier never gave us an email to check — the owner created
    that login and vouched for it by doing so — and locking the counter because
    the office has not read its mail would stop the shop trading for a reason
    the cashier cannot fix.

    Accounts that predate this check are already marked verified, so nobody who
    was working yesterday is shut out this morning.
    """
    if not settings.REQUIRE_EMAIL_VERIFICATION:
        return
    if role != "owner" or user is None or not user.is_authenticated:
        return
    if getattr(user, "email_verified", True):
        return
    raise PermissionDenied(
        "Confirm your email address to finish setting up. "
        "Check your inbox, or ask for the link again from the sign-in page."
    )


def ensure_workspace_paid(workspace):
    """Refuse a business that has run out of trial without subscribing.

    The browser already redirects a locked shop to the billing page, but that
    is a courtesy, not a lock: a stale tab, a second device or anything holding
    a token would go on working. This is the lock.

    Deliberately not applied to the billing or account endpoints — a shop that
    cannot reach them could never pay, and shutting someone out of the till is
    no reason to shut them out of their own record of it.
    """
    if workspace is None:
        return
    ensure_workspace_open(workspace)
    if workspace.locked:
        raise PermissionDenied(
            "Your free trial has ended. Choose a package on the billing page to carry on."
        )


class WorkspaceViewSet(ModelViewSet):
    """Base viewset that scopes every query and every write to one workspace."""

    permission_classes = [IsWorkspaceMember, OwnerOnlyDelete]

    def initial(self, request, *args, **kwargs):
        # Runs after authentication, before permission checks, so the permission
        # classes above can read request.workspace.
        workspace, role = resolve_workspace(request)
        request.workspace = workspace
        request.workspace_role = role
        super().initial(request, *args, **kwargs)
        # Every tenant-scoped table goes through here — products, sales,
        # expenses, debtors — so these two calls are the whole lock.
        ensure_email_verified(request.user, role)
        ensure_workspace_paid(workspace)

    def get_queryset(self):
        return super().get_queryset().filter(workspace=self.request.workspace)

    def perform_create(self, serializer):
        serializer.save(workspace=self.request.workspace)
