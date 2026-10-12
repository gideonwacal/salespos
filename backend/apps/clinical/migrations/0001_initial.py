import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("accounts", "0001_initial"),
        ("inventory", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Patient",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("patient_number", models.CharField(max_length=20)),
                ("full_name", models.CharField(max_length=200)),
                ("sex", models.CharField(blank=True, choices=[("female", "Female"), ("male", "Male"), ("other", "Other")], default="", max_length=10)),
                ("date_of_birth", models.DateField(blank=True, null=True)),
                ("stated_age", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("phone", models.CharField(blank=True, default="", max_length=40)),
                ("village", models.CharField(blank=True, default="", max_length=200)),
                ("nin", models.CharField(blank=True, default="", max_length=32)),
                ("next_of_kin_name", models.CharField(blank=True, default="", max_length=200)),
                ("next_of_kin_phone", models.CharField(blank=True, default="", max_length=40)),
                ("allergies", models.TextField(blank=True, default="")),
                ("notes", models.TextField(blank=True, default="")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="patients", to="accounts.workspace")),
            ],
            options={"db_table": "patients", "ordering": ["full_name"]},
        ),
        migrations.CreateModel(
            name="Visit",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("status", models.CharField(choices=[("waiting", "Waiting"), ("in_consultation", "With the clinician"), ("to_dispense", "Waiting for medicine"), ("closed", "Closed")], default="waiting", max_length=20)),
                ("complaint", models.TextField(blank=True, default="")),
                ("temperature", models.DecimalField(blank=True, decimal_places=1, max_digits=4, null=True)),
                ("blood_pressure", models.CharField(blank=True, default="", max_length=20)),
                ("pulse", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("weight", models.DecimalField(blank=True, decimal_places=1, max_digits=5, null=True)),
                ("examination", models.TextField(blank=True, default="")),
                ("diagnosis", models.TextField(blank=True, default="")),
                ("treatment_plan", models.TextField(blank=True, default="")),
                ("closed_at", models.DateTimeField(blank=True, null=True)),
                ("clinician", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="visits", to="accounts.user")),
                ("patient", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="visits", to="clinical.patient")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="visits", to="accounts.workspace")),
            ],
            options={"db_table": "visits", "ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="Prescription",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("medicine", models.CharField(max_length=200)),
                ("dose", models.CharField(blank=True, default="", max_length=120)),
                ("frequency", models.CharField(blank=True, default="", max_length=120)),
                ("duration", models.CharField(blank=True, default="", max_length=120)),
                ("instructions", models.CharField(blank=True, default="", max_length=255)),
                ("quantity_ordered", models.PositiveIntegerField(default=0)),
                ("quantity_dispensed", models.PositiveIntegerField(default=0)),
                ("dispensed_at", models.DateTimeField(blank=True, null=True)),
                ("dispensed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="dispensed", to="accounts.user")),
                ("patient", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="prescriptions", to="clinical.patient")),
                ("product", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="prescriptions", to="inventory.product")),
                ("visit", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="prescriptions", to="clinical.visit")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="prescriptions", to="accounts.workspace")),
            ],
            options={"db_table": "prescriptions", "ordering": ["created_at"]},
        ),
        migrations.AddConstraint(
            model_name="patient",
            constraint=models.UniqueConstraint(fields=("workspace", "patient_number"), name="uniq_patient_number_per_workspace"),
        ),
        migrations.AddIndex(
            model_name="patient",
            index=models.Index(fields=["workspace", "full_name"], name="patients_ws_name_idx"),
        ),
        migrations.AddIndex(
            model_name="patient",
            index=models.Index(fields=["workspace", "patient_number"], name="patients_ws_number_idx"),
        ),
        migrations.AddIndex(
            model_name="visit",
            index=models.Index(fields=["workspace", "status", "-created_at"], name="visits_ws_status_idx"),
        ),
        migrations.AddIndex(
            model_name="prescription",
            index=models.Index(fields=["workspace", "-created_at"], name="rx_ws_created_idx"),
        ),
    ]
