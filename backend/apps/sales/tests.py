"""Checkout and tenancy tests — the logic that used to live in Postgres triggers."""

from decimal import Decimal

from django.test import TestCase
from rest_framework.exceptions import ValidationError

from apps.accounts.models import Membership, User, Workspace
from apps.inventory.models import Product, StockTransaction
from apps.sales.models import Sale
from apps.sales.services import create_sale, line_unit_price, void_sale


class SaleServiceTests(TestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name="Pamoja Traders")
        self.user = User.objects.create_user(
            email="owner@example.com", password="sup3rsecret!", full_name="Owner"
        )
        Membership.objects.create(
            user=self.user, workspace=self.workspace, role="owner"
        )
        self.soda = Product.objects.create(
            workspace=self.workspace,
            name="Coca Cola 500ml",
            unit_buying_price=Decimal("1100"),
            unit_selling_price=Decimal("1500"),
            wholesale_price=Decimal("1300"),
            stock_quantity=100,
        )

    def test_sale_decrements_stock_and_computes_totals(self):
        sale = create_sale(
            workspace=self.workspace,
            cashier=self.user,
            items=[{"product_id": self.soda.id, "quantity": 4}],
        )
        self.soda.refresh_from_db()

        self.assertEqual(self.soda.stock_quantity, 96)
        self.assertEqual(sale.total_amount, Decimal("6000.00"))
        self.assertEqual(sale.total_cost, Decimal("4400.00"))
        self.assertEqual(sale.profit, Decimal("1600.00"))

    def test_sale_writes_a_stock_transaction(self):
        create_sale(
            workspace=self.workspace,
            cashier=self.user,
            items=[{"product_id": self.soda.id, "quantity": 2}],
        )
        txn = StockTransaction.objects.get(product=self.soda, type="sale")
        self.assertEqual(txn.quantity, 2)
        self.assertEqual(txn.performed_by, self.user)

    def test_overselling_is_rejected_and_nothing_is_written(self):
        with self.assertRaises(ValidationError):
            create_sale(
                workspace=self.workspace,
                cashier=self.user,
                items=[{"product_id": self.soda.id, "quantity": 500}],
            )
        self.soda.refresh_from_db()
        self.assertEqual(self.soda.stock_quantity, 100)
        self.assertEqual(Sale.objects.count(), 0)

    def test_a_failing_line_rolls_back_the_whole_basket(self):
        pens = Product.objects.create(
            workspace=self.workspace,
            name="Pens",
            unit_selling_price=Decimal("500"),
            stock_quantity=1,
        )
        with self.assertRaises(ValidationError):
            create_sale(
                workspace=self.workspace,
                cashier=self.user,
                items=[
                    {"product_id": self.soda.id, "quantity": 5},
                    {"product_id": pens.id, "quantity": 99},
                ],
            )
        self.soda.refresh_from_db()
        # The first line must not have been committed on its own.
        self.assertEqual(self.soda.stock_quantity, 100)
        self.assertEqual(Sale.objects.count(), 0)

    def test_wholesale_uses_the_wholesale_price(self):
        sale = create_sale(
            workspace=self.workspace,
            cashier=self.user,
            items=[{"product_id": self.soda.id, "quantity": 2}],
            sale_type="wholesale",
        )
        self.assertEqual(sale.total_amount, Decimal("2600.00"))

    def test_bulk_discount_applies_at_the_threshold(self):
        self.soda.bulk_min_qty = 6
        self.soda.bulk_discount_percent = Decimal("10")
        self.soda.save()

        self.assertEqual(line_unit_price(self.soda, 5, "retail"), Decimal("1500.00"))
        self.assertEqual(line_unit_price(self.soda, 6, "retail"), Decimal("1350.00"))

    def test_products_from_another_workspace_are_rejected(self):
        other = Workspace.objects.create(name="Someone Else")
        theirs = Product.objects.create(
            workspace=other, name="Not yours", stock_quantity=10
        )
        with self.assertRaises(ValidationError):
            create_sale(
                workspace=self.workspace,
                cashier=self.user,
                items=[{"product_id": theirs.id, "quantity": 1}],
            )

    def test_voiding_a_sale_returns_the_stock(self):
        sale = create_sale(
            workspace=self.workspace,
            cashier=self.user,
            items=[{"product_id": self.soda.id, "quantity": 10}],
        )
        self.soda.refresh_from_db()
        self.assertEqual(self.soda.stock_quantity, 90)

        void_sale(sale)
        self.soda.refresh_from_db()
        self.assertEqual(self.soda.stock_quantity, 100)
        self.assertEqual(Sale.objects.count(), 0)
        self.assertTrue(
            StockTransaction.objects.filter(type="adjustment").exists(),
            "voiding should leave an audit trail",
        )
