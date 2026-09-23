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

    if settings.STRIPE_SECRET_KEY:
        channels.append(
            {
                "id": "card_stripe",
                "kind": "card",
                "label": "Card",
                # Filled in by Stripe's own page, so there is nothing to copy
                # and nothing to type back afterwards.
                "account": "",
                "account_label": "Visa, Mastercard and mobile wallets",
                "holder": "",
                "instructions": (
                    "You will be taken to Stripe's secure page to enter the card. "
                    "Your plan activates the moment the payment goes through."
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


def stripe_amount(total: int, currency: str = "UGX") -> int:
    """What Stripe wants in `unit_amount` for this total.

    Shillings have no minor unit and Stripe agrees — UGX is one of its
    zero-decimal currencies — so the amount goes as whole shillings. Sending it
    times a hundred, as one does for dollars, would charge a shop a hundredfold.
    """
    if currency.upper() in settings.STRIPE_ZERO_DECIMAL_CURRENCIES:
        return int(total)
    return int(total) * 100


class StripeCheckoutView(APIView):
    """POST /api/billing/checkout/ — start a card payment for a plan.

    Stripe hosts the card form: we create a Checkout Session and hand back its
    URL, so no card number ever reaches this server or the browser bundle.

    A pending SubscriptionPayment is written before the shop leaves, keyed by
    the session id. That row is what the webhook approves, and it is also why a
    shop that pays and then closes the tab still gets its plan — the money is
    already tied to a record here.
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
        if not settings.STRIPE_SECRET_KEY:
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

        import stripe

        stripe.api_key = settings.STRIPE_SECRET_KEY
        base = settings.APP_BASE_URL or ""

        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                success_url=f"{base}/billing?checkout=success",
                cancel_url=f"{base}/billing?checkout=cancelled",
                client_reference_id=str(workspace.id),
                customer_email=request.user.email or None,
                line_items=[
                    {
                        "quantity": 1,
                        "price_data": {
                            "currency": currency.lower(),
                            "unit_amount": stripe_amount(total, currency),
                            "product_data": {
                                "name": f"SalesPos {plan.title()} plan",
                                "description": f"{months} month{'s' if months != 1 else ''} for {workspace.name}",
                            },
                        },
                    }
                ],
                metadata={
                    "workspace_id": str(workspace.id),
                    "plan": plan,
                    "months": str(months),
                },
            )
        except Exception as error:  # noqa: BLE001 — Stripe raises a family of these
            # Whatever Stripe objected to, the shop cannot act on the traceback.
            return Response(
                {"detail": f"Could not start the card payment: {error}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        SubscriptionPayment.objects.create(
            workspace=workspace,
            submitted_by=request.user,
            plan=plan,
            months=months,
            amount=total,
            currency=currency,
            network="card_stripe",
            payer_phone=request.user.phone or workspace.phone or "card",
            transaction_id=session.id,
            status="pending",
        )

        return Response({"url": session.url, "id": session.id})


class StripeWebhookView(APIView):
    """POST /api/billing/stripe-webhook/ — Stripe telling us the money landed.

    Open to the world by necessity, so the signature is the only thing standing
    between a stranger and a free Enterprise plan. Unsigned, wrongly signed, or
    sent to a deployment with no webhook secret: all refused.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        secret = settings.STRIPE_WEBHOOK_SECRET
        if not secret:
            return Response({"detail": "Webhook not configured."}, status=400)

        import stripe

        try:
            event = stripe.Webhook.construct_event(
                payload=request.body,
                sig_header=request.META.get("HTTP_STRIPE_SIGNATURE", ""),
                secret=secret,
            )
        except Exception:  # noqa: BLE001 — bad signature or unparseable body
            return Response({"detail": "Invalid signature."}, status=400)

        if event["type"] == "checkout.session.completed":
            session = event["data"]["object"]
            # Only a paid session counts: a completed session can still be
            # awaiting an asynchronous method.
            if session.get("payment_status") == "paid":
                self._approve(session.get("id"))

        elif event["type"] == "checkout.session.async_payment_succeeded":
            self._approve(event["data"]["object"].get("id"))

        elif event["type"] in (
            "checkout.session.expired",
            "checkout.session.async_payment_failed",
        ):
            payment = SubscriptionPayment.objects.filter(
                transaction_id=event["data"]["object"].get("id"), status="pending"
            ).first()
            if payment is not None:
                payment.status = "rejected"
                payment.note = "Card payment not completed"
                payment.save(update_fields=["status", "note"])

        # Anything else is noise we did not subscribe to; 200 stops Stripe retrying.
        return Response({"received": True})

    def _approve(self, session_id):
        """Activate the plan this session paid for, once.

        approve() is a no-op on an already-approved payment, which is what
        makes a repeated webhook — Stripe retries until it gets a 2xx — safe.
        """
        if not session_id:
            return
        payment = SubscriptionPayment.objects.filter(transaction_id=session_id).first()
        if payment is not None:
            payment.approve()


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
        # A card payment is confirmed by Stripe's webhook, never by someone
        # typing a reference in: accepting one here would be accepting a claim.
        if chosen == "card_stripe":
            raise ValidationError(
                {"network": "Card payments are completed on the card page, not reported here."}
            )
        serializer.save(
            workspace=self.request.workspace,
            submitted_by=self.request.user,
            network=chosen,
        )
