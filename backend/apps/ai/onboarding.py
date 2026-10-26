"""Linking a business's WhatsApp number at sign-up.

There are two ways to get a new owner talking to their assistant, and they are
not equally good.

**The easy one, and the default.** Sign-up hands them a wa.me link with the
pairing code already typed. They tap it, WhatsApp opens, they press send. That
one tap does three things at once: it proves they hold the handset, it opens
Meta's 24-hour window so everything after it can be ordinary text, and it costs
nothing — a conversation the customer starts is a service conversation, and the
first thousand a month per number are free. Nothing has to be approved first.

**The hard one, kept as a fallback.** Messaging them cold. Meta will not
deliver free text to somebody who has not written to the business in the last
24 hours, so this needs a template submitted and approved in advance, it is
billed per message, and when the template is not approved yet it fails quietly
at Meta's end while the shop watches a phone that never buzzes.

So the link is the path to take. The template is only worth configuring to
chase the owners who never tapped it.

Either way the link stays unverified until something arrives *from* that
handset. A number typed at sign-up is a claim, not proof, and a mistyped digit
would otherwise put one shop's takings on a stranger's phone.
"""

from __future__ import annotations

import logging

from django.conf import settings

from apps.ai.models import WhatsAppIdentity, normalise_phone

log = logging.getLogger(__name__)

WELCOME = (
    "\U0001f389 *Welcome to your business!*\n\n"
    "{business} is now set up on SalesPos, and this is your assistant.\n\n"
    "Ask me anything about the shop:\n"
    "• _How much did I sell today?_\n"
    "• _What is running low?_\n"
    "• _Who owes me money?_\n"
    "• _How much profit did I make this month?_"
)


def activation_link(identity) -> str:
    """A wa.me link that opens WhatsApp with the pairing code already typed.

    Returns "" when no business number is configured, so a caller can tell the
    difference between "tap here" and "there is nothing to tap".
    """
    from urllib.parse import quote

    number = settings.WHATSAPP_BUSINESS_NUMBER
    if not number or not identity or not identity.pairing_code:
        return ""
    # The code is what the webhook looks for; the words around it are for the
    # person, so the thread does not open with a bare six digits.
    message = (
        f"Hi SalesPos — activate my assistant for "
        f"{identity.workspace.name}. Code: {identity.pairing_code}"
    )
    return f"https://wa.me/{number}?text={quote(message)}"


def conflicting_identity(phone: str, *, exclude_workspace=None):
    """A verified link on this number belonging to somebody else.

    One number must not answer for two businesses: the webhook would have to
    pick between them, and whichever it picked would be showing one shop's
    figures to the other shop's phone.
    """
    phone = normalise_phone(phone)
    if not phone:
        return None
    rows = WhatsAppIdentity.objects.filter(
        phone=phone, active=True, verified_at__isnull=False
    )
    if exclude_workspace is not None:
        rows = rows.exclude(workspace=exclude_workspace)
    return rows.first()


def start_link(*, user, workspace, phone: str) -> tuple[WhatsAppIdentity | None, bool]:
    """Create the pending link and send the welcome. Returns (identity, sent).

    Never raises. Sign-up must not fail because WhatsApp is misconfigured or
    Meta is having a bad afternoon — the shop can always link again later from
    Settings.
    """
    phone = normalise_phone(phone)
    if not phone:
        return None, False

    try:
        identity = WhatsAppIdentity.objects.create(
            workspace=workspace,
            user=user,
            phone=phone,
            pairing_code=WhatsAppIdentity.new_code(),
        )
    except Exception:  # noqa: BLE001
        log.exception("Could not create a WhatsApp link for workspace %s", workspace.id)
        return None, False

    # The template is tried only as a nudge for owners who never tap the link.
    # It is allowed to fail: the link is the path that actually works.
    sent = send_welcome(identity)
    return identity, sent


def send_welcome(identity: WhatsAppIdentity) -> bool:
    """The first touch, which has to be a template because nobody has written yet."""
    from apps.ai.whatsapp import get_whatsapp_provider

    template = settings.WHATSAPP_WELCOME_TEMPLATE
    if not template:
        log.info(
            "No WHATSAPP_WELCOME_TEMPLATE set; %s linked but not greeted",
            identity.phone[-4:],
        )
        return False

    try:
        return get_whatsapp_provider().send_template(
            identity.phone,
            template,
            [identity.workspace.name, identity.pairing_code],
        )
    except Exception:  # noqa: BLE001
        log.exception("Welcome message failed for %s", identity.phone[-4:])
        return False


def welcome_text(workspace) -> str:
    """What they see once the handset has been proved.

    Free text, which is allowed now: replying with the code opened the 24-hour
    window.
    """
    return WELCOME.format(business=workspace.name)
