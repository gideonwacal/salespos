import secrets
import uuid
from decimal import Decimal

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
    MONTHS_CHOICES,
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

    if settings.FLUTTERWAVE_SECRET_KEY:
        channels.append(
            {
                "id": "flutterwave",
                "kind": "card",
                "label": "Pay now — card or mobile money",
                # Filled in on Flutterwave's page, so there is nothing to copy
                # here and nothing to type back afterwards.
                "account": "",
                "account_label": "Visa, Mastercard, MTN MoMo, Airtel Money",
                "holder": "",
                "instructions": (
                    "You will be taken to Flutterwave's secure page to pay. "
                    "Your plan turns on the moment the payment goes through."
                ),
                "reference_label": "",
                "reference_hint": "",
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


def flutterwave_request(method: str, path: str, payload: dict | None = None) -> dict:
    """Call Flutterwave with the secret key, and hand back the parsed body.

    Kept deliberately small: two endpoints are used, one to start a payment and
    one to verify it, and both answer the same {status, message, data} shape.
    """
    import requests

    response = requests.request(
        method,
        f"https://api.flutterwave.com/v3{path}",
        json=payload,
        headers={
            "Authorization": f"Bearer {settings.FLUTTERWAVE_SECRET_KEY}",
            "Content-Type": "application/json",
        },
        timeout=20,
    )
    try:
        return response.json()
    except ValueError:
        return {"status": "error", "message": f"Flutterwave replied {response.status_code}"}


def approve_flutterwave_payment(transaction_id, tx_ref=None) -> bool:
    """Verify a transaction with Flutterwave, then activate the plan it paid for.

    The callback and the webhook both land here, and neither is trusted for the
    amount: Flutterwave is asked directly what was paid, and the answer is
    checked against the row we wrote before the shop ever left. A payment that
    comes back short, in the wrong currency, or against a plan nobody started is
    refused rather than honoured.

    Safe to run twice. approve() is a no-op once approved, which is what makes
    a webhook retry — and a shop that also lands on the redirect — harmless.
    """
    if not transaction_id:
        return False

    body = flutterwave_request("GET", f"/transactions/{transaction_id}/verify")
    data = body.get("data") or {}
    if body.get("status") != "success" or data.get("status") != "successful":
        return False

    reference = data.get("tx_ref") or tx_ref
    payment = SubscriptionPayment.objects.filter(transaction_id=reference).first()
    if payment is None:
        return False
    if payment.status == "approved":
        return True

    # What Flutterwave says was actually paid, against what we asked for.
    paid = Decimal(str(data.get("amount") or 0))
    currency = str(data.get("currency") or "").upper()
    if currency != payment.currency.upper() or paid < payment.amount:
        payment.status = "rejected"
        payment.note = f"Paid {paid} {currency}, expected {payment.amount} {payment.currency}"
        payment.save(update_fields=["status", "note"])
        return False

    payment.approve()
    return True


class FlutterwaveCheckoutView(APIView):
    """POST /api/billing/checkout/ — start a card or mobile money payment.

    Flutterwave hosts the payment page, so no card number reaches this server
    or the browser bundle, and the same page takes MTN and Airtel money — which
    is the whole reason for choosing it here rather than a card-only gateway.

    The pending payment row is written before the shop leaves, keyed by our own
    reference. That row is what the webhook approves, and it is why a shop that
    pays and then closes the tab is still paid.
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
        if not settings.FLUTTERWAVE_SECRET_KEY:
            self.permission_denied(request, message="Card payments are not set up yet.")

        plan = str(request.data.get("plan", "")).strip()
        if plan not in PLAN_PRICES_UGX:
            raise ValidationError({"plan": "Choose one of the published plans."})
        try:
            months = int(request.data.get("months", 1))
        except (TypeError, ValueError):
            raise ValidationError({"months": "Choose how many months."})
        if months not in dict(MONTHS_CHOICES):
            raise ValidationError({"months": "Choose how many months."})

        # Priced here, never by the browser.
        total = PLAN_PRICES_UGX[plan] * months
        currency = "UGX"
        # Ours, not theirs: the reference we will recognise when the money
        # comes back, however it comes back.
        tx_ref = f"salespos-{uuid.uuid4().hex[:20]}"

        payment = SubscriptionPayment.objects.create(
            workspace=workspace,
            submitted_by=request.user,
            plan=plan,
            months=months,
            amount=total,
            currency=currency,
            network="flutterwave",
            payer_phone=request.user.phone or workspace.phone or "card",
            transaction_id=tx_ref,
            status="pending",
        )

        base = settings.APP_BASE_URL or ""
        body = flutterwave_request(
            "POST",
            "/payments",
            {
                "tx_ref": tx_ref,
                "amount": str(total),
                "currency": currency,
                "redirect_url": f"{base}/billing",
                "payment_options": settings.FLUTTERWAVE_PAYMENT_OPTIONS,
                "customer": {
                    "email": request.user.email,
                    "phonenumber": request.user.phone or workspace.phone or "",
                    "name": request.user.full_name or workspace.name,
                },
                "customizations": {
                    "title": "SalesPos subscription",
                    "description": (
                        f"{plan.title()} plan · {months} month"
                        f"{'s' if months != 1 else ''} for {workspace.name}"
                    ),
                },
                "meta": {
                    "workspace_id": str(workspace.id),
                    "plan": plan,
                    "months": str(months),
                },
            },
        )

        link = (body.get("data") or {}).get("link")
        if body.get("status") != "success" or not link:
            # Nothing was charged, so the row we just wrote would sit pending
            # for ever. Take it back out.
            payment.delete()
            return Response(
                {"detail": body.get("message") or "Could not start the payment."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({"url": link, "id": tx_ref})


class FlutterwaveVerifyView(APIView):
    """POST /api/billing/verify/ — the shop is back from the payment page.

    The webhook is what this really relies on, but webhooks get misconfigured
    and retried late, and a shop staring at an unchanged plan after paying will
    not wait patiently. Verifying on the way back costs one call and makes the
    common case instant. It cannot be used to fake anything: the answer comes
    from Flutterwave, not from the browser.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        workspace, role = resolve_workspace(request)
        if workspace is None or role != "owner":
            self.permission_denied(request, message="Only the workspace owner can pay.")
        if not settings.FLUTTERWAVE_SECRET_KEY:
            self.permission_denied(request, message="Card payments are not set up yet.")

        transaction_id = str(request.data.get("transaction_id", "")).strip()
        tx_ref = str(request.data.get("tx_ref", "")).strip()
        if not transaction_id:
            raise ValidationError({"transaction_id": "Nothing to verify."})

        # Only ever for this workspace's own reference.
        if tx_ref and not SubscriptionPayment.objects.filter(
            transaction_id=tx_ref, workspace=workspace
        ).exists():
            raise ValidationError({"tx_ref": "That payment does not belong to this business."})

        approved = approve_flutterwave_payment(transaction_id, tx_ref)
        return Response({"approved": approved})


class FlutterwaveWebhookView(APIView):
    """POST /api/billing/flutterwave-webhook/ — Flutterwave saying money landed.

    Open to the world by necessity, so the shared hash is the only thing
    standing between a stranger and a free Enterprise plan. A missing or wrong
    hash is refused, and so is every event on a deployment that never set one.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        expected = settings.FLUTTERWAVE_SECRET_HASH
        if not expected:
            return Response({"detail": "Webhook not configured."}, status=400)

        # Flutterwave sends the hash verbatim; compare in constant time so the
        # endpoint cannot be used to guess it one character at a time.
        sent = request.META.get("HTTP_VERIF_HASH", "")
        if not sent or not secrets.compare_digest(str(sent), expected):
            return Response({"detail": "Invalid signature."}, status=400)

        payload = request.data if isinstance(request.data, dict) else {}
        data = payload.get("data") or {}
        if str(data.get("status", "")).lower() == "successful":
            approve_flutterwave_payment(data.get("id"), data.get("tx_ref"))

        # Anything else is noise; 200 stops Flutterwave retrying it for ever.
        return Response({"received": True})


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
        # An online payment is confirmed by the gateway, never by someone
        # typing a reference in: accepting one here would be accepting a claim.
        if chosen == "flutterwave":
            raise ValidationError(
                {"network": "Online payments are completed on the payment page, not reported here."}
            )
        serializer.save(
            workspace=self.request.workspace,
            submitted_by=self.request.user,
            network=chosen,
        )
