"""Keeping one runaway client from spending the month's model quota.

Counted from the ToolCall and Message tables that are being written anyway, so
there is no cache or Redis to run. At these volumes a COUNT over an indexed
timestamp is cheaper than the model call it is protecting.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from apps.ai.models import Message


class RateLimited(Exception):
    """Shown to the person, so it has to read like a sentence."""


def check(ctx) -> None:
    since = timezone.now() - timedelta(hours=1)

    mine = Message.objects.filter(
        workspace=ctx.workspace, conversation__user=ctx.user, role="user", created_at__gte=since
    ).count()
    if mine >= settings.AI_RATE_PER_USER_HOUR:
        raise RateLimited(
            "You've asked me a lot of questions this hour. Give it a few "
            "minutes and try again."
        )

    theirs = Message.objects.filter(
        workspace=ctx.workspace, role="user", created_at__gte=since
    ).count()
    if theirs >= settings.AI_RATE_PER_WORKSPACE_HOUR:
        raise RateLimited(
            "This business has reached its hourly limit for assistant "
            "questions. Please try again shortly."
        )
