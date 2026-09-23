from django.db import migrations


def grant_pamoja_free_access(apps, schema_editor):
    """Pamoja runs on its own product without paying for it.

    Matched by name, and only over businesses that already exist when this
    migration runs. A shop that registers afterwards and calls itself Pamoja
    gets nothing — otherwise the name would be a way of helping yourself to a
    free subscription.
    """
    Workspace = apps.get_model("accounts", "Workspace")
    Workspace.objects.filter(name__icontains="pamoja").exclude(access="suspended").update(
        access="free",
        access_note="Platform owner's own business — no subscription required.",
    )


def revoke(apps, schema_editor):
    Workspace = apps.get_model("accounts", "Workspace")
    Workspace.objects.filter(
        name__icontains="pamoja", access="free"
    ).update(access="standard", access_note="")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0007_subscription_payment_networks"),
    ]

    operations = [
        migrations.RunPython(grant_pamoja_free_access, revoke),
    ]
