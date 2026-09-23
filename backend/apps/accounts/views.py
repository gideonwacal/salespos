from django.conf import settings
from django.db import transaction
from django.utils.cache import add_never_cache_headers
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.accounts.models import (
    MONTHS_CHOICES,
    PLAN_PRICES_UGX,
    Membership,
    SubscriptionPayment,
    User,
    Workspace,
)
from apps.accounts import momo
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

    # The API channels come first: when a telco can prompt the phone directly,
    # that is the way to pay, and sending money by hand is the fallback for a
    # network whose credentials are not set.
    if momo.mtn_available():
        channels.append(
            {
                "id": "mtn_momo",
                "kind": "collect",
                "label": "MTN Mobile Money",
                "account": "",
                "account_label": "Approve on your phone",
                "holder": "",
                "instructions": (
                    "We will send a payment request to your MTN line. "
                    "Approve it with your PIN and your plan turns on straight away."
                ),
                "reference_label": "",
                "reference_hint": "",
                "note": "",
            }
        )
    elif settings.SUBSCRIPTION_MOMO_NUMBER:
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
                # {number} and {amount} are filled in by the page, which is the
                # only place that knows what this shop is paying.
                "ussd": settings.SUBSCRIPTION_MOMO_USSD,
            }
        )

    if momo.airtel_available():
        channels.append(
            {
                "id": "airtel_money",
                "kind": "collect",
                "label": "Airtel Money",
                "account": "",
                "account_label": "Approve on your phone",
                "holder": "",
                "instructions": (
                    "We will send a payment request to your Airtel line. "
                    "Approve it with your PIN and your plan turns on straight away."
                ),
                "reference_label": "",
                "reference_hint": "",
                "note": "",
            }
        )
    elif settings.SUBSCRIPTION_AIRTEL_NUMBER:
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
                "ussd": settings.SUBSCRIPTION_AIRTEL_USSD,
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
                "label": "Bank transfer",
                "account": settings.SUBSCRIPTION_BANK_ACCOUNT_NUMBER,
                "account_label": "Account number",
                "holder": settings.SUBSCRIPTION_BANK_ACCOUNT_NAME,
                "instructions": (
                    f"Transfer to {where} from your bank or card app."
                    if where
                    else "Transfer from your bank or card app."
                ),
                "reference_label": "Reference or receipt number",
                "reference_hint": "From your bank confirmation",
                "note": "A transfer can take a day to clear before your plan turns on.",
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


def _plan_and_months(request):
    """The two things a payment is for, priced by us and never by the browser."""
    plan = str(request.data.get("plan", "")).strip()
    if plan not in PLAN_PRICES_UGX:
        raise ValidationError({"plan": "Choose one of the published plans."})
    try:
        months = int(request.data.get("months", 1))
    except (TypeError, ValueError):
        raise ValidationError({"months": "Choose how many months."})
    if months not in dict(MONTHS_CHOICES):
        raise ValidationError({"months": "Choose how many months."})
    return plan, months


class MobileMoneyChargeView(APIView):
    """POST /api/billing/charge/ — prompt a phone for the subscription.

    The shop gives a number; the telco puts a PIN request on that handset. No
    card, no redirect, no aggregator holding the money on the way through.

    The pending row is written before the telco is called, keyed by the same
    reference the request carries, so a prompt that is approved after the shop
    has closed the browser still lands against something.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "payment_submit"

    def post(self, request):
        workspace, role = resolve_workspace(request)
        request.workspace = workspace
        request.workspace_role = role
        # Who they are first, then whether the business may transact: a user
        # with no workspace at all must not reach the suspension check.
        if workspace is None or role != "owner":
            self.permission_denied(request, message="Only the workspace owner can pay.")
        ensure_workspace_open(workspace)

        network = str(request.data.get("network", "")).strip()
        if network not in {c["id"] for c in payment_channels() if c["kind"] == "collect"}:
            raise ValidationError({"network": "That network is not available here."})

        phone = str(request.data.get("phone", "")).strip()
        if sum(ch.isdigit() for ch in phone) < 9:
            raise ValidationError({"phone": "Enter the phone number to charge."})

        plan, months = _plan_and_months(request)
        total = PLAN_PRICES_UGX[plan] * months
        currency = "UGX"
        reference = momo.new_reference()

        payment = SubscriptionPayment.objects.create(
            workspace=workspace,
            submitted_by=request.user,
            plan=plan,
            months=months,
            amount=total,
            currency=currency,
            network=network,
            payer_phone=phone,
            transaction_id=reference,
            status="pending",
        )

        try:
            momo.start_collection(
                network=network,
                reference=reference,
                phone=phone,
                amount=total,
                currency=currency,
                note=f"SalesPos {plan.title()} plan, {months} month{'s' if months != 1 else ''}",
            )
        except momo.CollectionError as error:
            # Nothing was asked for, so the row would sit pending for ever.
            payment.delete()
            return Response({"detail": str(error)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {
                "reference": reference,
                "status": "pending",
                "amount": total,
                "currency": currency,
                "phone": phone,
            }
        )


class MobileMoneyStatusView(APIView):
    """GET /api/billing/charge/<reference>/ — has the PIN been entered yet?

    Polled by the billing page while the prompt is on the shop's phone. The
    telco is the only thing asked; the browser cannot talk this into anything.
    Approving is idempotent, so polling after it has already succeeded simply
    returns the same answer.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, reference):
        workspace, role = resolve_workspace(request)
        if workspace is None or role != "owner":
            self.permission_denied(request, message="Only the workspace owner can pay.")

        payment = SubscriptionPayment.objects.filter(
            transaction_id=reference, workspace=workspace
        ).first()
        if payment is None:
            raise NotFound("No payment with that reference.")

        if payment.status == "approved":
            return Response({"status": "successful"})
        if payment.status == "rejected":
            return Response({"status": "failed", "reason": payment.note})

        try:
            state, body = momo.collection_status(
                network=payment.network, reference=reference
            )
        except momo.CollectionError as error:
            # Unreachable is not the same as unpaid: leave it pending and let
            # the shop try again in a moment.
            return Response({"status": "pending", "reason": str(error)})

        if state == momo.SUCCESSFUL:
            payment.approve()
            return Response({"status": "successful"})

        if state == momo.FAILED:
            reason = str(body.get("reason") or "") if isinstance(body, dict) else ""
            payment.status = "rejected"
            payment.note = reason[:255] or "The payment was not completed"
            payment.save(update_fields=["status", "note"])
            return Response({"status": "failed", "reason": payment.note})

        return Response({"status": "pending"})


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
        # A network we can charge directly is confirmed by the telco, never by
        # someone typing a reference in: accepting one here would be accepting
        # a claim instead of a payment.
        if any(c["id"] == chosen and c["kind"] == "collect" for c in payment_channels()):
            raise ValidationError(
                {"network": "This payment is approved on your phone, not reported here."}
            )
        serializer.save(
            workspace=self.request.workspace,
            submitted_by=self.request.user,
            network=chosen,
        )
