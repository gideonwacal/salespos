"""Wholesale module tests: credit, debtors, bottle deposits and quotations.

These are the features the Growth plan bills for, so the rules that protect a
shop's money are pinned down here.
"""

from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APIClient
from django.test import TestCase

from apps.accounts.models import Membership, User, Workspace
from apps.trade.models import Customer, Debt, Quotation


class TradeApiTests(TestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name="Kikuubo Wholesalers")
        self.user = User.objects.create_user(
            email="owner@example.com", password="sup3rsecret!", full_name="Owner"
        )
        Membership.objects.create(user=self.user, workspace=self.workspace, role="owner")

        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.headers = {"HTTP_X_WORKSPACE": str(self.workspace.id)}

        self.customer = Customer.objects.create(
            workspace=self.workspace, name="Nakawa Retail", phone="0772-334455"
        )

    def _debt(self, total="850000", due_in_days=27):
        return Debt.objects.create(
            workspace=self.workspace,
            customer=self.customer,
            total_value=Decimal(total),
            issue_date=timezone.localdate(),
            due_date=timezone.localdate() + timedelta(days=due_in_days),
        )

    # --- credit and payments -------------------------------------------------

    def test_payment_updates_balance_and_status(self):
        debt = self._debt()
        response = self.client.post(
            "/api/debt-payments/",
            {"debt_id": str(debt.id), "amount": "300000", "payment_method": "cash"},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 201)

        debt.refresh_from_db()
        self.assertEqual(debt.amount_paid, Decimal("300000.00"))
        self.assertEqual(debt.balance, Decimal("550000.00"))
        self.assertEqual(debt.status, "partially_paid")

    def test_paying_the_balance_clears_the_debt(self):
        debt = self._debt(total="100000")
        self.client.post(
            "/api/debt-payments/",
            {"debt_id": str(debt.id), "amount": "100000"},
            format="json",
            **self.headers,
        )
        debt.refresh_from_db()
        self.assertEqual(debt.status, "cleared")

    def test_overpayment_is_rejected(self):
        debt = self._debt(total="100000")
        response = self.client.post(
            "/api/debt-payments/",
            {"debt_id": str(debt.id), "amount": "150000"},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 400)
        debt.refresh_from_db()
        self.assertEqual(debt.amount_paid, Decimal("0.00"))

    def test_settling_late_reads_as_cleared_not_overdue(self):
        debt = self._debt(total="50000", due_in_days=-5)
        self.client.post(
            "/api/debt-payments/",
            {"debt_id": str(debt.id), "amount": "50000"},
            format="json",
            **self.headers,
        )
        debt.refresh_from_db()
        self.assertEqual(debt.status, "cleared")

    def test_a_lapsed_due_date_shows_as_overdue_on_read(self):
        self._debt(due_in_days=-1)
        response = self.client.get("/api/debts/", **self.headers)
        self.assertEqual(response.data["results"][0]["status"], "overdue")

    # --- bottle deposits -----------------------------------------------------

    def test_bottles_taken_and_returned_track_the_balance(self):
        for direction, qty in (("taken", 48), ("returned", 30)):
            response = self.client.post(
                "/api/bottle-movements/",
                {
                    "customer_id": str(self.customer.id),
                    "direction": direction,
                    "quantity": qty,
                },
                format="json",
                **self.headers,
            )
            self.assertEqual(response.status_code, 201)

        self.customer.refresh_from_db()
        self.assertEqual(self.customer.bottles_owed, 18)

    def test_returning_more_than_held_is_rejected(self):
        self.client.post(
            "/api/bottle-movements/",
            {"customer_id": str(self.customer.id), "direction": "taken", "quantity": 10},
            format="json",
            **self.headers,
        )
        response = self.client.post(
            "/api/bottle-movements/",
            {
                "customer_id": str(self.customer.id),
                "direction": "returned",
                "quantity": 500,
            },
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 400)

        self.customer.refresh_from_db()
        self.assertEqual(self.customer.bottles_owed, 10)

    # --- quotations ----------------------------------------------------------

    def test_duplicate_quotation_number_is_a_field_error_not_a_500(self):
        payload = {
            "number": "QT-1001",
            "customer_name": "Nakawa Retail",
            "total_amount": "850000",
            "valid_until": str(timezone.localdate() + timedelta(days=14)),
        }
        self.assertEqual(
            self.client.post(
                "/api/quotations/", payload, format="json", **self.headers
            ).status_code,
            201,
        )
        response = self.client.post(
            "/api/quotations/", payload, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("number", response.data)

    def test_the_same_quotation_number_is_free_in_another_workspace(self):
        other = Workspace.objects.create(name="Rival Wholesalers")
        Quotation.objects.create(
            workspace=other,
            number="QT-1001",
            customer_name="Someone",
            valid_until=timezone.localdate() + timedelta(days=14),
        )
        response = self.client.post(
            "/api/quotations/",
            {
                "number": "QT-1001",
                "customer_name": "Nakawa Retail",
                "total_amount": "1000",
                "valid_until": str(timezone.localdate() + timedelta(days=14)),
            },
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 201)

    # --- tenancy -------------------------------------------------------------

    def test_another_workspaces_customers_are_invisible(self):
        other = Workspace.objects.create(name="Rival Wholesalers")
        Customer.objects.create(workspace=other, name="Their Customer")

        response = self.client.get("/api/customers/", **self.headers)
        names = [c["name"] for c in response.data["results"]]
        self.assertEqual(names, ["Nakawa Retail"])

    def test_a_debt_cannot_be_attached_to_another_workspaces_customer(self):
        other = Workspace.objects.create(name="Rival Wholesalers")
        outsider = Customer.objects.create(workspace=other, name="Their Customer")

        response = self.client.post(
            "/api/debts/",
            {
                "customer_id": str(outsider.id),
                "total_value": "1000",
                "issue_date": str(timezone.localdate()),
                "due_date": str(timezone.localdate() + timedelta(days=7)),
            },
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 400)
