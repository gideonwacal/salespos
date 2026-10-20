"""Turning "last week" into two dates, without asking the model.

A language model will cheerfully tell you that last Tuesday was the 14th when
it was the 13th, and it has no idea what day it is where the shop is. So the
model never calculates a date here. It passes a phrase it heard — "yesterday",
"last month", "the last 30 days" — and this module resolves it against the
business's own clock.

Everything is returned as a half-open range of aware datetimes, [start, end),
so a query can use `created_at__gte` / `created_at__lt` and never double-count
a sale rung up at midnight.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

MONTHS = {
    m.lower(): i
    for i, m in enumerate(calendar.month_name)
    if m
} | {
    m.lower(): i
    for i, m in enumerate(calendar.month_abbr)
    if m
}


class DateError(ValueError):
    """The phrase could not be resolved. Shown to the user, so keep it plain."""


@dataclass(frozen=True)
class Period:
    start: datetime  # inclusive, aware
    end: datetime  # exclusive, aware
    label: str  # how to name it back to the user

    @property
    def start_date(self) -> date:
        return self.start.date()

    @property
    def last_date(self) -> date:
        """The final day *inside* the range, for `expense_date__lte` style filters."""
        return (self.end - timedelta(seconds=1)).date()

    def previous(self) -> "Period":
        """The equally long stretch immediately before this one, for comparisons."""
        span = self.end - self.start
        return Period(self.start - span, self.start, f"the previous {self.label}")


def _span(tz: ZoneInfo, first: date, last: date, label: str) -> Period:
    """Build a period covering whole days from `first` to `last` inclusive."""
    start = datetime.combine(first, time.min, tzinfo=tz)
    end = datetime.combine(last + timedelta(days=1), time.min, tzinfo=tz)
    return Period(start, end, label)


def today_in(tz: ZoneInfo) -> date:
    return datetime.now(tz).date()


def resolve(phrase: str | None, tz: ZoneInfo, *, today: date | None = None) -> Period:
    """Resolve a natural-language period against the business's timezone.

    Unrecognised phrases raise rather than quietly defaulting to today: an
    answer about the wrong days is worse than admitting the question was not
    understood.
    """
    now = today or today_in(tz)
    text = (phrase or "today").strip().lower()
    text = re.sub(r"^(for|in|during|the)\s+", "", text).strip()

    if text in ("today", "so far today", "this day"):
        return _span(tz, now, now, "today")
    if text in ("yesterday",):
        day = now - timedelta(days=1)
        return _span(tz, day, day, "yesterday")

    # Weeks run Monday to Sunday, which is how a Ugandan shop counts one.
    if text in ("this week", "week", "current week"):
        start = now - timedelta(days=now.weekday())
        return _span(tz, start, now, "this week")
    if text in ("last week", "previous week"):
        this_monday = now - timedelta(days=now.weekday())
        start = this_monday - timedelta(days=7)
        return _span(tz, start, start + timedelta(days=6), "last week")

    if text in ("this month", "month", "current month"):
        return _span(tz, now.replace(day=1), now, "this month")
    if text in ("last month", "previous month"):
        first_this = now.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        return _span(
            tz, last_prev.replace(day=1), last_prev, last_prev.strftime("%B %Y")
        )

    if text in ("this year", "year", "current year"):
        return _span(tz, date(now.year, 1, 1), now, "this year")
    if text in ("last year", "previous year"):
        return _span(tz, date(now.year - 1, 1, 1), date(now.year - 1, 12, 31), str(now.year - 1))

    # "the last 30 days" — counts back from today, today included.
    window = re.fullmatch(r"last (\d{1,4})\s*(day|days|week|weeks|month|months)", text)
    if window:
        count = int(window.group(1))
        unit = window.group(2).rstrip("s")
        if count < 1:
            raise DateError("That period is empty.")
        days = {"day": 1, "week": 7, "month": 30}[unit] * count
        if days > 366 * 5:
            raise DateError("That is further back than I can look.")
        return _span(tz, now - timedelta(days=days - 1), now, f"the last {count} {unit}s")

    # "January", "jan 2024" — a bare month means the most recent one that has
    # already happened, because asking in March for "January" never means next.
    named = re.fullmatch(r"([a-z]+)(?:\s+(\d{4}))?", text)
    if named and named.group(1) in MONTHS:
        month = MONTHS[named.group(1)]
        year = int(named.group(2)) if named.group(2) else now.year
        if not named.group(2) and month > now.month:
            year -= 1
        last_day = calendar.monthrange(year, month)[1]
        return _span(
            tz, date(year, month, 1), date(year, month, last_day),
            date(year, month, 1).strftime("%B %Y"),
        )

    # An explicit ISO date, or a range of them.
    iso = re.fullmatch(r"(\d{4}-\d{2}-\d{2})(?:\s*(?:to|-|until|\.\.)\s*(\d{4}-\d{2}-\d{2}))?", text)
    if iso:
        try:
            first = date.fromisoformat(iso.group(1))
            last = date.fromisoformat(iso.group(2)) if iso.group(2) else first
        except ValueError as exc:
            raise DateError("That is not a real date.") from exc
        if last < first:
            first, last = last, first
        label = first.isoformat() if first == last else f"{first} to {last}"
        return _span(tz, first, last, label)

    raise DateError(
        f"I could not work out what period “{phrase}” means. "
        "Try today, yesterday, this week, last month, or a date like 2026-03-01."
    )
