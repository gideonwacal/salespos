"""Selling in parts: quarters, halves, bottles, sachets — and sacks.

The shop buys a 50kg sack and sells kilos, halves and quarters. Two things
have to be right at once: what leaves the shelf, and what gets charged. They
are not the same arithmetic, and getting the second one "nearly right" costs
the shop money on every part it sells.
"""

from decimal import Decimal

from rest_framework.test import APITestCase

from apps.accounts.models import Membership, User, Workspace
from apps.core.quantities import trim, with_unit
from apps.inventory.models import Product, ProductUnit, StockTransaction
from apps.inventory.services import record_stock_transaction
from apps.sales.models import Sale
from apps.sales.services import amend_sale, create_sale, void_sale


class PartUnitTests(APITestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name="Nakawa Traders", access="free")
        self.owner = User.objects.create_user(
            email="owner@n.com", password="sup3rsecret!", email_verified=True
        )
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")

        # Sugar: bought as 50kg sacks at 180,000, held in kilos.
        self.sugar = Product.objects.create(
            workspace=self.workspace,
            name="Sugar",
            unit_of_measure="kg",
            unit_buying_price=Decimal("3600"),   # per kg: 180,000 / 50
            unit_selling_price=Decimal("4000"),  # per kg
            stock_quantity=Decimal("50"),
            reorder_level=Decimal("10"),
        )
        # The premium on breaking bulk is the whole point: a quarter is 1,200,
        # not a quarter of 4,000.
        self.kilo = ProductUnit.objects.create(
            workspace=self.workspace, product=self.sugar, name="1 kg",
            factor=Decimal("1"), price=Decimal("4000"), is_default=True, sort_order=2,
        )
        self.half = ProductUnit.objects.create(
            workspace=self.workspace, product=self.sugar, name="1/2 kg",
            factor=Decimal("0.5"), price=Decimal("2100"), sort_order=1,
        )
        self.quarter = ProductUnit.objects.create(
            workspace=self.workspace, product=self.sugar, name="1/4 kg",
            factor=Decimal("0.25"), price=Decimal("1200"), sort_order=0,
        )
        self.sack = ProductUnit.objects.create(
            workspace=self.workspace, product=self.sugar, name="50kg sack",
            factor=Decimal("50"), price=Decimal("190000"), sort_order=3,
        )

    def sell(self, unit, quantity, **kw):
        return create_sale(
            workspace=self.workspace, cashier=self.owner,
            items=[{"product_id": self.sugar.id, "quantity": quantity, "unit": unit}],
            **kw,
        )

    def stock(self):
        self.sugar.refresh_from_db()
        return self.sugar.stock_quantity

    # --- the money ----------------------------------------------------------

    def test_a_quarter_is_charged_at_its_own_price_not_a_quarter_of_the_kilo(self):
        """The whole reason units carry a price. 4,000 x 0.25 would be 1,000."""
        sale = self.sell("1/4 kg", 1)
        self.assertEqual(sale.total_amount, Decimal("1200.00"))
        self.assertNotEqual(sale.total_amount, Decimal("1000.00"))

    def test_four_quarters_cost_more_than_one_kilo(self):
        """Which is exactly why a shop breaks bulk.

        Both sales run against the same 50kg of stock; there is room for 1.25kg
        twice over, so no restocking is needed between them.
        """
        quarters = self.sell("1/4 kg", 4).total_amount
        kilo = self.sell("1 kg", 1).total_amount
        self.assertEqual(quarters, Decimal("4800.00"))
        self.assertEqual(kilo, Decimal("4000.00"))
        self.assertGreater(quarters, kilo)

    def test_cost_follows_the_size_sold_so_profit_is_right(self):
        sale = self.sell("1/4 kg", 1)
        line = sale.items.get()
        # A quarter of a kilo cost a quarter of what the kilo cost to buy.
        self.assertEqual(line.unit_cost, Decimal("900.00"))
        self.assertEqual(sale.profit, Decimal("300.00"))

    def test_a_sack_sells_at_the_sack_price(self):
        sale = self.sell("50kg sack", 1)
        self.assertEqual(sale.total_amount, Decimal("190000.00"))
        self.assertEqual(sale.items.get().unit_cost, Decimal("180000.00"))

    # --- the shelf ----------------------------------------------------------

    def test_selling_a_quarter_takes_a_quarter_off_the_shelf(self):
        self.sell("1/4 kg", 1)
        self.assertEqual(self.stock(), Decimal("49.750"))

    def test_three_quarters_is_point_seven_five(self):
        self.sell("1/4 kg", 3)
        self.assertEqual(self.stock(), Decimal("49.250"))

    def test_a_sack_takes_fifty(self):
        self.sell("50kg sack", 1)
        self.assertEqual(self.stock(), Decimal("0.000"))

    def test_the_ledger_records_base_units_and_how_they_were_counted(self):
        self.sell("1/4 kg", 2)
        txn = StockTransaction.objects.get(type="sale")
        self.assertEqual(txn.quantity, Decimal("0.500"))   # what left the shelf
        self.assertEqual(txn.unit_name, "1/4 kg")          # how it was counted
        self.assertEqual(txn.unit_factor, Decimal("0.2500"))

    def test_a_fractional_quantity_can_be_keyed_straight_in(self):
        """1.5 kg, without anybody defining a "1.5 kg" unit."""
        sale = self.sell("1 kg", Decimal("1.5"))
        self.assertEqual(sale.total_amount, Decimal("6000.00"))
        self.assertEqual(self.stock(), Decimal("48.500"))

    # --- running out --------------------------------------------------------

    def test_you_cannot_sell_more_than_is_on_the_shelf(self):
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            self.sell("50kg sack", 2)   # only one sack's worth in stock
        self.assertEqual(self.stock(), Decimal("50.000"))

    def test_the_shortage_message_reads_in_the_shop_s_own_units(self):
        from rest_framework.exceptions import ValidationError

        self.sell("1/4 kg", 1)
        try:
            self.sell("50kg sack", 1)
            self.fail("should have refused")
        except ValidationError as exc:
            self.assertIn("49.75 kg", str(exc.detail))
            self.assertNotIn("49.750", str(exc.detail))

    def test_an_unknown_unit_is_refused(self):
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError) as caught:
            self.sell("1/3 kg", 1)
        self.assertIn("not sold as", str(caught.exception.detail))

    # --- corrections --------------------------------------------------------

    def test_voiding_puts_back_what_actually_left(self):
        sale = self.sell("1/4 kg", 3)
        self.assertEqual(self.stock(), Decimal("49.250"))
        void_sale(sale)
        self.assertEqual(self.stock(), Decimal("50.000"))

    def test_amending_settles_on_base_units(self):
        """Two quarters corrected to one kilo is 0.5 more off the shelf, not 1."""
        sale = self.sell("1/4 kg", 2)
        self.assertEqual(self.stock(), Decimal("49.500"))

        amend_sale(
            sale=sale, actor=self.owner,
            items=[{"product_id": self.sugar.id, "quantity": 1, "unit": "1 kg"}],
        )
        self.assertEqual(self.stock(), Decimal("49.000"))
        sale.refresh_from_db()
        self.assertEqual(sale.total_amount, Decimal("4000.00"))

    def test_amending_down_puts_the_difference_back(self):
        sale = self.sell("1 kg", 2)
        self.assertEqual(self.stock(), Decimal("48.000"))
        amend_sale(
            sale=sale, actor=self.owner,
            items=[{"product_id": self.sugar.id, "quantity": 1, "unit": "1/2 kg"}],
        )
        self.assertEqual(self.stock(), Decimal("49.500"))

    # --- deliveries ---------------------------------------------------------

    def test_receiving_two_sacks_adds_a_hundred_kilos(self):
        """The shop counts the delivery the way the delivery note does."""
        record_stock_transaction(
            workspace=self.workspace, product=self.sugar, type="stock_in",
            quantity=2, unit="50kg sack", performed_by=self.owner,
        )
        self.assertEqual(self.stock(), Decimal("150.000"))
        txn = StockTransaction.objects.get(type="stock_in")
        self.assertEqual(txn.quantity, Decimal("100.000"))
        self.assertEqual(txn.unit_name, "50kg sack")

    def test_a_delivery_with_no_unit_is_base_units(self):
        record_stock_transaction(
            workspace=self.workspace, product=self.sugar, type="stock_in",
            quantity=Decimal("25.5"), performed_by=self.owner,
        )
        self.assertEqual(self.stock(), Decimal("75.500"))


class ProductsWithoutUnitsTests(APITestCase):
    """A shop that only sells whole things must not notice any of this."""

    def setUp(self):
        self.workspace = Workspace.objects.create(name="Hardware", access="free")
        self.owner = User.objects.create_user(email="o@h.com", password="sup3rsecret!")
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")
        self.hammer = Product.objects.create(
            workspace=self.workspace, name="Hammer",
            unit_buying_price=Decimal("12000"), unit_selling_price=Decimal("18000"),
            stock_quantity=Decimal("10"),
        )

    def test_selling_works_exactly_as_before(self):
        sale = create_sale(
            workspace=self.workspace, cashier=self.owner,
            items=[{"product_id": self.hammer.id, "quantity": 2}],
        )
        self.assertEqual(sale.total_amount, Decimal("36000.00"))
        self.hammer.refresh_from_db()
        self.assertEqual(self.hammer.stock_quantity, Decimal("8.000"))

    def test_the_line_records_no_unit_and_a_factor_of_one(self):
        sale = create_sale(
            workspace=self.workspace, cashier=self.owner,
            items=[{"product_id": self.hammer.id, "quantity": 1}],
        )
        line = sale.items.get()
        self.assertEqual(line.unit_name, "")
        self.assertEqual(line.unit_factor, Decimal("1.0000"))
        self.assertEqual(line.base_quantity, Decimal("1.0000"))


class QuantityFormattingTests(APITestCase):
    def test_trailing_zeros_are_not_shown(self):
        self.assertEqual(trim(Decimal("7.000")), "7")
        self.assertEqual(trim(Decimal("48.250")), "48.25")
        self.assertEqual(trim(Decimal("0.500")), "0.5")

    def test_round_hundreds_do_not_come_out_in_scientific_notation(self):
        """normalize() turns 100 into 1E+2, which is not a quantity anybody says."""
        self.assertEqual(trim(Decimal("100.000")), "100")
        self.assertEqual(trim(Decimal("1000")), "1000")

    def test_units_are_appended_only_when_there_is_one(self):
        self.assertEqual(with_unit(Decimal("48.250"), "kg"), "48.25 kg")
        self.assertEqual(with_unit(Decimal("7.000"), ""), "7")
