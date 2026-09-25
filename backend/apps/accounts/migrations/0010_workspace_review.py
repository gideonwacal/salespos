import django.db.models.deletion
from django.db import migrations, models
from django.utils import timezone


def mark_existing_as_reviewed(apps, schema_editor):
    """Businesses already trading here have been seen.

    Without this the queue opens full of shops that have been running for
    weeks, and a list that is wrong on its first day is a list nobody opens
    again.
    """
    Workspace = apps.get_model("accounts", "Workspace")
    Workspace.objects.filter(reviewed_at__isnull=True).update(reviewed_at=timezone.now())


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0009_email_verification"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="reviewed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="workspace",
            name="reviewed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="accounts.user",
            ),
        ),
        migrations.RunPython(mark_existing_as_reviewed, migrations.RunPython.noop),
    ]
