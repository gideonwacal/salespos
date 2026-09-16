from rest_framework.test import APITestCase

from apps.accounts.models import Membership, SubscriptionPayment, User, Workspace
from apps.console.models import ActivityLog


class ConsoleTests(APITestCase):
    def setUp(self):
        self.boss = User.objects.create_superuser(email="boss@salespos.app", password="sup3rsecret!")
        self.owner = User.objects.create_user(email="owner@shop.com", password="sup3rsecret!")
        self.workspace = Workspace.objects.create(name="Mama's Shop")
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")

    def test_shop_owners_cannot_open_the_console(self):
        self.client.force_authenticate(user=self.owner)
        for url in (
            "/api/console/overview/",
            "/api/console/businesses/",
            f"/api/console/businesses/{self.workspace.id}/",
            "/api/console/users/",
            "/api/console/payments/",
            "/api/console/activity/",
        ):
            self.assertEqual(self.client.get(url).status_code, 403, url)
        response = self.client.patch(
            f"/api/console/businesses/{self.workspace.id}/", {"access": "free"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_anonymous_visitors_are_turned_away(self):
        self.assertEqual(self.client.get("/api/console/overview/").status_code, 401)

    def test_platform_owner_sees_every_business(self):
        self.client.force_authenticate(user=self.boss)
        response = self.client.get("/api/console/businesses/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["name"], "Mama's Shop")
        self.assertEqual(response.data[0]["state"], "trial")
        self.assertEqual(response.data[0]["owner"], "owner@shop.com")

    def test_suspending_a_business_locks_it_out_on_the_server(self):
        self.client.force_authenticate(user=self.boss)
        response = self.client.patch(
            f"/api/console/businesses/{self.workspace.id}/",
            {"access": "suspended", "access_note": "Fraud"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["state"], "suspended")

        self.client.force_authenticate(user=self.owner)
        self.assertEqual(self.client.get("/api/products/").status_code, 403)
        self.assertEqual(self.client.get("/api/members/").status_code, 403)
        # They can still sign in and learn why.
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["active_workspace"]["access"], "suspended")

    def test_free_access_and_plan_are_set_by_the_platform_owner(self):
        self.client.force_authenticate(user=self.boss)
        response = self.client.patch(
            f"/api/console/businesses/{self.workspace.id}/",
            {"access": "free", "plan": "enterprise"},
            format="json",
        )
        self.assertEqual(response.data["state"], "free")
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.plan, "enterprise")
        self.assertTrue(
            ActivityLog.objects.filter(workspace=self.workspace, by_platform=True).exists()
        )

    def test_shops_cannot_grant_themselves_free_access(self):
        self.client.force_authenticate(user=self.owner)
        self.client.patch(
            f"/api/workspaces/{self.workspace.id}/", {"access": "free"}, format="json"
        )
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.access, "standard")

    def test_bad_values_are_rejected(self):
        self.client.force_authenticate(user=self.boss)
        response = self.client.patch(
            f"/api/console/businesses/{self.workspace.id}/",
            {"access": "forever", "trial_ends": "soon"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.access, "standard")

    def test_extending_the_trial(self):
        self.client.force_authenticate(user=self.boss)
        response = self.client.patch(
            f"/api/console/businesses/{self.workspace.id}/",
            {"trial_ends": "2030-01-31"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.trial_ends.date().isoformat(), "2030-01-31")

    def test_approving_a_payment_from_the_console(self):
        payment = SubscriptionPayment.objects.create(
            workspace=self.workspace, plan="growth", months=1, amount=100000,
            payer_phone="0771234567", transaction_id="TX123456",
        )
        self.client.force_authenticate(user=self.boss)
        response = self.client.post(f"/api/console/payments/{payment.id}/approve/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "approved")
        self.workspace.refresh_from_db()
        self.assertTrue(self.workspace.subscribed)
        again = self.client.post(f"/api/console/payments/{payment.id}/reject/")
        self.assertEqual(again.status_code, 400)

    def test_blocking_a_user(self):
        self.client.force_authenticate(user=self.boss)
        response = self.client.patch(
            f"/api/console/users/{self.owner.id}/", {"is_active": False}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.owner.refresh_from_db()
        self.assertFalse(self.owner.is_active)
        self_block = self.client.patch(
            f"/api/console/users/{self.boss.id}/", {"is_active": False}, format="json"
        )
        self.assertEqual(self_block.status_code, 400)

    def test_shop_changes_are_recorded(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.post(
            "/api/products/", {"name": "Sugar 1kg", "unit_selling_price": "5000"}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        entry = ActivityLog.objects.get(workspace=self.workspace)
        self.assertEqual(entry.user, self.owner)
        self.assertEqual(entry.action, "added product")
        self.assertEqual(entry.target, "Sugar 1kg")

        self.client.force_authenticate(user=self.boss)
        feed = self.client.get("/api/console/activity/")
        self.assertEqual(feed.data["results"][0]["action"], "added product")

    def test_sign_ins_are_recorded(self):
        response = self.client.post(
            "/api/auth/login/",
            {"email": "owner@shop.com", "password": "sup3rsecret!"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(ActivityLog.objects.filter(user=self.owner, action="signed in").exists())
