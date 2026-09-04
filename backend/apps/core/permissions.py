"""Permission classes replacing the old Supabase RLS policies.

The RLS rules were: everyone in the workspace can read, staff can log
sales/stock/expenses, and only owners can delete or approve. Those live here now.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsWorkspaceMember(BasePermission):
    """Request must resolve to a workspace the user actually belongs to."""

    message = "You are not a member of this workspace."

    def has_permission(self, request, view):
        return getattr(request, "workspace", None) is not None


class IsOwnerOrReadOnly(BasePermission):
    """Reads for any member; writes only for the workspace owner."""

    message = "Only the workspace owner can make this change."

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return getattr(request, "workspace_role", None) == "owner"


class OwnerOnlyDelete(BasePermission):
    """Any member may create and update; only owners may delete.

    Mirrors the `owner deletes ...` RLS policies.
    """

    message = "Only the workspace owner can delete records."

    def has_permission(self, request, view):
        if request.method == "DELETE":
            return getattr(request, "workspace_role", None) == "owner"
        return True
