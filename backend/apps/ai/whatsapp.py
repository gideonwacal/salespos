"""The WhatsApp transport.

Nothing in here knows what an agent is, and nothing in agent.py knows what
WhatsApp is. The webhook resolves an identity, hands text to the agent, and
sends the answer back; swapping Meta for another gateway means one more class.
"""

from __future__ import annotations

import hashlib
import hmac
import logging

import requests
from django.conf import settings

log = logging.getLogger(__name__)


class WhatsAppProvider:
    """Interface for anything that can deliver a WhatsApp message."""

    def send(self, to: str, text: str) -> bool:
        raise NotImplementedError

    def send_template(self, to: str, template: str, body_params: list) -> bool:
        """Open a conversation with someone who has not written to us yet.

        Meta only allows free text inside a 24-hour window that the *customer*
        opens by messaging first. A business reaching out cold must use a
        template it had approved in advance, which is why this exists
        separately from `send`.
        """
        raise NotImplementedError

    def verify_signature(self, body: bytes, header: str) -> bool:
        raise NotImplementedError

    def parse(self, payload: dict) -> list[dict]:
        """Pull [{from, text, message_id}] out of a webhook body."""
        raise NotImplementedError


class MetaWhatsAppProvider(WhatsAppProvider):
    """Meta's WhatsApp Cloud API."""

    @property
    def configured(self) -> bool:
        return bool(settings.WHATSAPP_TOKEN and settings.WHATSAPP_PHONE_NUMBER_ID)

    def send(self, to: str, text: str) -> bool:
        if not self.configured:
            log.warning("WhatsApp send skipped: no token configured")
            return False
        url = f"{settings.WHATSAPP_API_BASE}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
        try:
            response = requests.post(
                url,
                headers={"Authorization": f"Bearer {settings.WHATSAPP_TOKEN}"},
                json={
                    "messaging_product": "whatsapp",
                    "to": to,
                    "type": "text",
                    # Links in an answer are noise on a phone, and previewing
                    # them would leak the question to whatever is linked.
                    "text": {"body": text[:4096], "preview_url": False},
                },
                timeout=15,
            )
        except requests.RequestException as exc:
            log.error("WhatsApp send failed for %s: %s", to[-4:], exc)
            return False
        if response.status_code >= 400:
            log.error("WhatsApp send rejected (%s): %s", response.status_code, response.text[:300])
            return False
        return True

    def send_template(self, to: str, template: str, body_params: list) -> bool:
        if not self.configured or not template:
            log.warning("WhatsApp template send skipped: not configured")
            return False
        url = f"{settings.WHATSAPP_API_BASE}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template,
                "language": {"code": settings.WHATSAPP_TEMPLATE_LANGUAGE},
            },
        }
        if body_params:
            payload["template"]["components"] = [
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": str(p)} for p in body_params],
                }
            ]
        try:
            response = requests.post(
                url,
                headers={"Authorization": f"Bearer {settings.WHATSAPP_TOKEN}"},
                json=payload,
                timeout=15,
            )
        except requests.RequestException as exc:
            log.error("WhatsApp template send failed for %s: %s", to[-4:], exc)
            return False
        if response.status_code >= 400:
            # The usual cause is a template name that is not approved yet, or
            # whose placeholder count does not match what we sent.
            log.error(
                "WhatsApp template %r rejected (%s): %s",
                template, response.status_code, response.text[:300],
            )
            return False
        return True

    def verify_signature(self, body: bytes, header: str) -> bool:
        """Check Meta actually sent this.

        Without it the webhook URL is an open door: anyone who learns it could
        post a message claiming to come from the owner's number and read the
        whole business. Absent a configured secret this returns False, so the
        webhook refuses rather than trusting an unsigned caller.
        """
        secret = settings.WHATSAPP_APP_SECRET
        if not secret:
            log.error("WHATSAPP_APP_SECRET is not set; refusing unverified webhook")
            return False
        if not header or not header.startswith("sha256="):
            return False
        expected = hmac.new(
            secret.encode(), msg=body, digestmod=hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, header.split("=", 1)[1].strip())

    def parse(self, payload: dict) -> list[dict]:
        """Flatten Meta's nested envelope into the messages we care about.

        Status callbacks (delivered, read) arrive on the same hook and carry no
        `messages` key; they are skipped rather than answered.
        """
        out = []
        for entry in payload.get("entry") or []:
            for change in entry.get("changes") or []:
                value = change.get("value") or {}
                for message in value.get("messages") or []:
                    if message.get("type") != "text":
                        out.append(
                            {
                                "from": message.get("from", ""),
                                "text": "",
                                "message_id": message.get("id", ""),
                                "unsupported": True,
                            }
                        )
                        continue
                    out.append(
                        {
                            "from": message.get("from", ""),
                            "text": (message.get("text") or {}).get("body", ""),
                            "message_id": message.get("id", ""),
                            "unsupported": False,
                        }
                    )
        return out


def get_whatsapp_provider() -> WhatsAppProvider:
    return MetaWhatsAppProvider()
