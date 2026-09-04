"""Stock movement rules.

These were Postgres triggers under Supabase (`apply_stock_transaction`,
`apply_damage_report`, `sync_product_expiry`). They are plain functions here so
they can be unit-tested and read without a psql session. Every one of them takes
a row lock on the product, so two concurrent sales cannot both read the same
starting quantity and lose a decrement.
"""

from django.db import transaction
from django.db.models import F

from apps.inventory.models import DamageReport, Product, StockTransaction


def signed_delta(txn_type: str, quantity: int) -> int:
    """How a transaction of this type changes stock on hand.

    stock_in and adjustment add (an adjustment may be negative); sale and damage
    always subtract, regardless of the sign the client sent.
    """
    if txn_type in ("stock_in", "adjustment"):
        return quantity
    return -abs(quantity)


@transaction.atomic
def apply_stock_delta(product_id, workspace, delta: int) -> Product:
    """Move a product's stock by `delta`, clamped at zero."""
    product = Product.objects.select_for_update().get(
        pk=product_id, workspace=workspace
    )
    product.stock_quantity = max(0, product.stock_quantity + delta)
    product.save(update_fields=["stock_quantity"])
    return product


@transaction.atomic
def record_stock_transaction(
    *, workspace, product, type: str, quantity: int, notes: str = "",
    expiry_date=None, performed_by=None,
) -> StockTransaction:
    """File a stock transaction and move the product's quantity to match."""
    txn = StockTransaction.objects.create(
        workspace=workspace,
        product=product,
        type=type,
        quantity=quantity,
        notes=notes,
        expiry_date=expiry_date,
        performed_by=performed_by,
    )

    apply_stock_delta(product.pk, workspace, signed_delta(type, quantity))

    # Restocking with a new expiry date updates the product's date, matching the
    # old sync_product_expiry trigger.
    if expiry_date and type == "stock_in":
        Product.objects.filter(pk=product.pk, workspace=workspace).update(
            expiry_date=expiry_date
        )

    txn.refresh_from_db()
    return txn


@transaction.atomic
def record_damage(
    *, workspace, product, quantity: int, reason: str = "", photo_url=None,
    reported_by=None,
) -> DamageReport:
    """Write off damaged stock and leave an audit trail in stock_transactions."""
    report = DamageReport.objects.create(
        workspace=workspace,
        product=product,
        quantity=quantity,
        reason=reason,
        photo_url=photo_url,
        reported_by=reported_by,
    )

    StockTransaction.objects.create(
        workspace=workspace,
        product=product,
        type="damage",
        quantity=quantity,
        notes=reason or "Damaged goods",
        performed_by=reported_by,
    )
    apply_stock_delta(product.pk, workspace, -abs(quantity))
    return report


def low_stock_products(workspace):
    """Products at or below their reorder level."""
    return Product.objects.filter(
        workspace=workspace, stock_quantity__lte=F("reorder_level")
    )
