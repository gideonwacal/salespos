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


@transaction.atomic
def clear_store(*, workspace, mode: str, performed_by=None) -> dict:
    """Empty the shop in one move: the owner's reset button.

    Two modes, because "clear the store" means two different things. `zero`
    takes every shelf to nothing and keeps the price list — a stock take that
    starts from scratch. `delete` removes the products themselves.

    Either way the write-off is filed as an adjustment per product first, so the
    stock ledger still explains where the quantity went; a shelf that empties
    with no movement behind it is indistinguishable from theft.

    Products that appear on a past sale are never deleted. SaleItem protects
    them, and rightly: deleting one would take a line of sales history with it.
    They are zeroed and reported back as kept.
    """
    if mode not in ("zero", "delete"):
        raise ValueError("mode must be 'zero' or 'delete'")

    from apps.sales.models import SaleItem

    products = list(Product.objects.select_for_update().filter(workspace=workspace))

    zeroed = 0
    for product in products:
        if product.stock_quantity == 0:
            continue
        StockTransaction.objects.create(
            workspace=workspace,
            product=product,
            type="adjustment",
            quantity=-product.stock_quantity,
            notes="Store cleared by the owner",
            performed_by=performed_by,
        )
        product.stock_quantity = 0
        product.save(update_fields=["stock_quantity"])
        zeroed += 1

    if mode == "zero":
        return {"mode": mode, "zeroed": zeroed, "deleted": 0, "kept": 0}

    sold = set(
        SaleItem.objects.filter(workspace=workspace).values_list("product_id", flat=True)
    )
    removable = [p.pk for p in products if p.pk not in sold]
    Product.objects.filter(workspace=workspace, pk__in=removable).delete()

    return {
        "mode": mode,
        "zeroed": zeroed,
        "deleted": len(removable),
        "kept": len(products) - len(removable),
    }
