"""Writing quantities the way a shopkeeper says them.

Stock is held to three decimal places so a quarter kilo is exact, but almost
nothing should be *shown* that way. Seven sacks is "7", not "7.000", and what
is left of a sack is "48.25", not "48.250".
"""

from decimal import Decimal


def trim(value) -> str:
    """A quantity with no trailing zeros and no trailing point."""
    if value is None:
        return "0"
    text = format(Decimal(str(value)).normalize(), "f")
    # normalize() turns 100 into 1E+2, which is not a quantity anybody says.
    if "E" in text or "e" in text:
        text = format(Decimal(str(value)), "f").rstrip("0").rstrip(".")
    return text or "0"


def with_unit(value, unit: str = "") -> str:
    """A quantity and what it is measured in: "48.25 kg", or just "7"."""
    amount = trim(value)
    return f"{amount} {unit}".strip() if unit else amount
