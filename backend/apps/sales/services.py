"""Checkout.

Replaces the `apply_sale_item` trigger. A checkout is one atomic unit: either the
sale, all its line items, the stock decrements and the ledger entries all land,
or none of them do. Half a sale is worse than no sale.
"""

from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.inventory.models import Product, StockTransaction
from apps.sales.models import Sale, SaleItem


def line_unit_price(product: Product, quantity: int, sale_type: str) -> Decimal:
    """Price one unit, applying wholesale and bulk-discount rules.

    Mirrors what the POS screen shows, so the server never trusts a client-sent
    price it can compute itself.
    """
    if sale_type == "wholesale" and product.wholesale_price is not None:
        price = product.wholesale_price
    else:
        price = product.unit_selling_price

    if product.bulk_min_qty and quantity >= product.bulk_min_qty:
        discount = Decimal(product.bulk_discount_percent) / Decimal(100)
        price = price * (Decimal(1) - discount)

    return price.quantize(Decimal("0.01"))


@transaction.atomic
def create_sale(
    *, workspace, cashier, items, sale_type: str = "retail",
    payment_method: str = "cash", customer_name: str = "",
) -> Sale:
    """Ring up a sale.

    `items` is a list of {product_id, quantity, unit_price?}. A client-supplied
    unit_price is honoured (manual discounts happen at the counter) but falls back
    to the computed price when absent.
    """
    if not items:
        raise ValidationError({"items": "A sale needs at least one item."})

    # Lock every product up front, ordered by id, so two concurrent checkouts of
    # the same basket can't deadlock against each other.
    product_ids = [item["product_id"] for item in items]
    products = {
        product.id: product
        for product in Product.objects.select_for_update()
        .filter(id__in=product_ids, workspace=workspace)
        .order_by("id")
    }

    missing = set(product_ids) - set(products)
    if missing:
        raise ValidationError(
            {"items": f"Unknown product(s) for this workspace: {sorted(str(m) for m in missing)}"}
        )

    sale = Sale.objects.create(
        workspace=workspace,
        sale_type=sale_type,
        payment_method=payment_method,
        customer_name=customer_name or "",
        cashier=cashier,
    )

    total_amount = Decimal("0")
    total_cost = Decimal("0")

    for item in items:
        product = products[item["product_id"]]
        quantity = int(item["quantity"])
        if quantity <= 0:
            raise ValidationError({"items": "Quantity must be greater than zero."})
        if quantity > product.stock_quantity:
            raise ValidationError(
                {"items": f"Only {product.stock_quantity} of {product.name} left in stock."}
            )

        unit_price = item.get("unit_price")
        unit_price = (
            Decimal(str(unit_price))
            if unit_price is not None
            else line_unit_price(product, quantity, sale_type)
        )
        unit_cost = product.unit_buying_price
        subtotal = (unit_price * quantity).quantize(Decimal("0.01"))

        SaleItem.objects.create(
            workspace=workspace,
            sale=sale,
            product=product,
            quantity=quantity,
            unit_price=unit_price,
            unit_cost=unit_cost,
            subtotal=subtotal,
        )

        product.stock_quantity = max(0, product.stock_quantity - quantity)
        product.save(update_fields=["stock_quantity"])

        # Audit trail, exactly as the old apply_sale_item trigger did.
        StockTransaction.objects.create(
            workspace=workspace,
            product=product,
            type="sale",
            quantity=quantity,
            notes="POS sale",
            performed_by=cashier,
        )

        total_amount += subtotal
        total_cost += (unit_cost * quantity).quantize(Decimal("0.01"))

    sale.total_amount = total_amount
    sale.total_cost = total_cost
    sale.save(update_fields=["total_amount", "total_cost"])
    return sale


@transaction.atomic
def amend_sale(
    *, sale: Sale, actor, items, sale_type=None, payment_method=None, customer_name=None
) -> Sale:
    """Correct a sale that was rung up wrong, moving stock to match.

    The counter gets things wrong — two crates keyed instead of one, the wrong
    product picked off the grid. Voiding and re-ringing loses the receipt number
    and the audit trail, so a sale is amended in place instead.

    Stock is settled on the *difference* between the old lines and the new ones:
    a quantity that drops puts the balance back on the shelf, one that rises
    takes more off it, and a line removed altogether returns all of it. The
    whole thing is one transaction, so a correction that runs out of stock
    half-way leaves the sale exactly as it was.
    """
    if not items:
        raise ValidationError({"items": "A sale needs at least one item."})

    old_lines = list(sale.items.all())
    old_quantities: dict = {}
    for line in old_lines:
        old_quantities[line.product_id] = old_quantities.get(line.product_id, 0) + line.quantity

    new_quantities: dict = {}
    for item in items:
        quantity = int(item["quantity"])
        if quantity <= 0:
            raise ValidationError({"items": "Quantity must be greater than zero."})
        new_quantities[item["product_id"]] = (
            new_quantities.get(item["product_id"], 0) + quantity
        )

    # Lock everything on either side of the correction, in id order, so an
    # amendment and a checkout cannot deadlock against each other.
    touched = set(old_quantities) | set(new_quantities)
    products = {
        product.id: product
        for product in Product.objects.select_for_update()
        .filter(id__in=touched, workspace=sale.workspace)
        .order_by("id")
    }

    missing = touched - set(products)
    if missing:
        raise ValidationError(
            {"items": f"Unknown product(s) for this workspace: {sorted(str(m) for m in missing)}"}
        )

    # Check every increase before moving anything, so a rejected amendment
    # leaves the sale and the shelf untouched.
    for product_id, wanted in new_quantities.items():
        extra = wanted - old_quantities.get(product_id, 0)
        product = products[product_id]
        if extra > 0 and extra > product.stock_quantity:
            raise ValidationError(
                {
                    "items": (
                        f"Only {product.stock_quantity} more of {product.name} "
                        "left in stock."
                    )
                }
            )

    resolved_type = sale_type or sale.sale_type

    for line in old_lines:
        line.delete()

    total_amount = Decimal("0")
    total_cost = Decimal("0")

    for item in items:
        product = products[item["product_id"]]
        quantity = int(item["quantity"])

        unit_price = item.get("unit_price")
        unit_price = (
            Decimal(str(unit_price))
            if unit_price is not None
            else line_unit_price(product, quantity, resolved_type)
        )
        unit_cost = product.unit_buying_price
        subtotal = (unit_price * quantity).quantize(Decimal("0.01"))

        SaleItem.objects.create(
            workspace=sale.workspace,
            sale=sale,
            product=product,
            quantity=quantity,
            unit_price=unit_price,
            unit_cost=unit_cost,
            subtotal=subtotal,
        )

        total_amount += subtotal
        total_cost += (unit_cost * quantity).quantize(Decimal("0.01"))

    # Settle the shelf against the net change, and leave a trail saying why.
    for product_id in sorted(touched, key=str):
        product = products[product_id]
        before = old_quantities.get(product_id, 0)
        after = new_quantities.get(product_id, 0)
        delta = after - before
        if delta == 0:
            continue

        product.stock_quantity = max(0, product.stock_quantity - delta)
        product.save(update_fields=["stock_quantity"])

        StockTransaction.objects.create(
            workspace=sale.workspace,
            product=product,
            type="adjustment",
            # Positive puts stock back, negative takes more off, so the ledger
            # reads the same way round as every other adjustment.
            quantity=-delta,
            notes=f"Sale {sale.id} corrected: {before} -> {after}",
            performed_by=actor,
        )

    sale.sale_type = resolved_type
    if payment_method is not None:
        sale.payment_method = payment_method
    if customer_name is not None:
        sale.customer_name = customer_name
    sale.total_amount = total_amount
    sale.total_cost = total_cost
    sale.save(
        update_fields=[
            "sale_type",
            "payment_method",
            "customer_name",
            "total_amount",
            "total_cost",
        ]
    )
    return sale


@transaction.atomic
def void_sale(sale: Sale) -> None:
    """Delete a sale and put its stock back.

    Deleting a sale used to just cascade the rows away and silently leave stock
    understated; returning the quantity is the part the RLS delete policy never did.
    """
    for item in sale.items.select_related("product"):
        product = Product.objects.select_for_update().get(pk=item.product_id)
        product.stock_quantity += item.quantity
        product.save(update_fields=["stock_quantity"])
        StockTransaction.objects.create(
            workspace=sale.workspace,
            product=product,
            type="adjustment",
            quantity=item.quantity,
            notes=f"Voided sale {sale.id}",
            performed_by=sale.cashier,
        )
    sale.delete()
