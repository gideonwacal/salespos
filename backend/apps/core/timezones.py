"""Which day it is where the business is.

The project runs on `TIME_ZONE = "UTC"`, so `timezone.localdate()` returns the
UTC date. Kampala is three hours ahead: between midnight and 3am local, the UTC
date is still yesterday, and a shop asking for today's takings was shown the
previous day's until the counter had been open for three hours.

Anything that means "today" to a shopkeeper goes through here.
"""

from datetime import date
from zoneinfo import ZoneInfo

DEFAULT_TIMEZONE = "Africa/Kampala"


def business_tz(workspace) -> ZoneInfo:
    name = getattr(workspace, "timezone", "") or DEFAULT_TIMEZONE
    try:
        return ZoneInfo(name)
    except Exception:
        # A timezone this machine's zoneinfo does not carry should degrade to
        # the regional default, not take the dashboard down.
        return ZoneInfo(DEFAULT_TIMEZONE)


def business_today(workspace) -> date:
    from django.utils import timezone as dj_timezone

    return dj_timezone.now().astimezone(business_tz(workspace)).date()
