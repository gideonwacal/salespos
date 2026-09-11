"""Erasing a workspace's data without erasing the people in it."""

from datetime import date
from decimal import Decimal

from rest_framework.test import APITestCase

from apps.accounts.models import Membership, User, Workspace
from apps.core.services import erase_workspace_data, workspace_models
from apps.expenses.models import Expense
from apps.inventory.models import Product, StockTransaction
from apps.sales.models import Sale, SaleItem
from apps.trade.models import Customer


class EraseWorkspaceDataTests(APITestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name="Pamoja Traders")
        self.owner = User.objects.create_user(
            email="owner@example.com", password="sup3rsecret!"
        )
        self.cashier = User.objects.create_user(
            email="cashier@example.com", password="sup3rsecret!"
        )
        Membership.objects.create(
            user=self.owner, workspace=self.workspace, role="owner"
        )
        Membership.objects.create(
            user=self.cashier, workspace=self.workspace, role="cashier"
        )
        self.headers = {"HTTP_X_WORKSPACE": str(self.workspace.id)}
        self._fill(self.workspace)

        # A second shop, to prove the erase stops at the tenant boundary.
        self.other = Workspace.objects.create(name="Someone Else Ltd")
        self._fill(self.other)

    def _fill(self, workspace):
        product = Product.objects.create(
            workspace=workspace, name="Sugar 1kg", unit_buying_price=Decimal("4200")
        )
        StockTransaction.objects.create(
            workspace=workspace, product=product, type="stock_in", quantity=10
        )
        sale = Sale.objects.create(workspace=workspace, total_amount=Decimal("5000"))
        SaleItem.objects.create(
            workspace=workspace,
            sale=sale,
            product=product,
            product_name=product.name,
            quantity=1,
            unit_price=Decimal("5000"),
            subtotal=Decimal("5000"),
        )
        Expense.objects.create(
            workspace=workspace,
            category="Rent",
            amount=Decimal("300000"),
            expense_date=date(2026, 9, 1),
        )
        Customer.objects.create(workspace=workspace, name="Achieng")

    def _rows_in(self, workspace):
        return sum(
            model.objects.filter(workspace=workspace).count()
            for model in workspace_models()
        )

    def test_every_workspace_table_is_covered(self):
        """The list is derived, so a new scoped app cannot be forgotten."""
        names = {model._meta.model_name for model in workspace_models()}
        for expected in ("product", "sale", "saleitem", "expense", "customer", "debt"):
            self.assertIn(expected, names)

    def test_the_service_empties_the_business_but_keeps_its_people(self):
        result = erase_workspace_data(workspace=self.workspace)

        self.assertEqual(self._rows_in(self.workspace), 0)
        self.assertGreater(result["erased"], 0)
        # Counted before the cascades ran, so the report is not all zeroes.
        self.assertEqual(result["tables"]["product"], 1)
        self.assertEqual(result["tables"]["saleitem"], 1)

        # The people and the business itself are not data the shop entered.
        self.assertTrue(Workspace.objects.filter(pk=self.workspace.pk).exists())
        self.assertEqual(User.objects.count(), 2)
        self.assertEqual(
            Membership.objects.filter(workspace=self.workspace).count(), 2
        )

    def test_another_workspace_is_untouched(self):
        erase_workspace_data(workspace=self.workspace)
        self.assertGreater(self._rows_in(self.other), 0)

    def test_the_owner_can_erase_through_the_api(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            f"/api/workspaces/{self.workspace.id}/erase-data/", **self.headers
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._rows_in(self.workspace), 0)
        # Still signed in, still a member: the button empties the shop, it does
        # not lock the owner out of it.
        self.assertTrue(
            Membership.objects.filter(
                user=self.owner, workspace=self.workspace, active=True
            ).exists()
        )

    def test_a_cashier_cannot_erase_the_workspace(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.post(
            f"/api/workspaces/{self.workspace.id}/erase-data/", **self.headers
        )
        self.assertEqual(response.status_code, 403)
        self.assertGreater(self._rows_in(self.workspace), 0)

    def test_an_outsider_cannot_erase_someone_elses_workspace(self):
        """The queryset is membership-scoped, so this is a 404, not a 403."""
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            f"/api/workspaces/{self.other.id}/erase-data/", **self.headers
        )
        self.assertEqual(response.status_code, 404)
        self.assertGreater(self._rows_in(self.other), 0)
