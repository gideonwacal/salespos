"""Who owes what.

Shared by the debtors endpoints and the assistant, so the figure a shop is told
on WhatsApp is the figure its dashboard shows.
"""

from __future__ import annotations

from decimal import Decimal

from django.db.models import DecimalField, F, Sum, Value
from django.db.models.functions import Coalesce

from apps.trade.models import Customer, Debt

MONEY = DecimalField(max_digits=14, decimal_places=2)


def open_debts(workspace):
    """Debts with something still outstanding on them."""
    return Debt.objects.filter(workspace=workspace).exclude(status="cleared")


def debt_outstanding(qs) -> Decimal:
    """What is still owed across a set of debts."""
    total = qs.aggregate(
        owed=Coalesce(
            Sum(F("total_value") - F("amount_paid"), output_field=MONEY),
            Value(Decimal("0"), output_field=MONEY),
        )
    )["owed"]
    return total or Decimal("0")


def debtors(workspace, *, minimum: Decimal | None = None, overdue_only: bool = False,
            limit: int = 20) -> list[dict]:
    """Customers with money outstanding, biggest first.

    Grouped by customer rather than listed per debt: a shop thinks in terms of
    who owes it, not how many separate slips that is spread over.
    """
    qs = open_debts(workspace)
    if overdue_only:
        qs = qs.filter(status="overdue")

    rows = (
        qs.values("customer_id", "customer__name", "customer__phone")
        .annotate(
            owed=Coalesce(
                Sum(F("total_value") - F("amount_paid"), output_field=MONEY),
                Value(Decimal("0"), output_field=MONEY),
            )
        )
        .order_by("-owed")
    )

    out = []
    for row in rows:
        owed = row["owed"] or Decimal("0")
        if owed <= 0:
            continue
        if minimum is not None and owed < minimum:
            continue
        out.append(
            {
                "customer_id": str(row["customer_id"]),
                "name": row["customer__name"] or "Unnamed customer",
                "phone": row["customer__phone"] or "",
                "owed": owed,
            }
        )
        if len(out) >= limit:
            break
    return out


def find_customer(workspace, name: str) -> Customer | None:
    """Best match for a name a person said out loud.

    Exact first, then a contains match, so "Mukasa" finds "John Mukasa" without
    "Mukasa Hardware" winning on alphabetical order.
    """
    name = (name or "").strip()
    if not name:
        return None
    scoped = Customer.objects.filter(workspace=workspace)
    return (
        scoped.filter(name__iexact=name).first()
        or scoped.filter(name__icontains=name).order_by("name").first()
    )


def customer_statement(workspace, customer: Customer, *, limit: int = 10) -> dict:
    """One customer's standing: what they owe, and the debts making it up."""
    qs = Debt.objects.filter(workspace=workspace, customer=customer).order_by("due_date")
    lines = [
        {
            "issued": debt.issue_date,
            "due": debt.due_date,
            "status": debt.status,
            "total": Decimal(debt.total_value or 0),
            "balance": Decimal(debt.total_value or 0) - Decimal(debt.amount_paid or 0),
            "items": (debt.items_summary or "").strip(),
        }
        for debt in qs[:limit]
    ]
    return {
        "name": customer.name,
        "phone": customer.phone or "",
        "credit_limit": Decimal(customer.credit_limit or 0),
        "bottles_owed": customer.bottles_owed or 0,
        "outstanding": debt_outstanding(qs.exclude(status="cleared")),
        "debt_count": qs.count(),
        "lines": lines,
    }


def supplier_balances(workspace, *, limit: int = 20) -> list[dict]:
    """What the business owes its suppliers."""
    from apps.trade.models import Supplier

    rows = (
        Supplier.objects.filter(workspace=workspace)
        .exclude(balance=0)
        .order_by("-balance")[:limit]
    )
    return [
        {"name": s.name, "contact": s.contact or "", "balance": Decimal(s.balance or 0)}
        for s in rows
    ]
