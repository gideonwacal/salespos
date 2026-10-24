"""Keep Pamoja free now that the rest of the product is being charged for.

Migration 0008 already granted this, but only over the businesses that existed
the moment it ran, and billing has been switched off ever since — so a Pamoja
workspace registered after that point has been running on nothing but the fact
that nobody was being charged. The moment BILLING_ENABLED flips on, that shop
locks fourteen days after it was created, which for an account older than two
weeks means immediately.

Re-asserted here, against the data as it stands today.
"""

from django.db import migrations

NOTE = "Platform owner's own business — no subscription required."


def keep_pamoja_free(apps, schema_editor):
    """Matched by name, over businesses that exist right now and no others.

    A shop that registers tomorrow and calls itself Pamoja gets nothing:
    otherwise the name would be a way of helping yourself to a free
    subscription, which is a worse problem than the one this solves.

    Suspended businesses are left alone. Suspension is the platform owner
    shutting a business deliberately, and a migration must not quietly undo
    that decision.
    """
    Workspace = apps.get_model("accounts", "Workspace")
    Workspace.objects.filter(name__icontains="pamoja").exclude(access="suspended").update(
        access="free", access_note=NOTE
    )


def revoke(apps, schema_editor):
    """Only unwind what this migration would have set.

    Narrowed to the note it writes, so rolling back does not strip free access
    from a business the platform owner granted it to by hand.
    """
    Workspace = apps.get_model("accounts", "Workspace")
    Workspace.objects.filter(
        name__icontains="pamoja", access="free", access_note=NOTE
    ).update(access="standard", access_note="")


class Migration(migrations.Migration):
    dependencies = [("accounts", "0013_workspace_referral_code_and_more")]
    operations = [migrations.RunPython(keep_pamoja_free, revoke)]
