import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("inventory", "0005_product_is_service"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="part_number",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="product",
            name="brand",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="product",
            name="shelf_location",
            field=models.CharField(blank=True, default="", max_length=60),
        ),
        migrations.CreateModel(
            name="VehicleFit",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("make", models.CharField(max_length=60)),
                ("model", models.CharField(blank=True, default="", max_length=80)),
                ("year_from", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("year_to", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("engine", models.CharField(blank=True, default="", max_length=60)),
                ("note", models.CharField(blank=True, default="", max_length=160)),
                (
                    "product",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="fits",
                        to="inventory.product",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="vehiclefits",
                        to="accounts.workspace",
                    ),
                ),
            ],
            options={
                "db_table": "vehicle_fits",
                "ordering": ["make", "model", "year_from"],
            },
        ),
        migrations.AddIndex(
            model_name="vehiclefit",
            index=models.Index(
                fields=["workspace", "make", "model"], name="vehicle_fits_ws_make_idx"
            ),
        ),
    ]
