"""Expense approval — the `owner updates expenses` policy."""

from decimal import Decimal

from rest_framework.test import APITestCase

from apps.accounts.models import Membership, User, Workspace
from apps.expenses.models import Expense


class ExpenseApprovalTests(APITestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name="Shop")
        self.owner = User.objects.create_user(
            email="owner@example.com", password="sup3rsecret!"
        )
        self.manager = User.objects.create_user(
            email="manager@example.com", password="sup3rsecret!"
        )
        Membership.objects.create(
            user=self.owner, workspace=self.workspace, role="owner"
        )
        Membership.objects.create(
            user=self.manager, workspace=self.workspace, role="manager"
        )

    def test_staff_logged_expense_defaults_to_pending(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.post(
            "/api/expenses/",
            {"category": "Transport", "amount": "150000", "status": "approved"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        # The manager asked for "approved" and must not get it.
        self.assertEqual(response.data["status"], "pending")

    def test_expense_records_who_logged_it(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.post(
            "/api/expenses/",
            {"category": "Power", "amount": "85000"},
            format="json",
        )
        self.assertEqual(response.data["logged_by"], self.manager.id)

    def test_owner_can_approve(self):
        expense = Expense.objects.create(
            workspace=self.workspace,
            category="Rent",
            amount=Decimal("400000"),
            expense_date="2026-09-01",
        )
        self.client.force_authenticate(user=self.owner)
        response = self.client.post(f"/api/expenses/{expense.id}/approve/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "approved")

    def test_manager_cannot_approve(self):
        expense = Expense.objects.create(
            workspace=self.workspace,
            category="Rent",
            amount=Decimal("400000"),
            expense_date="2026-09-01",
        )
        self.client.force_authenticate(user=self.manager)
        response = self.client.post(f"/api/expenses/{expense.id}/approve/")
        self.assertEqual(response.status_code, 403)
        expense.refresh_from_db()
        self.assertEqual(expense.status, "pending")

    def test_negative_amount_is_rejected(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.post(
            "/api/expenses/", {"category": "Odd", "amount": "-5"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
