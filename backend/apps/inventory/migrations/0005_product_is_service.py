from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0004_product_supplier_price"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="is_service",
            field=models.BooleanField(default=False),
        ),
    ]
