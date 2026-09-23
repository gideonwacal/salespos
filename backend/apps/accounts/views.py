from django.conf import settings
from django.db import transaction
from django.utils.cache import add_never_cache_headers
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.accounts.models import (
    PLAN_PRICES_UGX,
    Membership,
    SubscriptionPayment,
    User,
    Workspace,
)
from apps.accounts.serializers import (
    InviteMemberSerializer,
    MembershipSerializer,
    MeSerializer,
    RegisterSerializer,
    SubscriptionPaymentSerializer,
    WorkspaceSerializer,
)
from apps.console.models import ActivityLog
from apps.core.permissions import IsOwnerOrReadOnly, IsWorkspaceMember
from apps.core.services import erase_workspace_data
from apps.core.tenancy import ensure_workspace_open, resolve_workspace


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
    # Password guessing, against a shop or the platform owner's console.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            email = str(request.data.get("email", "")).strip().lower()
            user = User.objects.filter(email=email).first()
            if user is not None:
                ActivityLog.record(request, "signed in", user=user)
        return response


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
        ensure_workspace_open(serializer.instance)
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

    @action(detail=True, methods=["post"], url_path="erase-data")
    def erase_data(self, request, pk=None):
        """Empty the business out without touching who works in it.

        Deliberately not a DELETE on this resource: the workspace survives, and
        so do its people. Only the records the shop has entered go.
        """
        workspace = self.get_object()
        ensure_workspace_open(workspace)
        if self._role_in(workspace) != "owner":
            self.permission_denied(
                self.request, message="Only the owner can erase the workspace data."
            )
        return Response(erase_workspace_data(workspace=workspace))


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
        ensure_workspace_open(workspace)

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


def payment_channels() -> list:
    """Every way to pay this deployment has actually been given details for.

    A channel with nothing behind it is left out rather than shown as an empty
    box: an owner should never be asked to send money somewhere the server
    could not name.
    """
    channels = []

    if settings.SUBSCRIPTION_MOMO_NUMBER:
        channels.append(
            {
                "id": "mtn_momo",
                "kind": "mobile_money",
                "label": "MTN Mobile Money",
                "account": settings.SUBSCRIPTION_MOMO_NUMBER,
                "account_label": "Send to",
                "holder": settings.SUBSCRIPTION_MOMO_NAME,
                "instructions": "Dial *165#, choose Send Money, or use the MoMo app.",
                "reference_label": "Transaction ID",
                "reference_hint": "From the MTN confirmation SMS",
                "note": "",
            }
        )

    if settings.SUBSCRIPTION_AIRTEL_NUMBER:
        channels.append(
            {
                "id": "airtel_money",
                "kind": "mobile_money",
                "label": "Airtel Money",
                "account": settings.SUBSCRIPTION_AIRTEL_NUMBER,
                "account_label": "Send to",
                "holder": settings.SUBSCRIPTION_AIRTEL_NAME,
                "instructions": "Dial *185#, choose Send Money, or use the Airtel Money app.",
                "reference_label": "Transaction ID",
                "reference_hint": "From the Airtel confirmation SMS",
                "note": "",
            }
        )

    if settings.SUBSCRIPTION_BANK_ACCOUNT_NUMBER:
        where = " · ".join(
            part
            for part in (
                settings.SUBSCRIPTION_BANK_NAME,
                settings.SUBSCRIPTION_BANK_BRANCH,
            )
            if part
        )
        channels.append(
            {
                "id": "bank_card",
                "kind": "bank",
                "label": "Card or bank transfer",
                "account": settings.SUBSCRIPTION_BANK_ACCOUNT_NUMBER,
                "account_label": "Account number",
                "holder": settings.SUBSCRIPTION_BANK_ACCOUNT_NAME,
                "instructions": (
                    f"Transfer to {where} from your bank or card app."
                    if where
                    else "Transfer from your bank or card app."
                ),
                "reference_label": "Reference or receipt number",
                "reference_hint": "From your bank or card confirmation",
                # Said plainly rather than implied: there is no card gateway
                # here, and a shop that expects one would wait for nothing.
                "note": "Your card is not charged inside SalesPos — you move the money yourself.",
            }
        )

    return channels


class BillingInfoView(APIView):
    """GET /api/billing/ — where to send the subscription, and what it costs.

    The payment number is handed out only to a signed-in workspace owner, the
    one person who can pay, and is rate-limited and marked never-cache so it
    doesn't linger in shared caches or get harvested by looping over accounts.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "billing_info"

    def get(self, request):
        _, role = resolve_workspace(request)
        if role != "owner":
            self.permission_denied(request, message="Only the workspace owner can pay.")
        response = Response(
            {
                # Kept for clients built before there was more than one rail.
                "network": settings.SUBSCRIPTION_MOMO_NETWORK,
                "number": settings.SUBSCRIPTION_MOMO_NUMBER,
                "name": settings.SUBSCRIPTION_MOMO_NAME,
                "currency": "UGX",
                "prices": PLAN_PRICES_UGX,
                "channels": payment_channels(),
            }
        )
        add_never_cache_headers(response)
        return response


class SubscriptionPaymentViewSet(viewsets.ModelViewSet):
    """The owner reports a mobile money payment; approval happens in the admin."""

    serializer_class = SubscriptionPaymentSerializer
    permission_classes = [IsAuthenticated, IsWorkspaceMember, IsOwnerOrReadOnly]
    http_method_names = ["get", "post", "head", "options"]

    def initial(self, request, *args, **kwargs):
        workspace, role = resolve_workspace(request)
        request.workspace = workspace
        request.workspace_role = role
        super().initial(request, *args, **kwargs)
        ensure_workspace_open(workspace)

    def get_throttles(self):
        if self.action == "create":
            self.throttle_scope = "payment_submit"
            return [ScopedRateThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        return SubscriptionPayment.objects.filter(workspace=self.request.workspace)

    def perform_create(self, serializer):
        channels = {c["id"] for c in payment_channels()}
        if not channels:
            self.permission_denied(
                self.request, message="Subscription payments are not set up yet."
            )
        # The rail must be one this deployment actually published, or the money
        # went somewhere we never named and cannot match against.
        chosen = serializer.validated_data.get("network") or "mtn_momo"
        if chosen not in channels:
            raise ValidationError({"network": "That payment method is not available."})
        serializer.save(
            workspace=self.request.workspace,
            submitted_by=self.request.user,
            network=chosen,
        )
