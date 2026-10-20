"""Making figures readable on a phone.

Tool results are formatted here, not by the model. A language model asked to
restate "4823500" will occasionally restate it as 4.8 million and occasionally
as 48 million, and a shopkeeper has no way to tell which. So the numbers in an
answer are produced by this module and the model only arranges them.
"""

from __future__ import annotations

from decimal import Decimal


def money(value, currency: str = "UGX") -> str:
    """Full shillings, grouped. No decimals: nobody prices in cents here."""
    amount = Decimal(str(value or 0)).quantize(Decimal("1"))
    return f"{currency} {amount:,}"


def short_money(value, currency: str = "UGX") -> str:
    """The compact form a person would say out loud: UGX 4.82M.

    Used in headline figures where the exact shilling adds nothing. Anything
    under a hundred thousand is shown in full, because "UGX 0.04M" is not how
    anyone thinks about forty thousand shillings.
    """
    amount = Decimal(str(value or 0))
    sign = "-" if amount < 0 else ""
    amount = abs(amount)
    if amount >= 1_000_000:
        return f"{sign}{currency} {amount / 1_000_000:.2f}M".replace(".00M", "M")
    if amount >= 100_000:
        return f"{sign}{currency} {amount / 1_000:.0f}K"
    return f"{sign}{money(amount, currency)}"


def percent_change(now, before) -> str | None:
    """How this period compares with the one before it.

    Returns None when there is nothing to compare against: "up 100% from zero"
    is arithmetic, not information.
    """
    now = Decimal(str(now or 0))
    before = Decimal(str(before or 0))
    if before <= 0:
        return None
    change = (now - before) / before * 100
    direction = "higher" if change >= 0 else "lower"
    return f"{abs(change):.0f}% {direction}"


def bullets(rows: list[str]) -> str:
    return "\n".join(f"• {row}" for row in rows)
