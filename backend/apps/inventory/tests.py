"""Stock movement rules ported from the Supabase triggers."""

from datetime import date
from decimal import Decimal

from django.test import TestCase

from rest_framework.test import APIClient

from apps.accounts.models import Membership, User, Workspace
from apps.inventory.models import Product, StockTransaction
from apps.inventory.services import (
    clear_store,
    record_damage,
    record_stock_transaction,
    signed_delta,
)
from apps.sales.models import Sale, SaleItem


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


class ClearStoreTests(TestCase):
    """The owner's reset button, behind the danger zone."""

    def setUp(self):
        self.workspace = Workspace.objects.create(name="Pamoja Traders")
        self.owner = User.objects.create_user(
            email="owner@example.com", password="sup3rsecret!"
        )
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")
        self.cashier = User.objects.create_user(
            email="cashier@example.com", password="sup3rsecret!"
        )
        Membership.objects.create(
            user=self.cashier, workspace=self.workspace, role="manager"
        )

        self.sugar = self._product("Sugar 1kg", 20)
        self.rice = self._product("Rice 5kg", 8)

        self.client = APIClient()
        self.headers = {"HTTP_X_WORKSPACE": str(self.workspace.id)}

    def _product(self, name, quantity):
        return Product.objects.create(
            workspace=self.workspace,
            name=name,
            unit_buying_price=Decimal("4200"),
            unit_selling_price=Decimal("5000"),
            stock_quantity=quantity,
        )

    def _sell(self, product):
        sale = Sale.objects.create(workspace=self.workspace, total_amount=Decimal("5000"))
        SaleItem.objects.create(
            workspace=self.workspace,
            sale=sale,
            product=product,
            quantity=1,
            unit_price=Decimal("5000"),
            subtotal=Decimal("5000"),
        )

    def test_zero_empties_the_shelves_and_leaves_a_trail(self):
        result = clear_store(workspace=self.workspace, mode="zero", performed_by=self.owner)

        self.assertEqual(result["zeroed"], 2)
        self.assertEqual(result["deleted"], 0)
        self.assertEqual(
            list(Product.objects.filter(workspace=self.workspace).values_list(
                "stock_quantity", flat=True
            )),
            [0, 0],
        )
        # The write-off must be visible as movement, or an emptied shelf is
        # indistinguishable from theft.
        adjustments = StockTransaction.objects.filter(
            workspace=self.workspace, type="adjustment"
        )
        self.assertEqual(adjustments.count(), 2)
        self.assertEqual(sorted(a.quantity for a in adjustments), [-20, -8])

    def test_delete_removes_products_but_keeps_ones_that_were_sold(self):
        self._sell(self.sugar)

        result = clear_store(workspace=self.workspace, mode="delete", performed_by=self.owner)

        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["kept"], 1)
        remaining = list(Product.objects.filter(workspace=self.workspace))
        self.assertEqual([p.name for p in remaining], ["Sugar 1kg"])
        # Kept, but emptied — the point of the button was an empty store.
        self.assertEqual(remaining[0].stock_quantity, 0)

    def test_only_the_owner_can_clear_the_store(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.post(
            "/api/products/clear/", {"mode": "delete"}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Product.objects.filter(workspace=self.workspace).count(), 2)

    def test_an_unknown_mode_is_rejected(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/products/clear/", {"mode": "everything"}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Product.objects.filter(workspace=self.workspace).count(), 2)

    def test_the_endpoint_clears_for_the_owner(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/products/clear/", {"mode": "zero"}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["zeroed"], 2)
        self.assertFalse(
            Product.objects.filter(workspace=self.workspace, stock_quantity__gt=0).exists()
        )

    def test_deleting_a_sold_product_explains_itself(self):
        self._sell(self.sugar)
        self.client.force_authenticate(self.owner)

        response = self.client.delete(
            f"/api/products/{self.sugar.id}/", **self.headers
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("past sales", str(response.data))
        self.assertTrue(Product.objects.filter(pk=self.sugar.pk).exists())

    def test_a_new_product_records_who_added_it(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.post(
            "/api/products/",
            {"name": "Blue Band 500g", "unit_selling_price": "9000"},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 201, response.data)
        # The owner's dashboard asks "who put this on the price list?" — the
        # answer has to be stored at the moment it is created.
        self.assertEqual(response.data["created_by"], self.cashier.id)
        self.assertEqual(
            Product.objects.get(pk=response.data["id"]).created_by, self.cashier
        )

    def test_staff_may_edit_but_not_delete(self):
        self.client.force_authenticate(self.cashier)

        edit = self.client.patch(
            f"/api/products/{self.rice.id}/",
            {"unit_selling_price": "7500"},
            format="json",
            **self.headers,
        )
        self.assertEqual(edit.status_code, 200, edit.data)

        delete = self.client.delete(f"/api/products/{self.rice.id}/", **self.headers)
        self.assertEqual(delete.status_code, 403)
        self.assertTrue(Product.objects.filter(pk=self.rice.pk).exists())
