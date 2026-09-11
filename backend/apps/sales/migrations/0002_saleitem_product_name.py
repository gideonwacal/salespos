"""Let a sold product be deleted without taking the sale with it.

SaleItem protected the product, so the owner could never remove an item that
had ever been sold. The line now snapshots the name and lets the foreign key go
null, which keeps every figure on the sale intact when the shelf is cleared.
"""

import django.db.models.deletion
from django.db import migrations, models


def snapshot_names(apps, schema_editor):
    """Fill the new column from the products the lines still point at."""
    SaleItem = apps.get_model("sales", "SaleItem")
    Product = apps.get_model("inventory", "Product")
    names = dict(Product.objects.values_list("pk", "name"))

    rows = []
    for item in SaleItem.objects.all().only("pk", "product_id", "product_name"):
        item.product_name = names.get(item.product_id, "") or ""
        rows.append(item)
    if rows:
        SaleItem.objects.bulk_update(rows, ["product_name"], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0001_initial"),
        ("inventory", "0004_product_supplier_price"),
    ]

    operations = [
        migrations.AddField(
            model_name="saleitem",
            name="product_name",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.RunPython(snapshot_names, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="saleitem",
            name="product",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sale_items",
                to="inventory.product",
            ),
        ),
    ]
