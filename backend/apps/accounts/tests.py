"""Auth and multi-tenant isolation — the RLS replacement."""

from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import (
    PLAN_PRICES_UGX,
    Membership,
    SubscriptionPayment,
    User,
    Workspace,
)
from apps.accounts.views import approve_flutterwave_payment
from apps.inventory.models import Product


class RegistrationTests(APITestCase):
    def test_register_creates_user_workspace_and_owner_membership(self):
        response = self.client.post(
            reverse("register"),
            {
                "email": "Owner@Example.com",
                "password": "sup3rsecret!",
                "full_name": "Jane Owner",
                "business_name": "Pamoja Traders",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertIn("access", response.data)
        self.assertEqual(response.data["role"], "owner")

        user = User.objects.get(email="owner@example.com")  # normalised to lowercase
        self.assertEqual(Workspace.objects.count(), 1)
        self.assertTrue(
            Membership.objects.filter(user=user, role="owner").exists()
        )

    def test_duplicate_email_is_rejected(self):
        User.objects.create_user(email="taken@example.com", password="sup3rsecret!")
        response = self.client.post(
            reverse("register"),
            {
                "email": "taken@example.com",
                "password": "sup3rsecret!",
                "full_name": "Someone",
                "business_name": "Another Shop",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_weak_password_is_rejected(self):
        response = self.client.post(
            reverse("register"),
            {
                "email": "weak@example.com",
                "password": "password",
                "full_name": "Someone",
                "business_name": "Shop",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class TenantIsolationTests(APITestCase):
    """The whole point of multi-tenancy: workspace A must never see workspace B."""

    def setUp(self):
        self.alice = User.objects.create_user(
            email="alice@example.com", password="sup3rsecret!"
        )
        self.bob = User.objects.create_user(
            email="bob@example.com", password="sup3rsecret!"
        )
        self.shop_a = Workspace.objects.create(name="Shop A")
        self.shop_b = Workspace.objects.create(name="Shop B")
        Membership.objects.create(user=self.alice, workspace=self.shop_a, role="owner")
        Membership.objects.create(user=self.bob, workspace=self.shop_b, role="owner")

        self.product_a = Product.objects.create(
            workspace=self.shop_a, name="Alice Sugar", stock_quantity=5
        )
        self.product_b = Product.objects.create(
            workspace=self.shop_b, name="Bob Sugar", stock_quantity=5
        )

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def test_listing_products_only_returns_own_workspace(self):
        self.auth(self.alice)
        response = self.client.get("/api/products/")
        self.assertEqual(response.status_code, 200)
        names = [row["name"] for row in response.data["results"]]
        self.assertEqual(names, ["Alice Sugar"])

    def test_cannot_read_another_workspace_by_id(self):
        self.auth(self.alice)
        response = self.client.get(f"/api/products/{self.product_b.id}/")
        self.assertEqual(response.status_code, 404)

    def test_forged_workspace_header_is_refused(self):
        self.auth(self.alice)
        response = self.client.get(
            "/api/products/", headers={"x-workspace": str(self.shop_b.id)}
        )
        self.assertEqual(response.status_code, 403)

    def test_created_products_land_in_the_callers_workspace(self):
        self.auth(self.alice)
        response = self.client.post(
            "/api/products/",
            {"name": "New Item", "unit_selling_price": "1000"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        product = Product.objects.get(name="New Item")
        self.assertEqual(product.workspace, self.shop_a)

    def test_anonymous_requests_are_rejected(self):
        response = self.client.get("/api/products/")
        self.assertEqual(response.status_code, 401)


class RolePermissionTests(APITestCase):
    """Only owners delete — the `owner deletes ...` policies."""

    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner@example.com", password="sup3rsecret!"
        )
        self.manager = User.objects.create_user(
            email="manager@example.com", password="sup3rsecret!"
        )
        self.workspace = Workspace.objects.create(name="Shop")
        Membership.objects.create(
            user=self.owner, workspace=self.workspace, role="owner"
        )
        Membership.objects.create(
            user=self.manager, workspace=self.workspace, role="manager"
        )
        self.product = Product.objects.create(
            workspace=self.workspace,
            name="Sugar",
            unit_selling_price=Decimal("5000"),
            stock_quantity=10,
        )

    def test_manager_cannot_delete_a_product(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.delete(f"/api/products/{self.product.id}/")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Product.objects.filter(pk=self.product.pk).exists())

    def test_owner_can_delete_a_product(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.delete(f"/api/products/{self.product.id}/")
        self.assertEqual(response.status_code, 204)

    def test_manager_can_still_create_and_update(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.patch(
            f"/api/products/{self.product.id}/",
            {"stock_quantity": 12},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_user_with_no_membership_gets_403(self):
        stranger = User.objects.create_user(
            email="stranger@example.com", password="sup3rsecret!"
        )
        self.client.force_authenticate(user=stranger)
        response = self.client.get("/api/products/")
        self.assertEqual(response.status_code, 403)


@override_settings(SUBSCRIPTION_MOMO_NUMBER="0770000000", SUBSCRIPTION_MOMO_NAME="Test")
class SubscriptionPaymentTests(APITestCase):
    """Shops report a mobile money payment; only an approval changes the plan."""

    def setUp(self):
        self.owner = User.objects.create_user(email="owner@shop.com", password="sup3rsecret!")
        self.manager = User.objects.create_user(email="mgr@shop.com", password="sup3rsecret!")
        self.workspace = Workspace.objects.create(name="Shop")
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")
        Membership.objects.create(user=self.manager, workspace=self.workspace, role="manager")

    def submit(self, user, **overrides):
        self.client.force_authenticate(user=user)
        body = {
            "plan": "growth",
            "months": 3,
            "payer_phone": "0771 234 567",
            "transaction_id": "abc123456",
            "amount": 1,
            **overrides,
        }
        return self.client.post("/api/subscription-payments/", body, format="json")

    def test_owner_submission_is_priced_by_the_server_and_stays_pending(self):
        response = self.submit(self.owner)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Decimal(response.data["amount"]), PLAN_PRICES_UGX["growth"] * 3)
        self.assertEqual(response.data["status"], "pending")
        self.assertEqual(response.data["transaction_id"], "ABC123456")
        self.workspace.refresh_from_db()
        self.assertFalse(self.workspace.subscribed)

    def test_manager_cannot_submit(self):
        self.assertEqual(self.submit(self.manager).status_code, 403)

    def test_a_transaction_id_can_only_be_used_once(self):
        self.submit(self.owner)
        self.assertEqual(self.submit(self.owner, transaction_id="ABC123456").status_code, 400)

    def test_approval_activates_the_plan_and_stacks_months(self):
        self.submit(self.owner)
        payment = SubscriptionPayment.objects.get()
        payment.approve()
        self.workspace.refresh_from_db()
        self.assertTrue(self.workspace.subscribed)
        self.assertEqual(self.workspace.plan, "growth")
        first_until = self.workspace.paid_until

        self.submit(self.owner, transaction_id="XYZ987654", months=1)
        SubscriptionPayment.objects.get(transaction_id="XYZ987654").approve()
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.paid_until, first_until + timedelta(days=30))

    def test_owner_cannot_mark_their_own_workspace_as_paid(self):
        self.client.force_authenticate(user=self.owner)
        self.client.patch(
            f"/api/workspaces/{self.workspace.id}/",
            {"subscribed": True, "plan": "enterprise"},
            format="json",
        )
        self.workspace.refresh_from_db()
        self.assertFalse(self.workspace.subscribed)
        self.assertEqual(self.workspace.plan, "starter")

    def test_only_the_owner_is_shown_the_payment_number(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.get("/api/billing/")
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("0770000000", response.content.decode())

        self.client.force_authenticate(user=self.owner)
        response = self.client.get("/api/billing/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["number"], "0770000000")
        self.assertIn("no-store", response["Cache-Control"])

    def test_anonymous_visitors_get_nothing(self):
        response = self.client.get("/api/billing/")
        self.assertEqual(response.status_code, 401)


class MomoNumberSettingTests(APITestCase):
    def test_only_real_mtn_uganda_numbers_are_accepted(self):
        from config.settings import mtn_uganda_number

        self.assertEqual(mtn_uganda_number("0771234567"), "0771 234 567")
        self.assertEqual(mtn_uganda_number("+256 771 234 567"), "0771 234 567")
        self.assertEqual(mtn_uganda_number("0701234567"), "")  # Airtel prefix
        self.assertEqual(mtn_uganda_number("077123456"), "")
        self.assertEqual(mtn_uganda_number(""), "")

    def test_only_real_airtel_uganda_numbers_are_accepted(self):
        from config.settings import airtel_uganda_number

        self.assertEqual(airtel_uganda_number("0701234567"), "0701 234 567")
        self.assertEqual(airtel_uganda_number("+256 751 234 567"), "0751 234 567")
        self.assertEqual(airtel_uganda_number("0771234567"), "")  # MTN prefix
        self.assertEqual(airtel_uganda_number(""), "")


@override_settings(
    SUBSCRIPTION_MOMO_NUMBER="0770000000",
    SUBSCRIPTION_MOMO_NAME="Test MTN",
    SUBSCRIPTION_AIRTEL_NUMBER="0700000000",
    SUBSCRIPTION_AIRTEL_NAME="Test Airtel",
    SUBSCRIPTION_BANK_NAME="Stanbic",
    SUBSCRIPTION_BANK_ACCOUNT_NAME="SalesPos Ltd",
    SUBSCRIPTION_BANK_ACCOUNT_NUMBER="9030001234567",
    SUBSCRIPTION_BANK_BRANCH="Kampala Road",
)
class PaymentChannelTests(APITestCase):
    """Every rail the deployment was given details for, and nothing else."""

    def setUp(self):
        self.owner = User.objects.create_user(email="owner@shop.com", password="sup3rsecret!")
        self.workspace = Workspace.objects.create(name="Shop")
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")
        self.client.force_authenticate(user=self.owner)

    def test_configured_channels_are_published_to_the_owner(self):
        response = self.client.get("/api/billing/")
        self.assertEqual(response.status_code, 200)

        by_id = {c["id"]: c for c in response.data["channels"]}
        self.assertEqual(set(by_id), {"mtn_momo", "airtel_money", "bank_card"})
        self.assertEqual(by_id["airtel_money"]["account"], "0700000000")
        self.assertEqual(by_id["bank_card"]["account"], "9030001234567")
        # The bank line has to say where, or a transfer cannot be addressed.
        self.assertIn("Stanbic", by_id["bank_card"]["instructions"])
        self.assertIn("Kampala Road", by_id["bank_card"]["instructions"])

    def test_a_payment_records_the_rail_it_came_down(self):
        response = self.client.post(
            "/api/subscription-payments/",
            {
                "plan": "growth",
                "months": 1,
                "payer_phone": "0751 234 567",
                "transaction_id": "AIR123456",
                "network": "airtel_money",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            SubscriptionPayment.objects.get(transaction_id="AIR123456").network,
            "airtel_money",
        )

    def test_an_unpublished_rail_is_refused(self):
        """Money down a rail we never named is money we cannot match."""
        with override_settings(SUBSCRIPTION_AIRTEL_NUMBER=""):
            response = self.client.post(
                "/api/subscription-payments/",
                {
                    "plan": "growth",
                    "months": 1,
                    "payer_phone": "0751 234 567",
                    "transaction_id": "AIR999999",
                    "network": "airtel_money",
                },
                format="json",
            )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(SubscriptionPayment.objects.filter(transaction_id="AIR999999").exists())


class NoPaymentChannelTests(APITestCase):
    """With nothing configured, the page must say so rather than take money."""

    def setUp(self):
        self.owner = User.objects.create_user(email="owner@shop.com", password="sup3rsecret!")
        self.workspace = Workspace.objects.create(name="Shop")
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")
        self.client.force_authenticate(user=self.owner)

    @override_settings(
        SUBSCRIPTION_MOMO_NUMBER="",
        SUBSCRIPTION_AIRTEL_NUMBER="",
        SUBSCRIPTION_BANK_ACCOUNT_NUMBER="",
    )
    def test_no_channels_and_no_payments(self):
        response = self.client.get("/api/billing/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["channels"], [])

        submitted = self.client.post(
            "/api/subscription-payments/",
            {
                "plan": "growth",
                "months": 1,
                "payer_phone": "0771 234 567",
                "transaction_id": "NONE123456",
            },
            format="json",
        )
        self.assertEqual(submitted.status_code, 403)


@override_settings(FLUTTERWAVE_SECRET_KEY="FLWSECK_TEST-x", FLUTTERWAVE_SECRET_HASH="hash-x")
class FlutterwaveCheckoutTests(APITestCase):
    """Priced here, charged by Flutterwave, activated only after verification."""

    def setUp(self):
        self.owner = User.objects.create_user(email="owner@shop.com", password="sup3rsecret!")
        self.manager = User.objects.create_user(email="mgr@shop.com", password="sup3rsecret!")
        self.workspace = Workspace.objects.create(name="Shop")
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")
        Membership.objects.create(user=self.manager, workspace=self.workspace, role="manager")

    def test_the_channel_appears_once_a_key_is_set(self):
        self.client.force_authenticate(user=self.owner)
        ids = {c["id"] for c in self.client.get("/api/billing/").data["channels"]}
        self.assertIn("flutterwave", ids)

    @override_settings(FLUTTERWAVE_SECRET_KEY="")
    def test_no_channel_without_a_key(self):
        self.client.force_authenticate(user=self.owner)
        ids = {c["id"] for c in self.client.get("/api/billing/").data["channels"]}
        self.assertNotIn("flutterwave", ids)

    def test_a_manager_cannot_start_a_payment(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.post(
            "/api/billing/checkout/", {"plan": "growth", "months": 1}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_plan_and_months_are_checked_before_flutterwave_is_called(self):
        self.client.force_authenticate(user=self.owner)
        for body in ({"plan": "platinum", "months": 1}, {"plan": "growth", "months": 7}):
            response = self.client.post("/api/billing/checkout/", body, format="json")
            self.assertEqual(response.status_code, 400, body)
        self.assertFalse(SubscriptionPayment.objects.exists())

    def test_a_gateway_payment_cannot_be_reported_by_hand(self):
        """Otherwise anyone could claim they paid online and be believed."""
        self.client.force_authenticate(user=self.owner)
        response = self.client.post(
            "/api/subscription-payments/",
            {
                "plan": "growth",
                "months": 1,
                "payer_phone": "0771 234 567",
                "transaction_id": "FLW123456",
                "network": "flutterwave",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(SubscriptionPayment.objects.exists())

    def test_a_refused_start_leaves_no_pending_row_behind(self):
        """Nothing was charged, so nothing should sit waiting for confirmation."""
        self.client.force_authenticate(user=self.owner)
        with mock.patch(
            "apps.accounts.views.flutterwave_request",
            return_value={"status": "error", "message": "no"},
        ):
            response = self.client.post(
                "/api/billing/checkout/", {"plan": "growth", "months": 1}, format="json"
            )
        self.assertEqual(response.status_code, 502)
        self.assertFalse(SubscriptionPayment.objects.exists())

    def test_a_started_payment_is_pending_and_keyed_by_our_own_reference(self):
        self.client.force_authenticate(user=self.owner)
        with mock.patch(
            "apps.accounts.views.flutterwave_request",
            return_value={"status": "success", "data": {"link": "https://pay.example/x"}},
        ):
            response = self.client.post(
                "/api/billing/checkout/", {"plan": "growth", "months": 3}, format="json"
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["url"], "https://pay.example/x")

        payment = SubscriptionPayment.objects.get()
        self.assertEqual(payment.status, "pending")
        self.assertEqual(payment.network, "flutterwave")
        self.assertEqual(payment.amount, PLAN_PRICES_UGX["growth"] * 3)
        self.assertTrue(payment.transaction_id.startswith("salespos-"))
        self.workspace.refresh_from_db()
        self.assertFalse(self.workspace.subscribed)


@override_settings(FLUTTERWAVE_SECRET_KEY="FLWSECK_TEST-x", FLUTTERWAVE_SECRET_HASH="hash-x")
class FlutterwaveApprovalTests(APITestCase):
    """The verification call decides, not the browser and not the payload."""

    def setUp(self):
        self.workspace = Workspace.objects.create(name="Shop")
        self.payment = SubscriptionPayment.objects.create(
            workspace=self.workspace,
            plan="growth",
            months=1,
            amount=PLAN_PRICES_UGX["growth"],
            currency="UGX",
            network="flutterwave",
            payer_phone="card",
            transaction_id="salespos-abc",
        )

    def verified(self, **overrides):
        data = {
            "status": "successful",
            "amount": PLAN_PRICES_UGX["growth"],
            "currency": "UGX",
            "tx_ref": "salespos-abc",
            **overrides,
        }
        return {"status": "success", "data": data}

    def test_a_verified_payment_activates_the_plan(self):
        with mock.patch("apps.accounts.views.flutterwave_request", return_value=self.verified()):
            self.assertTrue(approve_flutterwave_payment("99"))

        self.workspace.refresh_from_db()
        self.assertTrue(self.workspace.subscribed)
        self.assertEqual(self.workspace.plan, "growth")

    def test_verifying_twice_does_not_pay_for_two_months(self):
        with mock.patch("apps.accounts.views.flutterwave_request", return_value=self.verified()):
            approve_flutterwave_payment("99")
            self.workspace.refresh_from_db()
            first_until = self.workspace.paid_until

            approve_flutterwave_payment("99")

        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.paid_until, first_until)

    def test_an_underpayment_is_refused(self):
        """The row says what was owed; the gateway says what arrived."""
        with mock.patch(
            "apps.accounts.views.flutterwave_request",
            return_value=self.verified(amount=1000),
        ):
            self.assertFalse(approve_flutterwave_payment("99"))

        self.payment.refresh_from_db()
        self.workspace.refresh_from_db()
        self.assertEqual(self.payment.status, "rejected")
        self.assertFalse(self.workspace.subscribed)

    def test_the_wrong_currency_is_refused(self):
        with mock.patch(
            "apps.accounts.views.flutterwave_request",
            return_value=self.verified(currency="KES"),
        ):
            self.assertFalse(approve_flutterwave_payment("99"))

        self.workspace.refresh_from_db()
        self.assertFalse(self.workspace.subscribed)

    def test_an_unsuccessful_transaction_is_refused(self):
        with mock.patch(
            "apps.accounts.views.flutterwave_request",
            return_value=self.verified(status="failed"),
        ):
            self.assertFalse(approve_flutterwave_payment("99"))

        self.workspace.refresh_from_db()
        self.assertFalse(self.workspace.subscribed)


class FlutterwaveWebhookTests(APITestCase):
    """The shared hash is the only thing between a stranger and a free plan."""

    def setUp(self):
        self.workspace = Workspace.objects.create(name="Shop")
        self.payment = SubscriptionPayment.objects.create(
            workspace=self.workspace,
            plan="growth",
            months=1,
            amount=PLAN_PRICES_UGX["growth"],
            currency="UGX",
            network="flutterwave",
            payer_phone="card",
            transaction_id="salespos-abc",
        )
        self.body = {"data": {"id": 99, "tx_ref": "salespos-abc", "status": "successful"}}

    @override_settings(FLUTTERWAVE_SECRET_HASH="hash-x")
    def test_a_wrong_hash_is_refused(self):
        response = self.client.post(
            "/api/billing/flutterwave-webhook/",
            self.body,
            format="json",
            HTTP_VERIF_HASH="not-the-hash",
        )
        self.assertEqual(response.status_code, 400)
        self.workspace.refresh_from_db()
        self.assertFalse(self.workspace.subscribed)

    @override_settings(FLUTTERWAVE_SECRET_HASH="hash-x")
    def test_a_missing_hash_is_refused(self):
        response = self.client.post(
            "/api/billing/flutterwave-webhook/", self.body, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.workspace.refresh_from_db()
        self.assertFalse(self.workspace.subscribed)

    @override_settings(FLUTTERWAVE_SECRET_HASH="")
    def test_a_deployment_with_no_hash_accepts_nothing(self):
        response = self.client.post(
            "/api/billing/flutterwave-webhook/",
            self.body,
            format="json",
            HTTP_VERIF_HASH="anything",
        )
        self.assertEqual(response.status_code, 400)
        self.workspace.refresh_from_db()
        self.assertFalse(self.workspace.subscribed)

    @override_settings(
        FLUTTERWAVE_SECRET_HASH="hash-x", FLUTTERWAVE_SECRET_KEY="FLWSECK_TEST-x"
    )
    def test_a_signed_event_is_still_verified_before_it_counts(self):
        """A correct hash proves who sent it, not that the money arrived."""
        with mock.patch(
            "apps.accounts.views.flutterwave_request",
            return_value={
                "status": "success",
                "data": {
                    "status": "successful",
                    "amount": PLAN_PRICES_UGX["growth"],
                    "currency": "UGX",
                    "tx_ref": "salespos-abc",
                },
            },
        ) as verify:
            response = self.client.post(
                "/api/billing/flutterwave-webhook/",
                self.body,
                format="json",
                HTTP_VERIF_HASH="hash-x",
            )

        self.assertEqual(response.status_code, 200)
        verify.assert_called_once()
        self.workspace.refresh_from_db()
        self.assertTrue(self.workspace.subscribed)
