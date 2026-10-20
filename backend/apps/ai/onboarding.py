"""Linking a business's WhatsApp number at sign-up.

The owner types their WhatsApp business number on the sign-up form, and a
welcome lands on that handset straight away. Replying with the code in it
finishes the link, and from then on they can simply ask the assistant
questions.

Two constraints shape this, and both come from outside:

Meta will not deliver free text to someone who has not messaged the business in
the last 24 hours. A brand-new shop has never messaged us, so the first touch
has to be a template approved in advance. Once they reply, the window opens and
everything after it is ordinary text.

A number typed at sign-up is a claim, not proof. Until somebody replies from
that handset the link stays unverified and the assistant answers nothing
through it — because a mistyped digit would otherwise put one shop's takings on
a stranger's phone.
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
