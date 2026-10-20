"""What the assistant is allowed to look up.

Every tool takes `(params, ctx)`. `params` is whatever the model supplied and is
treated as untrusted; `ctx` is the verified identity and is the only source of
the workspace. None of these functions accepts a business, so none of them can
be pointed at somebody else's.

Each returns a dict of already-formatted strings plus the raw figures. The model
is told to quote the formatted strings rather than restate the numbers, so a
figure cannot drift between the database and the reply.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from apps.ai.dates import DateError, resolve
from apps.ai.formatting import money, percent_change, short_money
from apps.ai.registry import ToolError, registry
from apps.expenses.services import expenses_by_category, expense_total, scoped_expenses
from apps.inventory.services import inventory_value, low_stock_products
from apps.sales.services import (
    sales_by_cashier,
    sales_by_payment_method,
    sales_totals,
    scoped_sales,
    top_products,
)
from apps.trade.services import (
    customer_statement,
    debt_outstanding,
    debtors,
    find_customer,
    open_debts,
    supplier_balances,
)

# Reused by every tool that takes a date range, so the model sees one
# consistent way of asking for one.
PERIOD_PARAM = {
    "period": {
        "type": "string",
        "description": (
            "The period in the user's own words: today, yesterday, this week, "
            "last week, this month, last month, this year, last year, a month "
            "name like 'January', 'last 30 days', or an ISO date or range such "
            "as '2026-03-01' or '2026-03-01 to 2026-03-31'. Pass the phrase, "
            "not a calculated date."
        ),
    }
}

MAX_ROWS = 25


def _period(params, ctx, default: str = "today"):
    try:
        return resolve(params.get("period") or default, ctx.tz)
    except DateError as exc:
        raise ToolError(str(exc)) from exc


def _limit(params, fallback: int = 5) -> int:
    try:
        value = int(params.get("limit") or fallback)
    except (TypeError, ValueError):
        return fallback
    return max(1, min(value, MAX_ROWS))


def _amount(params, key: str) -> Decimal | None:
    raw = params.get(key)
    if raw in (None, ""):
        return None
    try:
        return Decimal(str(raw))
    except (InvalidOperation, ValueError) as exc:
        raise ToolError(f"{raw!r} is not an amount I can work with.") from exc


def _sales_block(ctx, period) -> dict:
    """Takings for a period, with the comparable stretch before it."""
    qs = scoped_sales(ctx.workspace, period)
    totals = sales_totals(qs)
    before = sales_totals(scoped_sales(ctx.workspace, period.previous()))
    cur = ctx.currency
    return {
        "period": period.label,
        "sales": short_money(totals["revenue"], cur),
        "sales_exact": money(totals["revenue"], cur),
        "transactions": totals["count"],
        "gross_profit": short_money(totals["profit"], cur),
        "compared_with_previous": percent_change(totals["revenue"], before["revenue"]),
        "previous_period_sales": short_money(before["revenue"], cur),
        "payment_methods": [
            {"method": row["method"], "amount": short_money(row["total"], cur), "count": row["count"]}
            for row in sales_by_payment_method(qs)
        ],
    }


# --- sales -------------------------------------------------------------------


@registry.tool(
    "get_today_sales",
    "Today's takings: total sales, number of transactions, gross profit and the "
    "split between cash, mobile money and credit. Use for 'how much did I sell "
    "today' and 'how are we doing'.",
)
def get_today_sales(params, ctx):
    return _sales_block(ctx, resolve("today", ctx.tz))


@registry.tool(
    "get_sales_summary",
    "Sales totals for any period, with a comparison against the period before it.",
    parameters=PERIOD_PARAM,
)
def get_sales_summary(params, ctx):
    return _sales_block(ctx, _period(params, ctx))


@registry.tool(
    "get_sales_by_date",
    "Sales for one specific calendar date.",
    parameters={
        "date": {
            "type": "string",
            "description": "The date as the user gave it: an ISO date like 2026-03-14, or 'yesterday'.",
        }
    },
    required=("date",),
)
def get_sales_by_date(params, ctx):
    try:
        period = resolve(params.get("date"), ctx.tz)
    except DateError as exc:
        raise ToolError(str(exc)) from exc
    return _sales_block(ctx, period)


@registry.tool(
    "get_sales_comparison",
    "Compare two periods against each other, for questions like 'compare this "
    "month to last month'.",
    parameters={
        "period": PERIOD_PARAM["period"],
        "compare_to": {
            "type": "string",
            "description": "The other period, in the same words. Defaults to the stretch immediately before.",
        },
    },
    required=("period",),
)
def get_sales_comparison(params, ctx):
    first = _period(params, ctx)
    second = (
        _period({"period": params["compare_to"]}, ctx)
        if params.get("compare_to")
        else first.previous()
    )
    a = sales_totals(scoped_sales(ctx.workspace, first))
    b = sales_totals(scoped_sales(ctx.workspace, second))
    cur = ctx.currency
    return {
        "first": {
            "period": first.label,
            "sales": short_money(a["revenue"], cur),
            "transactions": a["count"],
            "profit": short_money(a["profit"], cur),
        },
        "second": {
            "period": second.label,
            "sales": short_money(b["revenue"], cur),
            "transactions": b["count"],
            "profit": short_money(b["profit"], cur),
        },
        "change": percent_change(a["revenue"], b["revenue"]),
        "difference": short_money(a["revenue"] - b["revenue"], cur),
    }


@registry.tool(
    "get_top_products",
    "Best-selling products for a period, by revenue, with how many units moved "
    "and what each made.",
    parameters={
        **PERIOD_PARAM,
        "limit": {"type": "integer", "description": "How many to return, 1-25. Default 5."},
    },
)
def get_top_products(params, ctx):
    period = _period(params, ctx, "this month")
    rows = top_products(ctx.workspace, period, limit=_limit(params))
    cur = ctx.currency
    if not rows:
        return {"period": period.label, "products": [], "note": "Nothing was sold in this period."}
    return {
        "period": period.label,
        "products": [
            {
                "name": row["name"],
                "units_sold": row["quantity"],
                "revenue": short_money(row["revenue"], cur),
                "profit": short_money(row["profit"], cur),
            }
            for row in rows
        ],
    }


# --- stock -------------------------------------------------------------------


@registry.tool(
    "get_low_stock_products",
    "Products at or below their reorder level, including those that have run "
    "out. Use for 'what is running low' and 'what should I reorder'.",
    parameters={"limit": {"type": "integer", "description": "How many to return, 1-25. Default 10."}},
)
def get_low_stock_products(params, ctx):
    rows = low_stock_products(ctx.workspace).order_by("stock_quantity", "name")
    total = rows.count()
    cur = ctx.currency
    return {
        "count": total,
        "out_of_stock": rows.filter(stock_quantity__lte=0).count(),
        "products": [
            {
                "name": p.name,
                "in_stock": p.stock_quantity,
                "reorder_level": p.reorder_level,
                "status": "out of stock" if p.stock_quantity <= 0 else "running low",
                "restock_cost": short_money(
                    Decimal(p.unit_buying_price or 0)
                    * max(0, (p.reorder_level or 0) - p.stock_quantity),
                    cur,
                ),
            }
            for p in rows[: _limit(params, 10)]
        ],
    }


@registry.tool(
    "get_inventory_value",
    "What the stock on the shelves is worth, at cost and at retail price.",
)
def get_inventory_value(params, ctx):
    data = inventory_value(ctx.workspace)
    cur = ctx.currency
    return {
        "at_cost": short_money(data["cost"], cur),
        "at_retail": short_money(data["retail"], cur),
        "potential_profit": short_money(data["retail"] - data["cost"], cur),
        "units_on_hand": data["units"],
        "product_lines": data["lines"],
        "out_of_stock_lines": data["out_of_stock"],
    }


# --- customers and credit ----------------------------------------------------


@registry.tool(
    "get_customer_debt",
    "Customers who owe money, biggest first. Use for 'who owes me money' and "
    "'who owes more than X'.",
    parameters={
        "minimum": {
            "type": "number",
            "description": "Only customers owing at least this much, in shillings.",
        },
        "limit": {"type": "integer", "description": "How many to return, 1-25. Default 10."},
    },
)
def get_customer_debt(params, ctx):
    minimum = _amount(params, "minimum")
    rows = debtors(ctx.workspace, minimum=minimum, limit=_limit(params, 10))
    cur = ctx.currency
    everything = open_debts(ctx.workspace)
    return {
        "total_outstanding": short_money(debt_outstanding(everything), cur),
        "customers_owing": len(rows),
        "minimum_applied": money(minimum, cur) if minimum is not None else None,
        "customers": [
            {"name": r["name"], "owes": short_money(r["owed"], cur), "phone": r["phone"]}
            for r in rows
        ],
    }


@registry.tool(
    "get_overdue_customers",
    "Customers whose credit is past its due date.",
    parameters={"limit": {"type": "integer", "description": "How many to return, 1-25. Default 10."}},
)
def get_overdue_customers(params, ctx):
    rows = debtors(ctx.workspace, overdue_only=True, limit=_limit(params, 10))
    cur = ctx.currency
    overdue = open_debts(ctx.workspace).filter(status="overdue")
    return {
        "total_overdue": short_money(debt_outstanding(overdue), cur),
        "customers_overdue": len(rows),
        "customers": [
            {"name": r["name"], "owes": short_money(r["owed"], cur), "phone": r["phone"]}
            for r in rows
        ],
    }


@registry.tool(
    "get_customer_statement",
    "One named customer's account: what they owe, their credit limit and their "
    "recent credit purchases.",
    parameters={"name": {"type": "string", "description": "The customer's name as the user said it."}},
    required=("name",),
)
def get_customer_statement(params, ctx):
    customer = find_customer(ctx.workspace, params.get("name", ""))
    if customer is None:
        raise ToolError(f"No customer called “{params.get('name')}” is on file.")
    data = customer_statement(ctx.workspace, customer)
    cur = ctx.currency
    return {
        "name": data["name"],
        "phone": data["phone"],
        "outstanding": short_money(data["outstanding"], cur),
        "credit_limit": short_money(data["credit_limit"], cur),
        "bottles_owed": data["bottles_owed"],
        "debts": [
            {
                "issued": str(line["issued"]),
                "due": str(line["due"]),
                "status": line["status"],
                "balance": short_money(line["balance"], cur),
                "items": line["items"],
            }
            for line in data["lines"]
        ],
    }


# --- money -------------------------------------------------------------------


@registry.tool(
    "get_profit_summary",
    "Profit for a period: revenue, cost of goods sold, expenses and what is "
    "actually left. Use for 'how much profit did I make'.",
    parameters=PERIOD_PARAM,
)
def get_profit_summary(params, ctx):
    period = _period(params, ctx, "this month")
    totals = sales_totals(scoped_sales(ctx.workspace, period))
    spent = expense_total(scoped_expenses(ctx.workspace, period))
    net = totals["profit"] - spent
    cur = ctx.currency
    return {
        "period": period.label,
        "revenue": short_money(totals["revenue"], cur),
        "cost_of_goods": short_money(totals["cost"], cur),
        "gross_profit": short_money(totals["profit"], cur),
        "expenses": short_money(spent, cur),
        "net_profit": short_money(net, cur),
        "net_profit_exact": money(net, cur),
        "margin": (
            f"{(net / totals['revenue'] * 100):.0f}%"
            if totals["revenue"] > 0
            else None
        ),
    }


@registry.tool(
    "get_expenses",
    "Expenses for a period, broken down by category.",
    parameters={
        **PERIOD_PARAM,
        "limit": {"type": "integer", "description": "How many categories, 1-25. Default 8."},
    },
)
def get_expenses(params, ctx):
    period = _period(params, ctx, "this month")
    qs = scoped_expenses(ctx.workspace, period)
    cur = ctx.currency
    return {
        "period": period.label,
        "total": short_money(expense_total(qs), cur),
        "entries": qs.count(),
        "awaiting_approval": qs.filter(status="pending").count(),
        "by_category": [
            {"category": row["category"], "amount": short_money(row["total"], cur)}
            for row in expenses_by_category(qs, limit=_limit(params, 8))
        ],
    }


@registry.tool(
    "get_supplier_balance",
    "What the business owes its suppliers.",
    parameters={"limit": {"type": "integer", "description": "How many suppliers, 1-25. Default 10."}},
)
def get_supplier_balance(params, ctx):
    rows = supplier_balances(ctx.workspace, limit=_limit(params, 10))
    cur = ctx.currency
    return {
        "suppliers_with_balance": len(rows),
        "total_owed": short_money(sum((r["balance"] for r in rows), Decimal("0")), cur),
        "suppliers": [
            {"name": r["name"], "balance": short_money(r["balance"], cur), "contact": r["contact"]}
            for r in rows
        ],
    }


# --- people ------------------------------------------------------------------


@registry.tool(
    "get_employee_performance",
    "How much each member of staff rang up over a period.",
    parameters={
        **PERIOD_PARAM,
        "limit": {"type": "integer", "description": "How many staff, 1-25. Default 10."},
    },
    owner_only=True,
)
def get_employee_performance(params, ctx):
    period = _period(params, ctx, "this month")
    rows = sales_by_cashier(ctx.workspace, period, limit=_limit(params, 10))
    cur = ctx.currency
    return {
        "period": period.label,
        "staff": [
            {
                "name": r["name"],
                "sales": short_money(r["revenue"], cur),
                "transactions": r["count"],
                "profit": short_money(r["profit"], cur),
            }
            for r in rows
        ],
    }


@registry.tool(
    "get_branch_performance",
    "Compare the performance of different branches of the business.",
    parameters=PERIOD_PARAM,
    owner_only=True,
)
def get_branch_performance(params, ctx):
    """There are no branches in this system, and saying so is the honest answer.

    SalesPos has one workspace per business with no sub-locations, so there is
    nothing to compare. Inventing a split — by cashier, say, and calling it a
    branch — would produce a confident answer to a question the data cannot
    support. The nearest real figure is offered instead.
    """
    period = _period(params, ctx, "this month")
    rows = sales_by_cashier(ctx.workspace, period, limit=10)
    cur = ctx.currency
    return {
        "branches_configured": 0,
        "note": (
            "This business is not set up with separate branches, so there is "
            "nothing to compare between them. Here is the breakdown by member "
            "of staff instead."
        ),
        "period": period.label,
        "by_staff": [
            {"name": r["name"], "sales": short_money(r["revenue"], cur), "transactions": r["count"]}
            for r in rows
        ],
    }


# --- actions -----------------------------------------------------------------
#
# These change something or reach a third party. None of them runs when the
# model asks for it: the request is previewed against real data, the person is
# shown what it would do, and only a plain yes from them sets it going. The
# machinery for that is in agent.py; what lives here is the description and
# the work itself.


def _reminder_targets(params, ctx):
    minimum = _amount(params, "minimum")
    overdue_only = bool(params.get("overdue_only"))
    rows = debtors(
        ctx.workspace, minimum=minimum, overdue_only=overdue_only, limit=MAX_ROWS
    )
    return [r for r in rows if r["phone"]], [r for r in rows if not r["phone"]], minimum


def preview_payment_reminder(params, ctx):
    reachable, no_phone, minimum = _reminder_targets(params, ctx)
    cur = ctx.currency

    if not reachable and not no_phone:
        return {"answer": "Nobody matches that — there is no one to remind."}
    if not reachable:
        return {
            "answer": (
                f"{len(no_phone)} customer(s) match, but none of them has a phone "
                "number on file, so I cannot message them."
            )
        }

    owed = sum((r["owed"] for r in reachable), Decimal("0"))
    threshold = f" owing more than {money(minimum, cur)}" if minimum is not None else ""
    question = (
        f"I found {len(reachable)} customer(s){threshold} with "
        f"{short_money(owed, cur)} outstanding.\n\n"
        f"Shall I send them each a payment reminder?"
    )
    if no_phone:
        question += f"\n\n({len(no_phone)} more have no phone number and will be skipped.)"
    return {"question": question, "params": dict(params)}


@registry.tool(
    "send_payment_reminder",
    "Send a payment reminder over WhatsApp to customers who owe money. Always "
    "confirms with the user before sending anything.",
    parameters={
        "minimum": {
            "type": "number",
            "description": "Only remind customers owing at least this much, in shillings.",
        },
        "overdue_only": {
            "type": "boolean",
            "description": "Only remind customers whose credit is past its due date.",
        },
    },
    owner_only=True,
    writes=True,
    preview=preview_payment_reminder,
)
def send_payment_reminder(params, ctx):
    """Actually send them. Only ever reached through a confirmed PendingAction."""
    from django.conf import settings

    from apps.ai.whatsapp import get_whatsapp_provider

    reachable, skipped, _minimum = _reminder_targets(params, ctx)
    if not reachable:
        return {"message": "Nothing to send — nobody matches any more."}

    # Meta does not allow a business to open a conversation with free text: an
    # approved template is required. Without one configured this would fail
    # silently per customer, so it is refused up front with the reason.
    if not settings.WHATSAPP_REMINDER_TEMPLATE:
        raise ToolError(
            "I can't send reminders yet — WhatsApp needs an approved message "
            "template before a business can start a conversation with a "
            "customer. Ask your administrator to set one up."
        )

    provider = get_whatsapp_provider()
    sent, failed = 0, 0
    for row in reachable:
        body = (
            f"Hello {row['name']}, this is a reminder from {ctx.workspace.name}. "
            f"Your balance is {money(row['owed'], ctx.currency)}. "
            "Thank you."
        )
        if provider.send(row["phone"], body):
            sent += 1
        else:
            failed += 1

    message = f"✅ Sent {sent} reminder(s)."
    if failed:
        message += f" {failed} could not be delivered."
    if skipped:
        message += f" {len(skipped)} had no phone number."
    return {"message": message, "sent": sent, "failed": failed}
