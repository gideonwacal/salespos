"""Workspace resolution and the tenant-scoped viewset base.

The client sends `X-Workspace: <uuid>`. We only ever trust it after checking the
authenticated user has an active membership in it, so a forged header gets a 403
rather than another tenant's data.
"""

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

    def get_queryset(self):
        return super().get_queryset().filter(workspace=self.request.workspace)

    def perform_create(self, serializer):
        serializer.save(workspace=self.request.workspace)
