from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.accounts.models import Membership, Workspace
from apps.accounts.serializers import (
    InviteMemberSerializer,
    MembershipSerializer,
    MeSerializer,
    RegisterSerializer,
    WorkspaceSerializer,
)
from apps.core.permissions import IsOwnerOrReadOnly, IsWorkspaceMember
from apps.core.tenancy import resolve_workspace


def issue_tokens(user):
    refresh = TokenObtainPairSerializer.get_token(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


class RegisterView(APIView):
    """POST /api/auth/register/ — new user + new workspace, signed in immediately."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        user, workspace = result["user"], result["workspace"]
        return Response(
            {
                **issue_tokens(user),
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "full_name": user.full_name,
                    "phone": user.phone,
                },
                "workspace": WorkspaceSerializer(workspace).data,
                "role": "owner",
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(TokenObtainPairView):
    """POST /api/auth/login/ — email + password for an access/refresh pair."""

    permission_classes = [AllowAny]


class MeView(APIView):
    """GET /api/auth/me/ — everything AuthProvider needs to hydrate."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        memberships = list(
            Membership.objects.filter(user=request.user, active=True)
            .select_related("workspace")
            .order_by("created_at")
        )
        workspace, role = resolve_workspace(request)
        payload = {
            "user": request.user,
            "memberships": memberships,
            "active_workspace": workspace,
            "role": role,
        }
        return Response(MeSerializer(payload).data)


class WorkspaceViewSet(viewsets.ModelViewSet):
    """The business profile. A user only ever sees workspaces they belong to."""

    serializer_class = WorkspaceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Workspace.objects.filter(
            memberships__user=self.request.user, memberships__active=True
        ).distinct()

    @transaction.atomic
    def perform_create(self, serializer):
        # Creating a workspace makes you its owner, same as signUpLocal.
        workspace = serializer.save()
        Membership.objects.create(
            user=self.request.user, workspace=workspace, role="owner"
        )

    def _role_in(self, workspace):
        membership = Membership.objects.filter(
            user=self.request.user, workspace=workspace, active=True
        ).first()
        return membership.role if membership else None

    def perform_update(self, serializer):
        if self._role_in(serializer.instance) != "owner":
            self.permission_denied(
                self.request, message="Only the owner can edit business settings."
            )
        serializer.save()

    def perform_destroy(self, instance):
        if self._role_in(instance) != "owner":
            self.permission_denied(
                self.request, message="Only the owner can delete a workspace."
            )
        instance.delete()


class MembershipViewSet(viewsets.ModelViewSet):
    """The staff page. Scoped to the active workspace; owners manage the roster."""

    serializer_class = MembershipSerializer
    permission_classes = [IsAuthenticated, IsWorkspaceMember, IsOwnerOrReadOnly]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def initial(self, request, *args, **kwargs):
        workspace, role = resolve_workspace(request)
        request.workspace = workspace
        request.workspace_role = role
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        return (
            Membership.objects.filter(workspace=self.request.workspace)
            .select_related("user")
            .order_by("created_at")
        )

    def create(self, request, *args, **kwargs):
        serializer = InviteMemberSerializer(
            data=request.data, context={"workspace": request.workspace}
        )
        serializer.is_valid(raise_exception=True)
        membership = serializer.save()
        return Response(
            MembershipSerializer(membership).data, status=status.HTTP_201_CREATED
        )

    def perform_destroy(self, instance):
        # Losing the last owner would orphan the workspace.
        if instance.role == "owner":
            remaining = Membership.objects.filter(
                workspace=instance.workspace, role="owner", active=True
            ).exclude(pk=instance.pk)
            if not remaining.exists():
                self.permission_denied(
                    self.request,
                    message="A workspace must keep at least one owner.",
                )
        instance.delete()

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        membership = self.get_object()
        membership.active = False
        membership.save(update_fields=["active"])
        return Response(MembershipSerializer(membership).data)
