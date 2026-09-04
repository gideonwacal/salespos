"""Who may correct an expense, and when.

Staff log expenses and mis-key them, so they must be able to put one right.
Once an owner has ruled on it, it is settled.
"""

from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Membership, User, Workspace
from apps.expenses.models import Expense


class ExpenseCorrectionTests(TestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name="Kikuubo Wholesalers")
        self.owner = User.objects.create_user(
            email="owner@example.com", password="sup3rsecret!", full_name="Owner"
        )
        self.cashier = User.objects.create_user(
            email="cashier@example.com", password="sup3rsecret!", full_name="Cashier"
        )
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")
        Membership.objects.create(
            user=self.cashier, workspace=self.workspace, role="manager"
        )
        self.headers = {"HTTP_X_WORKSPACE": str(self.workspace.id)}

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def _expense(self, status="pending", amount="120000"):
        return Expense.objects.create(
            workspace=self.workspace,
            category="Transport & Freight",
            amount=Decimal(amount),
            description="Delivery van fuel",
            expense_date="2026-09-01",
            status=status,
            logged_by=self.cashier,
        )

    def test_staff_may_correct_a_pending_expense(self):
        expense = self._expense()
        response = self.client_for(self.cashier).patch(
            f"/api/expenses/{expense.id}/",
            {"amount": "95000", "description": "Fuel - corrected"},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 200)

        expense.refresh_from_db()
        self.assertEqual(expense.amount, Decimal("95000.00"))
        self.assertEqual(expense.description, "Fuel - corrected")

    def test_staff_may_not_edit_an_approved_expense(self):
        expense = self._expense(status="approved")
        response = self.client_for(self.cashier).patch(
            f"/api/expenses/{expense.id}/",
            {"amount": "500000"},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 400)

        expense.refresh_from_db()
        self.assertEqual(expense.amount, Decimal("120000.00"))

    def test_the_owner_may_still_edit_an_approved_expense(self):
        expense = self._expense(status="approved")
        response = self.client_for(self.owner).patch(
            f"/api/expenses/{expense.id}/",
            {"amount": "130000"},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 200)

        expense.refresh_from_db()
        self.assertEqual(expense.amount, Decimal("130000.00"))

    def test_staff_may_not_approve_their_own_expense(self):
        expense = self._expense()
        response = self.client_for(self.cashier).patch(
            f"/api/expenses/{expense.id}/",
            {"status": "approved"},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 400)

        expense.refresh_from_db()
        self.assertEqual(expense.status, "pending")

    def test_staff_may_not_delete_an_expense(self):
        expense = self._expense()
        response = self.client_for(self.cashier).delete(
            f"/api/expenses/{expense.id}/", **self.headers
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Expense.objects.filter(pk=expense.pk).exists())

    def test_the_owner_may_delete_an_expense(self):
        expense = self._expense()
        response = self.client_for(self.owner).delete(
            f"/api/expenses/{expense.id}/", **self.headers
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Expense.objects.filter(pk=expense.pk).exists())

    def test_a_correction_cannot_set_a_negative_amount(self):
        expense = self._expense()
        response = self.client_for(self.cashier).patch(
            f"/api/expenses/{expense.id}/",
            {"amount": "-500"},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 400)
