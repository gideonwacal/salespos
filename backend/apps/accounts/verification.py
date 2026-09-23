"""Proving a new owner can read the address they signed up with.

Deliberately forgiving about delivery. Email is the one part of this that can
fail silently and outside our control — a wrong address, a full mailbox, an
SMTP host nobody configured — and an owner who cannot receive the link must not
be left with a business they can never open. So:

  * the token is made and stored whether or not the message goes out,
  * a failure to send is reported to the caller instead of swallowed,
  * the link is logged, so whoever runs the platform can read it out over the
    phone if it comes to that,
  * and the address can always be verified by hand from the admin.

Nothing here decides who is locked out; that lives with the rest of the access
rules in core.tenancy.
"""

import logging
import secrets

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from apps.accounts.models import EmailVerification

log = logging.getLogger(__name__)

SUBJECT = "Confirm your email for SalesPos"

BODY = """Hello {name},

Confirm this address to finish setting up {business} on SalesPos:

    {link}

The link works once and lasts seven days. If you did not create a SalesPos
account, ignore this message — nothing happens until the link is opened.

— SalesPos
"""


def verification_link(token: str) -> str:
    base = (settings.APP_BASE_URL or "").rstrip("/")
    return f"{base}/verify?token={token}"


def issue_verification(user, *, business: str = "") -> tuple:
    """Make a link for this user and try to send it.

    Returns (verification, sent). `sent` is False when the message could not be
    handed to a mail server — the token is still good, and the caller decides
    what to tell the person.
    """
    token = secrets.token_urlsafe(32)
    verification = EmailVerification.objects.create(user=user, token=token)
    link = verification_link(token)

    # Always on the record. A shop on the phone saying "no email came" is a
    # solvable problem if the link is in the logs, and an unsolvable one if it
    # is not.
    log.info("Email verification issued for %s: %s", user.email, link)

    if not settings.EMAIL_HOST and not settings.DEBUG:
        log.warning("EMAIL_HOST is not set; no verification email was sent.")
        return verification, False

    try:
        send_mail(
            subject=SUBJECT,
            message=BODY.format(
                name=user.full_name or "there",
                business=business or "your business",
                link=link,
            ),
            from_email=settings.DEFAULT_FROM_EMAIL or None,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception:  # noqa: BLE001 — every mail backend raises its own family
        log.exception("Could not send the verification email to %s", user.email)
        return verification, False

    return verification, True


def consume(token: str):
    """Turn a link into a verified user, or return None.

    A token that is unknown, already used or older than a week is simply not a
    token. Nothing distinguishes the three cases to the caller: telling a
    stranger which of those it was is telling them something about an account
    that is not theirs.
    """
    verification = EmailVerification.objects.filter(token=token, used_at=None).first()
    if verification is None or verification.expired:
        return None

    verification.used_at = timezone.now()
    verification.save(update_fields=["used_at"])

    user = verification.user
    if not user.email_verified:
        user.email_verified = True
        user.save(update_fields=["email_verified"])
    return user
