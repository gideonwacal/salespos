"""Two ways in, one agent behind them.

`/api/ai/chat/` is the generic endpoint: authenticated like every other API
call, workspace from the usual header. The website, the dashboard and a future
mobile app all use it as-is.

`/api/webhooks/whatsapp/` is the WhatsApp adapter. Its only extra job is
turning a phone number into the same AgentContext the chat endpoint gets from a
JWT. Everything after that is identical code.
"""

from __future__ import annotations

import json
import logging
import re

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ai.agent import AgentService, ConversationService
from apps.ai import onboarding
from apps.ai.context import build_context
from apps.ai.models import (
    Conversation,
    InboundMessage,
    Message,
    WhatsAppIdentity,
    normalise_phone,
)
from apps.ai.ratelimit import RateLimited, check as check_rate
from apps.ai.serializers import (
    ChatRequestSerializer,
    ConversationSerializer,
    WhatsAppIdentitySerializer,
)
from apps.ai.whatsapp import get_whatsapp_provider
from apps.console.models import ActivityLog
from apps.core.tenancy import WorkspaceViewSet, resolve_workspace

log = logging.getLogger(__name__)

UNKNOWN_NUMBER = (
    "Hello! This number isn't linked to a SalesPos business yet.\n\n"
    "Sign in to SalesPos, open *Settings → WhatsApp*, and add this number. "
    "You'll get a 6-digit code to send here."
)

NOT_TEXT = "I can only read text messages at the moment — please type your question."


def code_present(text: str, code: str) -> bool:
    """Is this pairing code in this message?

    Bounded on both sides so a code is not matched inside a longer run of
    digits — "1481920" is not 481920, and treating it as one would verify a
    handset on a number that was never sent.
    """
    if not code:
        return False
    return re.search(rf"(?<!\d){re.escape(code)}(?!\d)", text or "") is not None


class ChatView(APIView):
    """POST /api/ai/chat/ — the same agent the WhatsApp webhook uses."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChatRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        workspace, _role = resolve_workspace(request)
        # build_context applies the suspension, verification and billing gates,
        # so the assistant cannot answer for a business the app has locked.
        ctx = build_context(user=request.user, workspace=workspace, channel="web")

        try:
            check_rate(ctx)
        except RateLimited as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        external_id = ""
        requested = serializer.validated_data.get("conversation_id")
        if requested:
            # Only a thread belonging to this workspace and this user; a
            # conversation id from elsewhere must not resume someone else's.
            owned = Conversation.objects.filter(
                id=requested, workspace=ctx.workspace, user=ctx.user, channel="web"
            ).first()
            if owned is None:
                raise PermissionDenied("That conversation is not yours.")
            external_id = owned.external_id

        reply = AgentService().answer(
            ctx=ctx, text=serializer.validated_data["message"], external_id=external_id
        )
        conversation = ConversationService.get_or_start(ctx, external_id=external_id)
        return Response({"reply": reply, "conversation_id": str(conversation.id)})


class ConversationViewSet(WorkspaceViewSet):
    """Read-only history, so the web chat can redraw a thread after a reload."""

    queryset = Conversation.objects.prefetch_related("messages").all()
    serializer_class = ConversationSerializer
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        # Workspace-scoped by the base class; narrowed again to this person,
        # because one member of staff has no business reading another's thread.
        qs = super().get_queryset()
        if self.request.workspace_role == "owner":
            return qs
        return qs.filter(user=self.request.user)


class WhatsAppIdentityViewSet(WorkspaceViewSet):
    """Linking a handset to an account, from inside the dashboard.

    A number is never matched automatically against `User.phone`: that field is
    typed in by hand and never checked, so trusting it would let anyone claim
    another person's WhatsApp by editing their own profile.
    """

    queryset = WhatsAppIdentity.objects.all()
    serializer_class = WhatsAppIdentitySerializer
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.workspace_role == "owner":
            return qs
        return qs.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        phone = normalise_phone(request.data.get("phone", ""))
        if len(phone) < 9:
            return Response(
                {"phone": "Enter the WhatsApp number with its country code."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing = WhatsAppIdentity.objects.filter(
            phone=phone, workspace=request.workspace
        ).first()
        if existing and existing.verified and existing.user_id != request.user.id:
            # Somebody else already proved they hold this handset.
            return Response(
                {"phone": "That number is already linked to another account here."},
                status=status.HTTP_409_CONFLICT,
            )

        identity = existing or WhatsAppIdentity(
            workspace=request.workspace, user=request.user, phone=phone
        )
        identity.user = request.user
        identity.pairing_code = WhatsAppIdentity.new_code()
        identity.verified_at = None
        identity.active = True
        identity.save()

        ActivityLog.record(
            request, "started linking a WhatsApp number", user=request.user,
            workspace=request.workspace, target=phone[-4:],
        )
        return Response(
            {
                **WhatsAppIdentitySerializer(identity).data,
                "pairing_code": identity.pairing_code,
                "instructions": (
                    f"Send the code {identity.pairing_code} as a WhatsApp message "
                    "to the SalesPos number to finish linking."
                ),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        identity = self.get_object()
        identity.active = False
        identity.save(update_fields=["active"])
        ActivityLog.record(
            request, "unlinked a WhatsApp number", user=request.user,
            workspace=request.workspace, target=identity.phone[-4:],
        )
        return Response(self.get_serializer(identity).data)


class WhatsAppWebhookView(APIView):
    """GET verifies the webhook with Meta; POST receives messages.

    Unauthenticated by necessity — Meta has no JWT. Authenticity comes from the
    signature instead, and identity from the verified link table.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        from django.conf import settings
        from django.http import HttpResponse

        mode = request.query_params.get("hub.mode")
        token = request.query_params.get("hub.verify_token")
        challenge = request.query_params.get("hub.challenge", "")
        if mode == "subscribe" and token and token == settings.WHATSAPP_VERIFY_TOKEN:
            # Meta wants the challenge echoed as bare text, not JSON.
            return HttpResponse(challenge, content_type="text/plain")
        return HttpResponse("verification failed", status=403, content_type="text/plain")

    def post(self, request):
        provider = get_whatsapp_provider()

        if not provider.verify_signature(
            request.body, request.META.get("HTTP_X_HUB_SIGNATURE_256", "")
        ):
            log.warning("Rejected a WhatsApp webhook with a bad signature")
            return Response({"detail": "bad signature"}, status=status.HTTP_403_FORBIDDEN)

        try:
            payload = json.loads(request.body or b"{}")
        except json.JSONDecodeError:
            return Response({"detail": "bad payload"}, status=status.HTTP_400_BAD_REQUEST)

        for message in provider.parse(payload):
            try:
                self._handle(provider, message)
            except Exception:  # noqa: BLE001
                # Always 200 to Meta regardless: a 500 makes it redeliver the
                # same message for hours, which would multiply every error.
                log.exception("Failed handling a WhatsApp message")

        return Response({"received": True})

    def _handle(self, provider, message: dict) -> None:
        sender = normalise_phone(message.get("from", ""))
        if not sender:
            return

        # Claimed before any work is done. Meta redelivers a webhook it did
        # not get a prompt 200 for, and this handler answers synchronously,
        # so without this a slow turn is answered twice.
        if not InboundMessage.claim(message.get("message_id", "")):
            log.info("Skipped a WhatsApp message Meta sent twice")
            return

        identity = (
            WhatsAppIdentity.objects.select_related("workspace", "user")
            .filter(phone=sender, active=True)
            .order_by("-verified_at", "-created_at")
            .first()
        )
        if identity is None:
            provider.send(sender, UNKNOWN_NUMBER)
            return

        # An unverified link is finished by sending the code from the handset,
        # which is what proves the person holds the number.
        if not identity.verified:
            # The code is looked for *inside* the message, not matched against
            # the whole of it: the wa.me link pre-fills a sentence around it,
            # and a shop that types "code 481920" means the same thing as one
            # that types the six digits alone.
            if code_present(message.get("text") or "", identity.pairing_code):
                identity.verified_at = timezone.now()
                identity.pairing_code = ""
                identity.save(update_fields=["verified_at", "pairing_code"])
                # Free text is allowed from here on: replying opened Meta's
                # 24-hour window, which is why the greeting before this one
                # had to be a template.
                provider.send(sender, onboarding.welcome_text(identity.workspace))
            else:
                provider.send(
                    sender,
                    "Send the 6-digit code from SalesPos to finish linking this number.",
                )
            return

        if message.get("unsupported"):
            provider.send(sender, NOT_TEXT)
            return

        text = (message.get("text") or "").strip()
        if not text:
            return

        try:
            ctx = build_context(
                user=identity.user, workspace=identity.workspace, channel="whatsapp"
            )
        except PermissionDenied as exc:
            # Access revoked, business suspended, or the subscription lapsed.
            provider.send(sender, str(exc))
            return

        try:
            check_rate(ctx)
        except RateLimited as exc:
            provider.send(sender, str(exc))
            return

        identity.last_seen_at = timezone.now()
        identity.save(update_fields=["last_seen_at"])

        reply = AgentService().answer(ctx=ctx, text=text, external_id=sender)
        provider.send(sender, reply)
