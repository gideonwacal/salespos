"""Stock movement rules ported from the Supabase triggers."""

from datetime import date
from decimal import Decimal

from django.test import TestCase

from apps.accounts.models import User, Workspace
from apps.inventory.models import Product, StockTransaction
from apps.inventory.services import record_damage, record_stock_transaction, signed_delta


class SignedDeltaTests(TestCase):
    def test_stock_in_and_adjustment_add(self):
        self.assertEqual(signed_delta("stock_in", 10), 10)
        self.assertEqual(signed_delta("adjustment", -3), -3)

    def test_sale_and_damage_always_subtract(self):
        # The old trigger used -ABS(quantity), so a client sending a negative
        # quantity on a sale cannot secretly add stock.
        self.assertEqual(signed_delta("sale", 5), -5)
        self.assertEqual(signed_delta("sale", -5), -5)
        self.assertEqual(signed_delta("damage", -2), -2)


class StockTransactionTests(TestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name="Pamoja Traders")
        self.user = User.objects.create_user(
            email="staff@example.com", password="sup3rsecret!"
        )
        self.product = Product.objects.create(
            workspace=self.workspace,
            name="Sugar 1kg",
            unit_buying_price=Decimal("4200"),
            unit_selling_price=Decimal("5000"),
            stock_quantity=20,
        )

    def test_stock_in_raises_quantity(self):
        record_stock_transaction(
            workspace=self.workspace,
            product=self.product,
            type="stock_in",
            quantity=30,
            performed_by=self.user,
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 50)

    def test_stock_never_goes_negative(self):
        record_stock_transaction(
            workspace=self.workspace,
            product=self.product,
            type="sale",
            quantity=999,
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 0)

    def test_stock_in_with_expiry_updates_the_product(self):
        record_stock_transaction(
            workspace=self.workspace,
            product=self.product,
            type="stock_in",
            quantity=5,
            expiry_date=date(2027, 1, 1),
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.expiry_date, date(2027, 1, 1))

    def test_damage_writes_off_stock_and_logs_a_transaction(self):
        record_damage(
            workspace=self.workspace,
            product=self.product,
            quantity=3,
            reason="Broken in transit",
            reported_by=self.user,
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 17)

        txn = StockTransaction.objects.get(type="damage")
        self.assertEqual(txn.quantity, 3)
        self.assertEqual(txn.notes, "Broken in transit")
