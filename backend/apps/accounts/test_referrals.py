"""The trial, the 25,000 subscription, and the three days five signups buy."""

from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts import referrals
from apps.accounts.models import (
    REFERRAL_GRACE_DAYS,
    REFERRALS_FOR_GRACE,
    SUBSCRIPTION_MONTHS,
    SUBSCRIPTION_PRICE_UGX,
    Membership,
    Referral,
    ReferralVisit,
    SubscriptionPayment,
    User,
    Workspace,
    subscription_price,
)


def a_business(name="Nakawa Traders", **kw):
    return Workspace.objects.create(name=name, **kw)


@override_settings(BILLING_ENABLED=True)
class PricingTests(APITestCase):
    def test_the_subscription_is_25000_for_three_months(self):
        self.assertEqual(SUBSCRIPTION_PRICE_UGX, 25_000)
        self.assertEqual(SUBSCRIPTION_MONTHS, 3)

    def test_the_price_is_not_multiplied_by_the_months(self):
        """25,000 buys three months. Billing 75,000 for it would be theft."""
        self.assertEqual(subscription_price("standard", 3), 25_000)
        self.assertEqual(subscription_price(), 25_000)

    def test_approving_a_payment_adds_three_months(self):
        workspace = a_business()
        user = User.objects.create_user(email="o@n.com", password="sup3rsecret!")
        payment = SubscriptionPayment.objects.create(
            workspace=workspace, submitted_by=user, plan="standard", months=3,
            amount=Decimal("25000"), payer_phone="0772000111", transaction_id="TX1",
        )
        payment.approve()
        workspace.refresh_from_db()
        self.assertTrue(workspace.subscribed)
        self.assertFalse(workspace.locked)
        days = (workspace.paid_until - timezone.now()).days
        self.assertGreater(days, 85)
        self.assertLess(days, 95)


@override_settings(BILLING_ENABLED=True)
class TrialAndLockTests(APITestCase):
    def test_a_new_business_gets_14_days(self):
        workspace = a_business()
        days = (workspace.trial_ends - timezone.now()).days
        self.assertIn(days, (13, 14))
        self.assertFalse(workspace.locked)

    def test_it_locks_when_the_trial_runs_out(self):
        workspace = a_business(trial_ends=timezone.now() - timedelta(minutes=1))
        self.assertTrue(workspace.locked)

    def test_the_referral_grace_unlocks_it(self):
        workspace = a_business(
            trial_ends=timezone.now() - timedelta(days=1),
            referral_grace_until=timezone.now() + timedelta(days=2),
        )
        self.assertFalse(workspace.locked)
        self.assertTrue(workspace.on_referral_grace)

    def test_it_locks_again_when_the_grace_runs_out(self):
        workspace = a_business(
            trial_ends=timezone.now() - timedelta(days=10),
            referral_grace_until=timezone.now() - timedelta(minutes=1),
            referral_grace_granted_at=timezone.now() - timedelta(days=3),
        )
        self.assertTrue(workspace.locked)

    def test_free_access_still_never_locks(self):
        workspace = a_business(
            access="free", trial_ends=timezone.now() - timedelta(days=100)
        )
        self.assertFalse(workspace.locked)

    def test_suspension_beats_everything(self):
        workspace = a_business(
            access="suspended", referral_grace_until=timezone.now() + timedelta(days=3)
        )
        self.assertTrue(workspace.locked)


class ReferralMechanicTests(APITestCase):
    def setUp(self):
        self.referrer = a_business("Nakawa Traders")
        self.code = referrals.code_for(self.referrer)

    def refer(self, n):
        for i in range(n):
            referrals.attribute(
                referrer=self.referrer, referred=a_business(f"Shop {i}")
            )
        self.referrer.refresh_from_db()

    def test_a_code_is_stable_once_issued(self):
        self.assertEqual(referrals.code_for(self.referrer), self.code)
        self.assertEqual(len(self.code), 7)

    def test_the_code_avoids_characters_that_get_misread(self):
        for _ in range(40):
            code = referrals.code_for(a_business("x"))
            self.assertFalse(set(code) & set("AEIOU01IL"), code)

    def test_four_signups_is_not_enough(self):
        self.refer(4)
        self.assertIsNone(self.referrer.referral_grace_granted_at)
        self.assertFalse(self.referrer.on_referral_grace)

    def test_the_fifth_signup_grants_the_grace(self):
        self.refer(REFERRALS_FOR_GRACE)
        self.assertIsNotNone(self.referrer.referral_grace_granted_at)
        self.assertTrue(self.referrer.on_referral_grace)

    def test_the_grace_starts_after_the_trial_not_during_it(self):
        """Reaching five on day two must not burn the reward before it is useful."""
        self.refer(REFERRALS_FOR_GRACE)
        expected = self.referrer.trial_ends + timedelta(days=REFERRAL_GRACE_DAYS)
        self.assertAlmostEqual(
            self.referrer.referral_grace_until.timestamp(), expected.timestamp(), delta=5
        )

    def test_it_is_granted_once_and_once_only(self):
        self.refer(REFERRALS_FOR_GRACE)
        first = self.referrer.referral_grace_until
        self.refer(REFERRALS_FOR_GRACE)  # five more
        self.assertEqual(self.referrer.referral_grace_until, first)

    def test_opens_alone_never_unlock_anything(self):
        """Five private windows must not buy three days."""
        factory = self.client
        for _ in range(20):
            factory.post("/api/referrals/visit/", {"code": self.code}, format="json")
        self.referrer.refresh_from_db()
        self.assertIsNone(self.referrer.referral_grace_granted_at)
        self.assertGreater(ReferralVisit.objects.count(), 0)

    def test_a_business_cannot_refer_itself(self):
        self.assertIsNone(
            referrals.attribute(referrer=self.referrer, referred=self.referrer)
        )
        self.assertEqual(Referral.objects.count(), 0)

    def test_a_business_is_somebody_s_referral_only_once(self):
        other = a_business("Other Referrer")
        newcomer = a_business("Newcomer")
        self.assertIsNotNone(referrals.attribute(referrer=self.referrer, referred=newcomer))
        self.assertIsNone(referrals.attribute(referrer=other, referred=newcomer))
        self.assertEqual(Referral.objects.count(), 1)

    def test_distinct_visitors_are_counted_separately_from_opens(self):
        self.client.post("/api/referrals/visit/", {"code": self.code}, format="json")
        self.client.post("/api/referrals/visit/", {"code": self.code}, format="json")
        data = referrals.counts(self.referrer)
        self.assertEqual(data["total_opens"], 2)
        self.assertEqual(data["opens"], 1)  # same browser both times


class ReferralApiTests(APITestCase):
    def setUp(self):
        self.workspace = a_business()
        self.owner = User.objects.create_user(
            email="owner@n.com", password="sup3rsecret!", email_verified=True
        )
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")
        self.staff = User.objects.create_user(
            email="staff@n.com", password="sup3rsecret!", email_verified=True
        )
        Membership.objects.create(user=self.staff, workspace=self.workspace, role="manager")
        self.headers = {"HTTP_X_WORKSPACE": str(self.workspace.id)}

    def test_the_owner_gets_a_link_and_a_scoreboard(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/referrals/me/", **self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["code"])
        self.assertIn(response.data["code"], response.data["link"])
        self.assertEqual(response.data["signups"], 0)
        self.assertEqual(response.data["remaining"], REFERRALS_FOR_GRACE)

    def test_staff_cannot_see_it(self):
        self.client.force_authenticate(self.staff)
        response = self.client.get("/api/referrals/me/", **self.headers)
        self.assertEqual(response.status_code, 403)

    def test_an_unknown_code_answers_the_same_as_a_real_one(self):
        """Otherwise the endpoint is a way of enumerating which codes exist."""
        real = referrals.code_for(self.workspace)
        good = self.client.post("/api/referrals/visit/", {"code": real}, format="json")
        bad = self.client.post("/api/referrals/visit/", {"code": "ZZZZZZZ"}, format="json")
        self.assertEqual(good.status_code, bad.status_code)
        self.assertEqual(good.data["ok"], bad.data["ok"])

    def test_the_owner_sees_who_signed_up(self):
        newcomer = a_business("Brought In Ltd")
        referrals.attribute(referrer=self.workspace, referred=newcomer)
        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/referrals/me/", **self.headers)
        names = [b["name"] for b in response.data["businesses"]]
        self.assertEqual(names, ["Brought In Ltd"])


class SignupAttributionTests(APITestCase):
    def setUp(self):
        self.referrer = a_business("Nakawa Traders")
        self.code = referrals.code_for(self.referrer)

    def register(self, **overrides):
        return self.client.post(
            "/api/auth/register/",
            {
                "email": "new@shop.com", "password": "sup3rsecret!",
                "full_name": "Sam", "business_name": "New Shop", **overrides,
            },
            format="json",
        )

    def test_signing_up_through_a_link_credits_the_referrer(self):
        self.assertEqual(self.register(referral_code=self.code).status_code, 201)
        self.assertEqual(Referral.objects.filter(referrer=self.referrer).count(), 1)

    def test_the_code_is_case_insensitive(self):
        self.register(referral_code=self.code.lower())
        self.assertEqual(Referral.objects.count(), 1)

    def test_an_unknown_code_does_not_block_the_signup(self):
        """A stranger's typo must never be the reason a business cannot open."""
        self.assertEqual(self.register(referral_code="NOPE999").status_code, 201)
        self.assertEqual(Referral.objects.count(), 0)
        self.assertTrue(Workspace.objects.filter(name="New Shop").exists())

    def test_signing_up_with_no_code_is_normal(self):
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(Referral.objects.count(), 0)

    def test_the_fifth_signup_through_a_link_unlocks_the_referrer(self):
        for i in range(REFERRALS_FOR_GRACE):
            self.client.post(
                "/api/auth/register/",
                {
                    "email": f"s{i}@shop.com", "password": "sup3rsecret!",
                    "full_name": "S", "business_name": f"Shop {i}",
                    "referral_code": self.code,
                },
                format="json",
            )
        self.referrer.refresh_from_db()
        self.assertTrue(self.referrer.on_referral_grace)


@override_settings(BILLING_ENABLED=True)
class PamojaFreeAccessTests(APITestCase):
    """The platform owner's own business runs on the product without paying."""

    def test_pamoja_never_locks_however_old_it_gets(self):
        pamoja = a_business(
            "Pamoja Traders",
            access="free",
            trial_ends=timezone.now() - timedelta(days=400),
        )
        self.assertFalse(pamoja.locked)
        self.assertFalse(pamoja.subscribed)

    def test_an_ordinary_business_of_the_same_age_does_lock(self):
        """So the test above is proving free access, not a broken lock."""
        other = a_business("Someone Else", trial_ends=timezone.now() - timedelta(days=400))
        self.assertTrue(other.locked)

    def test_free_access_outranks_an_exhausted_referral_grace(self):
        pamoja = a_business(
            "Pamoja Traders",
            access="free",
            trial_ends=timezone.now() - timedelta(days=400),
            referral_grace_until=timezone.now() - timedelta(days=10),
            referral_grace_granted_at=timezone.now() - timedelta(days=13),
        )
        self.assertFalse(pamoja.locked)

    def test_the_migration_grants_it(self):
        """Runs the data migration's own function against today's rows.

        Imported by string because the module name starts with a digit, which
        is not a legal identifier for a normal import.
        """
        from importlib import import_module

        from django.apps import apps as django_apps

        module = import_module("apps.accounts.migrations.0014_pamoja_stays_free")

        pamoja = a_business("Pamoja Traders")
        stranger = a_business("Totally Unrelated Ltd")
        suspended = a_business("Pamoja Branch Two", access="suspended")

        module.keep_pamoja_free(django_apps, None)

        pamoja.refresh_from_db()
        stranger.refresh_from_db()
        suspended.refresh_from_db()

        self.assertEqual(pamoja.access, "free")
        self.assertFalse(pamoja.locked)
        # Everyone else is untouched...
        self.assertEqual(stranger.access, "standard")
        # ...and a deliberate suspension is not quietly undone.
        self.assertEqual(suspended.access, "suspended")
