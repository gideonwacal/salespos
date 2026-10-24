"""Invite links, and the three days five signups buy.

The rule, in one place so the app and the console cannot disagree about it:

  * A business shares a link ending in its referral code.
  * Opening that link is recorded so the owner can watch the funnel. It earns
    nothing — a page view costs nothing to manufacture, and five private
    windows must not buy three days.
  * A business that signs up through the link is a referral.
  * The fifth referral grants three days, once. After those, the only way on
    is to pay.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import (
    REFERRAL_GRACE_DAYS,
    REFERRALS_FOR_GRACE,
    Referral,
    ReferralVisit,
    Workspace,
    new_referral_code,
)

log = logging.getLogger(__name__)


def code_for(workspace: Workspace) -> str:
    """This business's code, issued on first use.

    Retried on collision rather than assumed unique: seven characters from an
    alphabet of 28 is a lot of room, but "a lot" is not "never".
    """
    if workspace.referral_code:
        return workspace.referral_code
    for _ in range(8):
        candidate = new_referral_code()
        try:
            with transaction.atomic():
                workspace.referral_code = candidate
                workspace.save(update_fields=["referral_code", "updated_at"])
            return candidate
        except IntegrityError:
            continue
    raise RuntimeError("Could not allocate a referral code.")


def resolve(code: str) -> Workspace | None:
    code = (code or "").strip().upper()
    if not code:
        return None
    return Workspace.objects.filter(referral_code=code).first()


def record_visit(workspace: Workspace, request) -> None:
    """Note that somebody opened the link. Never raises: this is telemetry."""
    try:
        ReferralVisit.objects.create(
            workspace=workspace,
            visitor_digest=ReferralVisit.digest(request),
            device=ReferralVisit.device_of(request),
        )
    except Exception:  # noqa: BLE001
        log.exception("Could not record a referral visit for %s", workspace.id)


@transaction.atomic
def attribute(*, referrer: Workspace, referred: Workspace) -> Referral | None:
    """Credit a new business to whoever referred it, then check for the grace.

    Returns None when the signup cannot be credited — referring yourself, or a
    business that already belongs to somebody else's count.
    """
    if referrer.id == referred.id:
        return None
    try:
        referral = Referral.objects.create(referrer=referrer, referred=referred)
    except IntegrityError:
        # Already attributed. A business is somebody's referral once, for good.
        return None
    grant_grace_if_earned(referrer)
    return referral


def counts(workspace: Workspace) -> dict:
    """Where this business stands, for its own page and for the console."""
    signups = Referral.objects.filter(referrer=workspace).count()
    opens = (
        ReferralVisit.objects.filter(workspace=workspace)
        .values("visitor_digest")
        .distinct()
        .count()
    )
    return {
        "opens": opens,
        "total_opens": ReferralVisit.objects.filter(workspace=workspace).count(),
        "signups": signups,
        "needed": REFERRALS_FOR_GRACE,
        "remaining": max(0, REFERRALS_FOR_GRACE - signups),
        "grace_days": REFERRAL_GRACE_DAYS,
        "grace_granted": workspace.referral_grace_granted_at is not None,
        "grace_until": workspace.referral_grace_until,
        "grace_active": workspace.on_referral_grace,
    }


def grant_grace_if_earned(workspace: Workspace) -> bool:
    """Give the three days if this is the fifth signup and the first time.

    Where the three days start matters. A business still inside its trial has
    not needed them yet, so they are stacked on the end of the trial rather
    than burnt in parallel with it — otherwise reaching five on day two would
    consume the reward before it was any use.
    """
    if workspace.referral_grace_granted_at is not None:
        return False
    if Referral.objects.filter(referrer=workspace).count() < REFERRALS_FOR_GRACE:
        return False

    now = timezone.now()
    start = max(now, workspace.trial_ends) if workspace.trial_ends else now
    if workspace.paid_until and workspace.paid_until > start:
        start = workspace.paid_until

    workspace.referral_grace_until = start + timedelta(days=REFERRAL_GRACE_DAYS)
    workspace.referral_grace_granted_at = now
    workspace.save(
        update_fields=["referral_grace_until", "referral_grace_granted_at", "updated_at"]
    )
    log.info("Referral grace granted to workspace %s", workspace.id)
    return True


def referred_businesses(workspace: Workspace, limit: int = 100) -> list[dict]:
    """Who this business brought in. Shown to the owner and to the console."""
    rows = (
        Referral.objects.filter(referrer=workspace)
        .select_related("referred")
        .order_by("-created_at")[:limit]
    )
    return [
        {
            "id": str(r.referred_id),
            "name": r.referred.name,
            "joined": r.created_at,
            # Whether the business they brought in is itself paying. The
            # console cares; it is the difference between a referral that grew
            # the product and one that only unlocked three days.
            "subscribed": r.referred.subscription_active,
        }
        for r in rows
    ]


def recent_visits(workspace: Workspace, limit: int = 50) -> list[dict]:
    rows = ReferralVisit.objects.filter(workspace=workspace).order_by("-created_at")[:limit]
    return [{"opened": v.created_at, "device": v.device} for v in rows]
