"""Mobile money collections, straight from MTN and Airtel.

No aggregator sits in the middle: the money moves from the shop's wallet to
ours, and the only thing between them is the telco. That is the whole point of
doing it this way — nobody holds the float, nobody takes a second cut, and
there is no foreign entity to register.

Both networks work the same way underneath, which is why they share a shape
here: push a request at a phone number, the owner approves it with their PIN,
and the result is read back by asking. Neither tells us anything we did not ask
for, so nothing here trusts a callback; the status is always fetched.

Everything is a plain function over `requests`. A telco that is not configured
simply cannot be reached, and `available()` says so rather than failing later
with a stack trace.
"""

import base64
import uuid

import requests
from django.conf import settings

TIMEOUT = 30

# What a collection can be, once the telco has been asked.
PENDING = "pending"
SUCCESSFUL = "successful"
FAILED = "failed"


class CollectionError(Exception):
    """The telco could not be reached, or refused the request outright."""


def msisdn(phone: str, country_code: str = "256") -> str:
    """0771 234 567 -> 256771234567.

    Both APIs want the international form with no plus and no spaces, and both
    reject anything else with a message the shop cannot act on.
    """
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if digits.startswith(country_code):
        return digits
    return country_code + digits.lstrip("0")


# --------------------------------------------------------------------------
# MTN MoMo Collections
# --------------------------------------------------------------------------


def mtn_available() -> bool:
    return bool(
        settings.MTN_MOMO_SUBSCRIPTION_KEY
        and settings.MTN_MOMO_API_USER
        and settings.MTN_MOMO_API_KEY
    )


def _mtn_token() -> str:
    """A bearer token, good for about an hour.

    Fetched per call rather than cached: a subscription payment happens a
    handful of times a month, and a stale token is a far worse bug than an
    extra round trip.
    """
    credentials = f"{settings.MTN_MOMO_API_USER}:{settings.MTN_MOMO_API_KEY}"
    basic = base64.b64encode(credentials.encode()).decode()
    response = requests.post(
        f"{settings.MTN_MOMO_BASE_URL}/collection/token/",
        headers={
            "Authorization": f"Basic {basic}",
            "Ocp-Apim-Subscription-Key": settings.MTN_MOMO_SUBSCRIPTION_KEY,
        },
        timeout=TIMEOUT,
    )
    if response.status_code >= 300:
        raise CollectionError(f"MTN refused the token request ({response.status_code}).")
    token = (response.json() or {}).get("access_token")
    if not token:
        raise CollectionError("MTN returned no access token.")
    return token


def _mtn_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "X-Target-Environment": settings.MTN_MOMO_ENVIRONMENT,
        "Ocp-Apim-Subscription-Key": settings.MTN_MOMO_SUBSCRIPTION_KEY,
        "Content-Type": "application/json",
    }


def mtn_request_to_pay(*, reference: str, phone: str, amount, currency: str, note: str) -> None:
    """Ask MTN to prompt this phone for a PIN.

    `reference` is ours and is what MTN calls X-Reference-Id: it is the handle
    the payment is read back by, so it is generated before the call and stored
    before the shop is told anything.
    """
    token = _mtn_token()
    response = requests.post(
        f"{settings.MTN_MOMO_BASE_URL}/collection/v1_0/requesttopay",
        headers={**_mtn_headers(token), "X-Reference-Id": reference},
        json={
            "amount": str(int(amount)),
            "currency": currency,
            "externalId": reference,
            "payer": {"partyIdType": "MSISDN", "partyId": msisdn(phone)},
            "payerMessage": note,
            "payeeNote": note,
        },
        timeout=TIMEOUT,
    )
    # 202 Accepted is the success case: the prompt is on its way, nothing is
    # paid yet.
    if response.status_code != 202:
        raise CollectionError(_mtn_reason(response))


def _mtn_reason(response) -> str:
    try:
        body = response.json() or {}
    except ValueError:
        body = {}
    message = body.get("message") or body.get("reason") or ""
    return f"MTN refused the payment request ({response.status_code}). {message}".strip()


def mtn_status(reference: str) -> tuple:
    """(state, reason) for a request we pushed earlier."""
    token = _mtn_token()
    response = requests.get(
        f"{settings.MTN_MOMO_BASE_URL}/collection/v1_0/requesttopay/{reference}",
        headers=_mtn_headers(token),
        timeout=TIMEOUT,
    )
    if response.status_code >= 300:
        raise CollectionError(f"MTN could not be asked about the payment ({response.status_code}).")

    body = response.json() or {}
    state = str(body.get("status", "")).upper()
    if state == "SUCCESSFUL":
        return SUCCESSFUL, body
    if state == "FAILED":
        return FAILED, body
    return PENDING, body


# --------------------------------------------------------------------------
# Airtel Money Collections
# --------------------------------------------------------------------------


def airtel_available() -> bool:
    return bool(settings.AIRTEL_CLIENT_ID and settings.AIRTEL_CLIENT_SECRET)


def _airtel_token() -> str:
    response = requests.post(
        f"{settings.AIRTEL_BASE_URL}/auth/oauth2/token",
        json={
            "client_id": settings.AIRTEL_CLIENT_ID,
            "client_secret": settings.AIRTEL_CLIENT_SECRET,
            "grant_type": "client_credentials",
        },
        headers={"Content-Type": "application/json", "Accept": "*/*"},
        timeout=TIMEOUT,
    )
    if response.status_code >= 300:
        raise CollectionError(f"Airtel refused the token request ({response.status_code}).")
    token = (response.json() or {}).get("access_token")
    if not token:
        raise CollectionError("Airtel returned no access token.")
    return token


def _airtel_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "X-Country": settings.AIRTEL_COUNTRY,
        "X-Currency": settings.AIRTEL_CURRENCY,
        "Content-Type": "application/json",
        "Accept": "*/*",
    }


def airtel_push(*, reference: str, phone: str, amount, currency: str) -> None:
    """Ask Airtel to prompt this phone for a PIN."""
    token = _airtel_token()
    response = requests.post(
        f"{settings.AIRTEL_BASE_URL}/merchant/v1/payments/",
        headers=_airtel_headers(token),
        json={
            "reference": reference,
            "subscriber": {
                "country": settings.AIRTEL_COUNTRY,
                "currency": currency,
                "msisdn": msisdn(phone)[3:],  # Airtel wants the local part
            },
            "transaction": {
                "amount": int(amount),
                "country": settings.AIRTEL_COUNTRY,
                "currency": currency,
                "id": reference,
            },
        },
        timeout=TIMEOUT,
    )
    if response.status_code >= 300:
        raise CollectionError(_airtel_reason(response))

    body = response.json() or {}
    if not (body.get("status") or {}).get("success", True):
        raise CollectionError(
            (body.get("status") or {}).get("message") or "Airtel refused the payment request."
        )


def _airtel_reason(response) -> str:
    try:
        body = response.json() or {}
    except ValueError:
        body = {}
    message = (body.get("status") or {}).get("message") or ""
    return f"Airtel refused the payment request ({response.status_code}). {message}".strip()


def airtel_status(reference: str) -> tuple:
    """(state, body) for a push we sent earlier.

    Airtel answers with a two-letter code: TS transaction successful, TF
    failed, TIP in progress, TA ambiguous. Anything that is not plainly one of
    the first two is treated as still running, because telling a shop its money
    is gone when it is merely slow is the worse mistake.
    """
    token = _airtel_token()
    response = requests.get(
        f"{settings.AIRTEL_BASE_URL}/standard/v1/payments/{reference}",
        headers=_airtel_headers(token),
        timeout=TIMEOUT,
    )
    if response.status_code >= 300:
        raise CollectionError(
            f"Airtel could not be asked about the payment ({response.status_code})."
        )

    body = response.json() or {}
    code = str(((body.get("data") or {}).get("transaction") or {}).get("status", "")).upper()
    if code == "TS":
        return SUCCESSFUL, body
    if code in ("TF", "TE"):
        return FAILED, body
    return PENDING, body


# --------------------------------------------------------------------------
# One front door
# --------------------------------------------------------------------------


def new_reference() -> str:
    """MTN requires a UUID for X-Reference-Id, so both networks use one."""
    return str(uuid.uuid4())


def start_collection(*, network: str, reference: str, phone: str, amount, currency: str, note: str):
    if network == "mtn_momo":
        mtn_request_to_pay(
            reference=reference, phone=phone, amount=amount, currency=currency, note=note
        )
    elif network == "airtel_money":
        airtel_push(reference=reference, phone=phone, amount=amount, currency=currency)
    else:
        raise CollectionError("That network cannot take payments here.")


def collection_status(*, network: str, reference: str) -> tuple:
    if network == "mtn_momo":
        return mtn_status(reference)
    if network == "airtel_money":
        return airtel_status(reference)
    raise CollectionError("That network cannot take payments here.")
