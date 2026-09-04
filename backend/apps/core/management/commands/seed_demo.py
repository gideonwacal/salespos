"""Create a workspace with the Pamoja Traders sample catalogue.

The product and expense lists are the ones from the original Supabase seed
migration, so a fresh Django database looks like the demo the app already ships.

    python manage.py seed_demo --email owner@example.com --password sup3rsecret!
"""

from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Membership, User, Workspace
from apps.expenses.models import Expense
from apps.inventory.models import Product

PRODUCTS = [
    # (name, category, buying, selling, wholesale, stock, reorder)
    ("Bebwine Sachet 100ml", "Alcoholic Drinks", 600, 1000, 850, 480, 100),
    ("Bebwine Bottle 250ml", "Alcoholic Drinks", 1800, 2500, 2200, 120, 30),
    ("Lavida Waragi 200ml", "Alcoholic Drinks", 1500, 2200, 1900, 96, 24),
    ("Teju Gin Sachet", "Alcoholic Drinks", 550, 1000, 800, 600, 120),
    ("Jaja Sachet 100ml", "Alcoholic Drinks", 600, 1000, 850, 240, 80),
    ("Kituzi Waragi 250ml", "Alcoholic Drinks", 1700, 2500, 2100, 72, 24),
    ("Kabisa Energy Drink 300ml", "Soft Drinks", 1400, 2000, 1700, 144, 36),
    ("Coca Cola 500ml", "Soft Drinks", 1100, 1500, 1300, 240, 48),
    ("Fanta Orange 500ml", "Soft Drinks", 1100, 1500, 1300, 180, 48),
    ("Mirinda Pineapple 500ml", "Soft Drinks", 1100, 1500, 1300, 96, 48),
    ("Rwenzori Water 1.5L", "Soft Drinks", 1000, 1500, 1250, 150, 40),
    ("Novida Pineapple 300ml", "Soft Drinks", 1200, 1800, 1500, 84, 36),
    ("Mukwano Cooking Oil 1L", "Household Items", 6500, 8000, 7300, 60, 15),
    ("Omo Washing Powder 500g", "Household Items", 3800, 5000, 4400, 80, 20),
    ("Blue Band Margarine 250g", "Household Items", 4200, 5500, 4900, 45, 12),
    ("Kimbo Cooking Fat 500g", "Household Items", 5000, 6500, 5800, 36, 12),
    ("Colgate Toothpaste 100ml", "Household Items", 3000, 4500, 3800, 54, 15),
    ("Geisha Soap Bar", "Household Items", 1800, 2500, 2200, 120, 30),
    ("Sugar (Kakira) 1kg", "General Merchandise", 4200, 5000, 4600, 200, 50),
    ("Rice (Super) 1kg", "General Merchandise", 3800, 4500, 4200, 150, 40),
    ("Matches Box (Pack of 10)", "General Merchandise", 1200, 2000, 1600, 90, 20),
    ("Exercise Books (Pack of 12)", "General Merchandise", 9000, 12000, 10500, 40, 10),
    ("Torch Batteries (Pair)", "General Merchandise", 900, 1500, 1200, 160, 40),
    ("Airtime Scratch Cards 1000", "General Merchandise", 950, 1000, 980, 300, 100),
]

DRINK_CATEGORIES = {"Soft Drinks", "Alcoholic Drinks"}

EXPENSES = [
    # (category, amount, description, vendor, days_ago, method, status)
    ("Power/Electricity", 85000, "Yaka units for shop and fridges", "UMEME", 2, "mobile_money", "approved"),
    ("Transport & Freight", 150000, "Truck hire Kampala to Serere", "Ssekabira Transporters", 3, "cash", "approved"),
    ("Offloading/Handling", 30000, "Offloading drinks crates", "Casual Labourers", 3, "cash", "approved"),
    ("Shop Rent", 400000, "Monthly rent Orupe Road shop", "Landlord Okello", 5, "bank_transfer", "approved"),
    ("Staff Wages", 250000, "Fortnight wages for two attendants", "Shop Staff", 1, "mobile_money", "pending"),
    ("Local Taxes", 60000, "Trading licence instalment", "Town Council", 6, "cash", "approved"),
    ("Miscellaneous", 18000, "Airtime and printing receipts", "Various", 0, "cash", "pending"),
    ("Power/Electricity", 40000, "Generator fuel during blackout", "Shell Serere", 0, "cash", "pending"),
]


class Command(BaseCommand):
    help = "Seed a workspace with the Pamoja Traders sample catalogue."

    def add_arguments(self, parser):
        parser.add_argument("--email", default="owner@pamoja.test")
        parser.add_argument("--password", default="sup3rsecret!")
        parser.add_argument("--business", default="Pamoja Traders")

    @transaction.atomic
    def handle(self, *args, **options):
        email = options["email"].strip().lower()

        user, created = User.objects.get_or_create(
            email=email, defaults={"full_name": "Shop Owner"}
        )
        if created:
            user.set_password(options["password"])
            user.save()

        workspace, _ = Workspace.objects.get_or_create(
            name=options["business"],
            defaults={
                "currency": "UGX",
                "currency_symbol": "UGX",
                "country": "Uganda",
                "city": "Serere",
                "configured": True,
            },
        )
        Membership.objects.get_or_create(
            user=user, workspace=workspace, defaults={"role": "owner"}
        )

        if Product.objects.filter(workspace=workspace).exists():
            self.stdout.write(
                self.style.WARNING("Workspace already has products — skipping catalogue.")
            )
        else:
            for name, category, buying, selling, wholesale, stock, reorder in PRODUCTS:
                is_drink = category in DRINK_CATEGORIES
                Product.objects.create(
                    workspace=workspace,
                    name=name,
                    category=category,
                    unit_buying_price=Decimal(buying),
                    unit_selling_price=Decimal(selling),
                    wholesale_price=Decimal(wholesale),
                    stock_quantity=stock,
                    reorder_level=reorder,
                    is_glass_bottle=is_drink,
                    bottles_per_unit=24 if is_drink else 1,
                    bulk_min_qty=6 if is_drink else 0,
                    bulk_discount_percent=Decimal(10) if is_drink else Decimal(0),
                )

            today = timezone.localdate()
            for category, amount, description, vendor, days_ago, method, status in EXPENSES:
                Expense.objects.create(
                    workspace=workspace,
                    category=category,
                    amount=Decimal(amount),
                    description=description,
                    vendor=vendor,
                    expense_date=today - timedelta(days=days_ago),
                    payment_method=method,
                    status=status,
                    logged_by=user,
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded '{workspace.name}'\n"
                f"  workspace id : {workspace.id}\n"
                f"  sign in as   : {email}\n"
                f"  products     : {Product.objects.filter(workspace=workspace).count()}\n"
                f"  expenses     : {Expense.objects.filter(workspace=workspace).count()}"
            )
        )
