"""Create or repair the platform owner's login, from the environment.

Render's free tier gives no shell, so `createsuperuser` — which wants a
terminal and someone to type into it — cannot be run at all. This is the way
in instead: set two environment variables, redeploy, and the account exists.

Run from build.sh on every deploy, which makes it the recovery path as well as
the setup path. Forgotten the password? Change the variable, redeploy, done.
That is deliberate: anyone who can edit the environment already controls the
deployment entirely, so the variable is the source of truth and the command
keeps the account matching it.

Does nothing at all when the variables are unset, so a deployment that has not
asked for a platform admin never grows one by accident.
"""

import os

from django.core.management.base import BaseCommand

from apps.accounts.models import User


class Command(BaseCommand):
    help = "Create or update the platform superuser from PLATFORM_ADMIN_* environment variables."

    def handle(self, *args, **options):
        email = os.environ.get("PLATFORM_ADMIN_EMAIL", "").strip().lower()
        password = os.environ.get("PLATFORM_ADMIN_PASSWORD", "")

        if not email or not password:
            self.stdout.write("PLATFORM_ADMIN_EMAIL/PASSWORD not set — skipping.")
            return

        if len(password) < 10:
            # A short password on an account that can read every business on the
            # platform is not worth having. Refusing is louder than warning.
            self.stderr.write("PLATFORM_ADMIN_PASSWORD must be at least 10 characters.")
            return

        user = User.objects.filter(email=email).first()
        created = user is None

        if created:
            user = User.objects.create_superuser(
                email=email,
                password=password,
                full_name=os.environ.get("PLATFORM_ADMIN_NAME", "Platform owner"),
            )
        else:
            # Promote and re-key an existing account rather than refusing: the
            # person running this owns the deployment, and a half-made admin
            # they cannot sign into helps nobody.
            user.is_superuser = True
            user.is_staff = True
            user.is_active = True
            user.email_verified = True
            user.set_password(password)
            user.save()

        # Never the password, not even masked — build logs are not private.
        self.stdout.write(
            self.style.SUCCESS(
                f"Platform admin {'created' if created else 'updated'}: {user.email}"
            )
        )
