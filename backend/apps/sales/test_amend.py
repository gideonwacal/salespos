"""Amending a sale, and who is allowed to do what.

The counter mis-keys sales; a cashier must be able to put one right and have the
shelf follow. Deleting stays with the owner.
"""

from decimal import Decimal

from django.test import TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.accounts.models import Membership, User, Workspace
from apps.inventory.models import Product, StockTransaction
from apps.sales.models import Sale
from apps.sales.services import amend_sale, create_sale


class AmendSaleTests(TestCase):
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

        self.soda = Product.objects.create(
            workspace=self.workspace,
            name="Coca Cola 500ml",
            unit_buying_price=Decimal("1100"),
            unit_selling_price=Decimal("1500"),
            stock_quantity=100,
        )
        self.water = Product.objects.create(
            workspace=self.workspace,
            name="Rwenzori 1L",
            unit_buying_price=Decimal("900"),
            unit_selling_price=Decimal("1200"),
            stock_quantity=50,
        )

    def _sale(self, quantity=10):
        return create_sale(
            workspace=self.workspace,
            cashier=self.cashier,
            items=[{"product_id": self.soda.id, "quantity": quantity}],
        )

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    # --- stock follows the correction ----------------------------------------

    def test_reducing_the_quantity_puts_stock_back(self):
        sale = self._sale(10)
        self.soda.refresh_from_db()
        self.assertEqual(self.soda.stock_quantity, 90)

        amend_sale(
            sale=sale,
            actor=self.cashier,
            items=[{"product_id": self.soda.id, "quantity": 4}],
        )

        self.soda.refresh_from_db()
        sale.refresh_from_db()
        self.assertEqual(self.soda.stock_quantity, 96)
        self.assertEqual(sale.total_amount, Decimal("6000.00"))
        self.assertEqual(sale.total_cost, Decimal("4400.00"))

    def test_increasing_the_quantity_takes_more_stock(self):
        sale = self._sale(10)
        amend_sale(
            sale=sale,
            actor=self.cashier,
            items=[{"product_id": self.soda.id, "quantity": 15}],
        )

        self.soda.refresh_from_db()
        self.assertEqual(self.soda.stock_quantity, 85)

    def test_swapping_the_product_returns_one_and_takes_the_other(self):
        sale = self._sale(10)
        amend_sale(
            sale=sale,
            actor=self.cashier,
            items=[{"product_id": self.water.id, "quantity": 6}],
        )

        self.soda.refresh_from_db()
        self.water.refresh_from_db()
        # All ten sodas go back on the shelf, six waters come off.
        self.assertEqual(self.soda.stock_quantity, 100)
        self.assertEqual(self.water.stock_quantity, 44)

    def test_an_amendment_that_exceeds_stock_changes_nothing(self):
        sale = self._sale(10)
        with self.assertRaises(ValidationError):
            amend_sale(
                sale=sale,
                actor=self.cashier,
                items=[{"product_id": self.soda.id, "quantity": 500}],
            )

        self.soda.refresh_from_db()
        sale.refresh_from_db()
        self.assertEqual(self.soda.stock_quantity, 90)
        self.assertEqual(sale.items.count(), 1)
        self.assertEqual(sale.items.first().quantity, 10)

    def test_the_correction_is_written_to_the_stock_ledger(self):
        sale = self._sale(10)
        amend_sale(
            sale=sale,
            actor=self.cashier,
            items=[{"product_id": self.soda.id, "quantity": 4}],
        )

        entry = StockTransaction.objects.filter(
            product=self.soda, type="adjustment"
        ).latest("created_at")
        self.assertEqual(entry.quantity, 6)
        self.assertEqual(entry.performed_by, self.cashier)
        self.assertIn("10 -> 4", entry.notes)

    # --- who may do what -----------------------------------------------------

    def test_a_cashier_may_amend_a_sale(self):
        sale = self._sale(10)
        response = self.client_for(self.cashier).patch(
            f"/api/sales/{sale.id}/",
            {"items": [{"product_id": str(self.soda.id), "quantity": 3}]},
            format="json",
            HTTP_X_WORKSPACE=str(self.workspace.id),
        )
        self.assertEqual(response.status_code, 200)

        self.soda.refresh_from_db()
        self.assertEqual(self.soda.stock_quantity, 97)

    def test_a_cashier_may_not_delete_a_sale(self):
        sale = self._sale(10)
        response = self.client_for(self.cashier).delete(
            f"/api/sales/{sale.id}/", HTTP_X_WORKSPACE=str(self.workspace.id)
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Sale.objects.filter(pk=sale.pk).exists())

    def test_the_owner_may_delete_a_sale_and_stock_comes_back(self):
        sale = self._sale(10)
        response = self.client_for(self.owner).delete(
            f"/api/sales/{sale.id}/", HTTP_X_WORKSPACE=str(self.workspace.id)
        )
        self.assertEqual(response.status_code, 204)

        self.soda.refresh_from_db()
        self.assertEqual(self.soda.stock_quantity, 100)
        self.assertFalse(Sale.objects.filter(pk=sale.pk).exists())

    def test_a_cashier_may_not_delete_a_product(self):
        response = self.client_for(self.cashier).delete(
            f"/api/products/{self.soda.id}/", HTTP_X_WORKSPACE=str(self.workspace.id)
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Product.objects.filter(pk=self.soda.pk).exists())

    def test_a_cashier_may_still_edit_a_product(self):
        response = self.client_for(self.cashier).patch(
            f"/api/products/{self.soda.id}/",
            {"unit_selling_price": "1600"},
            format="json",
            HTTP_X_WORKSPACE=str(self.workspace.id),
        )
        self.assertEqual(response.status_code, 200)

        self.soda.refresh_from_db()
        self.assertEqual(self.soda.unit_selling_price, Decimal("1600.00"))
