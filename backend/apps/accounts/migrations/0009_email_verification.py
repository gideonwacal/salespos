import uuid

import django.db.models.deletion
from django.db import migrations, models


def grandfather_existing_users(apps, schema_editor):
    """Everyone already here counts as verified.

    Turning the check on retroactively would shut every existing owner out of
    their own shop at the moment of deploy, waiting on an email from a mail
    server that may not be configured yet. The check is for accounts made from
    now on; the people already trading have proved themselves by trading.
    """
    User = apps.get_model("accounts", "User")
    User.objects.update(email_verified=True)


def unverify(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.update(email_verified=False)


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0008_pamoja_free_access"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="email_verified",
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name="EmailVerification",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("token", models.CharField(db_index=True, max_length=64, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="verifications",
                        to="accounts.user",
                    ),
                ),
            ],
            options={
                "db_table": "email_verifications",
                "ordering": ["-created_at"],
            },
        ),
        migrations.RunPython(grandfather_existing_users, unverify),
    ]
