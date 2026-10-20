"""Expense aggregation, shared by the summary endpoint and the assistant."""

from decimal import Decimal

from django.db.models import Sum

from apps.expenses.models import Expense


def scoped_expenses(workspace, period=None, *, approved_only: bool = False):
    """Expenses for one workspace, optionally within a period.

    Filtered on `expense_date` — the day the money was spent — rather than
    `created_at`, which is only when somebody got round to typing it in.
    """
    qs = Expense.objects.filter(workspace=workspace)
    if period is not None:
        qs = qs.filter(
            expense_date__gte=period.start_date, expense_date__lte=period.last_date
        )
    if approved_only:
        qs = qs.filter(status="approved")
    return qs


def expense_total(qs) -> Decimal:
    return qs.aggregate(total=Sum("amount"))["total"] or Decimal("0")


def expenses_by_category(qs, *, limit: int = 10) -> list[dict]:
    rows = qs.values("category").annotate(total=Sum("amount")).order_by("-total")[:limit]
    return [
        {"category": row["category"] or "Uncategorised", "total": row["total"] or Decimal("0")}
        for row in rows
    ]
