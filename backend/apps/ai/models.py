"""Conversations, the audit trail, and who is allowed to ask from WhatsApp.

Nothing here duplicates a business entity. Sales, products, customers and debts
stay where they are; these tables only record who asked what, which tools ran,
and which actions are waiting to be confirmed.
"""

from __future__ import annotations

import secrets
import uuid

from django.db import models
from django.utils import timezone

from apps.core.models import WorkspaceScoped


def normalise_phone(raw: str) -> str:
    """Reduce a phone number to digits with a country code, for matching.

    WhatsApp hands us `256760417357`; a person types `0760 417 357`. Both have
    to resolve to the same identity or the owner is a stranger to their own
    assistant.
    """
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if not digits:
        return ""
    if digits.startswith("0"):
        digits = "256" + digits[1:]
    return digits


class WhatsAppIdentity(WorkspaceScoped):
    """A WhatsApp number that is allowed to speak for one business.

    Deliberately NOT matched against `User.phone`. That field is typed in by
    hand and never verified, so two accounts can claim the same number and the
    first one found would win — which is an authentication bypass, not a
    convenience. A link is made only by someone already signed in to the
    dashboard, who is then sent a pairing code to send from the handset.
    """

    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="whatsapp_identities"
    )
    phone = models.CharField(max_length=32, db_index=True)
    pairing_code = models.CharField(max_length=12, blank=True, default="")
    verified_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "whatsapp_identities"
        ordering = ["-created_at"]
        constraints = [
            # One number speaks for one person in one business. Without this a
            # second row could quietly shadow the first.
            models.UniqueConstraint(
                fields=["phone", "workspace"], name="uniq_whatsapp_phone_workspace"
            )
        ]
        indexes = [models.Index(fields=["phone", "active"])]

    def __str__(self):
        return f"{self.phone} -> {self.user_id}"

    @property
    def verified(self) -> bool:
        return self.verified_at is not None

    def save(self, *args, **kwargs):
        self.phone = normalise_phone(self.phone)
        super().save(*args, **kwargs)

    @staticmethod
    def new_code() -> str:
        return f"{secrets.randbelow(1_000_000):06d}"


class Conversation(WorkspaceScoped):
    """One running thread with one person on one channel."""

    CHANNELS = [("whatsapp", "WhatsApp"), ("web", "Web")]

    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="ai_conversations"
    )
    channel = models.CharField(max_length=20, choices=CHANNELS)
    # The WhatsApp number for that channel; blank on the web, where the thread
    # is identified by its own id.
    external_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    last_active_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "ai_conversations"
        ordering = ["-last_active_at"]
        indexes = [models.Index(fields=["workspace", "-last_active_at"])]

    def __str__(self):
        return f"{self.channel} · {self.user_id}"

    def touch(self):
        self.last_active_at = timezone.now()
        self.save(update_fields=["last_active_at"])


class Message(WorkspaceScoped):
    """One turn. Kept so follow-up questions have something to refer back to."""

    ROLES = [("user", "User"), ("assistant", "Assistant")]

    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    role = models.CharField(max_length=20, choices=ROLES)
    content = models.TextField()

    class Meta:
        db_table = "ai_messages"
        ordering = ["created_at"]
        indexes = [models.Index(fields=["conversation", "created_at"])]

    def __str__(self):
        return f"{self.role}: {self.content[:60]}"


class ToolCall(WorkspaceScoped):
    """Every tool the model asked for, whether or not it was allowed to run.

    The refusals matter as much as the successes: a run of denied calls is how
    you would notice a prompt-injection attempt or a staff member probing for
    figures they cannot see.
    """

    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="tool_calls"
    )
    message = models.ForeignKey(
        Message, on_delete=models.SET_NULL, null=True, blank=True, related_name="tool_calls"
    )
    name = models.CharField(max_length=80)
    # The model's arguments only. Results are summarised, never stored whole:
    # a debtor list in a log is a customer list leaking into a second place.
    params = models.JSONField(default=dict, blank=True)
    ok = models.BooleanField(default=False)
    error = models.CharField(max_length=255, blank=True, default="")
    result_summary = models.CharField(max_length=255, blank=True, default="")
    duration_ms = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "ai_tool_calls"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["workspace", "-created_at"]),
            models.Index(fields=["name", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.name} {'ok' if self.ok else 'failed'}"


class PendingAction(WorkspaceScoped):
    """A write the assistant has proposed and the person has not yet approved.

    The model does not decide whether consent was given. It proposes; the
    backend stores the proposal with its parameters already resolved, and only
    a deterministic yes from the next message runs it. That keeps a misread
    "no, don't" from spending money.
    """

    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="pending_actions"
    )
    tool = models.CharField(max_length=80)
    params = models.JSONField(default=dict, blank=True)
    summary = models.CharField(max_length=500)
    expires_at = models.DateTimeField()
    confirmed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ai_pending_actions"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.tool} ({'open' if self.open else 'closed'})"

    @property
    def open(self) -> bool:
        return (
            self.confirmed_at is None
            and self.cancelled_at is None
            and self.expires_at > timezone.now()
        )


class InboundMessage(models.Model):
    """Every WhatsApp message id this server has already acted on.

    Meta redelivers any webhook it did not get a prompt 200 for, and the
    handler answers synchronously — model call, tool runs, then the reply — so
    a slow turn can outlast Meta's patience even though the answer went out.
    Without a claim on the message id the same question gets answered twice,
    and a confirmed action could run twice.

    The id is claimed *before* the work starts, so a redelivery that arrives
    mid-flight is dropped rather than racing the original. Deliberately not
    workspace-scoped: an unknown number has no workspace, and the id is unique
    across all of Meta anyway.

    Safe to prune — anything older than a day or two can never be redelivered.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider_message_id = models.CharField(max_length=128, unique=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "ai_inbound_messages"
        ordering = ["-created_at"]

    def __str__(self):
        return self.provider_message_id

    @classmethod
    def claim(cls, provider_message_id: str) -> bool:
        """Take ownership of this message. False means somebody already has it."""
        from django.db import IntegrityError, transaction

        if not provider_message_id:
            # No id to deduplicate on; better to answer than to drop it.
            return True
        try:
            # Its own transaction, so a clash does not poison an outer one.
            with transaction.atomic():
                cls.objects.create(provider_message_id=provider_message_id[:128])
        except IntegrityError:
            return False
        return True
