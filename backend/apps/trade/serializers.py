"""Serializers for the wholesale modules.

Field names mirror the frontend types in src/lib/data.ts exactly — `customer_id`
rather than `customer` — so the UI needed no reshaping to move off localStorage.
"""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.trade.models import (
    BottleMovement,
    Customer,
    Debt,
    DebtPayment,
    Purchase,
    Quotation,
    Shift,
    Supplier,
)


class BlankableCharField(serializers.CharField):
    """A text field the UI may send as null.

    The frontend types these columns as `string | null`, so an empty phone or
    note arrives as null rather than "". Storing null in a non-null column is
    not an option, and rejecting it would break the page, so it becomes "".
    """

    def __init__(self, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_blank", True)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def run_validation(self, data=serializers.empty):
        if data is None:
            data = ""
        return super().run_validation(data)


class CustomerSerializer(serializers.ModelSerializer):
    phone = BlankableCharField(max_length=40)
    notes = BlankableCharField()

    class Meta:
        model = Customer
        fields = [
            "id",
            "name",
            "phone",
            "notes",
            "bottles_owed",
            "created_at",
            "updated_at",
        ]
        # The running total is derived from bottle movements, never posted.
        read_only_fields = ["id", "created_at", "updated_at", "bottles_owed"]


class DebtSerializer(serializers.ModelSerializer):
    items_summary = BlankableCharField()
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer", queryset=Customer.objects.all()
    )
    sale_id = serializers.PrimaryKeyRelatedField(
        source="sale", read_only=True, allow_null=True
    )
    balance = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = Debt
        fields = [
            "id",
            "customer_id",
            "sale_id",
            "items_summary",
            "total_value",
            "amount_paid",
            "balance",
            "issue_date",
            "due_date",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "amount_paid", "balance"]

    def validate_customer_id(self, value):
        # A debt must belong to a customer of this workspace, not someone else's.
        if value.workspace_id != self.context["request"].workspace.id:
            raise serializers.ValidationError("That customer is not in this workspace.")
        return value


def refresh_debt_status(debt: Debt) -> Debt:
    """Re-derive status from what has actually been paid.

    Cleared beats overdue: a debt settled after its due date is simply settled.
    """
    total = Decimal(debt.total_value or 0)
    paid = Decimal(debt.amount_paid or 0)

    if paid >= total and total > 0:
        debt.status = "cleared"
    elif debt.due_date and debt.due_date < timezone.localdate():
        debt.status = "overdue"
    elif paid > 0:
        debt.status = "partially_paid"
    else:
        debt.status = "pending"

    debt.save(update_fields=["status", "amount_paid", "updated_at"])
    return debt


class DebtPaymentSerializer(serializers.ModelSerializer):
    note = BlankableCharField()
    debt_id = serializers.PrimaryKeyRelatedField(
        source="debt", queryset=Debt.objects.all()
    )

    class Meta:
        model = DebtPayment
        fields = ["id", "debt_id", "amount", "payment_method", "note", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_debt_id(self, value):
        if value.workspace_id != self.context["request"].workspace.id:
            raise serializers.ValidationError("That debt is not in this workspace.")
        return value

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("A payment must be greater than zero.")
        return value

    def validate(self, attrs):
        debt = attrs["debt"]
        outstanding = Decimal(debt.total_value or 0) - Decimal(debt.amount_paid or 0)
        if attrs["amount"] > outstanding:
            raise serializers.ValidationError(
                {"amount": f"That is more than the {outstanding} still outstanding."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        payment = super().create(validated_data)
        # Lock the debt so two counters taking payment can't both read the same
        # amount_paid and lose one of them.
        debt = Debt.objects.select_for_update().get(pk=payment.debt_id)
        debt.amount_paid = Decimal(debt.amount_paid or 0) + Decimal(payment.amount)
        refresh_debt_status(debt)
        return payment


class BottleMovementSerializer(serializers.ModelSerializer):
    note = BlankableCharField()
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer", queryset=Customer.objects.all()
    )
    sale_id = serializers.PrimaryKeyRelatedField(
        source="sale", read_only=True, allow_null=True
    )

    class Meta:
        model = BottleMovement
        fields = [
            "id",
            "customer_id",
            "sale_id",
            "direction",
            "quantity",
            "note",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_customer_id(self, value):
        if value.workspace_id != self.context["request"].workspace.id:
            raise serializers.ValidationError("That customer is not in this workspace.")
        return value

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return value

    def validate(self, attrs):
        # A customer cannot hand back more empties than they are holding; that
        # is a miscount at the counter, not stock the shop owes them.
        if attrs["direction"] == "returned":
            held = attrs["customer"].bottles_owed
            if attrs["quantity"] > held:
                raise serializers.ValidationError(
                    {
                        "quantity": (
                            "That customer is only holding %d empties. "
                            "Check the count before recording the return." % held
                        )
                    }
                )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        movement = super().create(validated_data)
        customer = Customer.objects.select_for_update().get(pk=movement.customer_id)
        delta = movement.quantity if movement.direction == "taken" else -movement.quantity
        # validate() already rejects an over-return; max() is only a floor in
        # case two returns race each other.
        customer.bottles_owed = max(0, customer.bottles_owed + delta)
        customer.save(update_fields=["bottles_owed", "updated_at"])
        return movement


class SupplierSerializer(serializers.ModelSerializer):
    contact = BlankableCharField(max_length=120)
    email = BlankableCharField(max_length=254)
    address = BlankableCharField(max_length=255)

    class Meta:
        model = Supplier
        fields = ["id", "name", "contact", "email", "address", "balance", "created_at"]
        read_only_fields = ["id", "created_at"]


class PurchaseSerializer(serializers.ModelSerializer):
    reference = BlankableCharField(max_length=80)
    supplier_id = serializers.PrimaryKeyRelatedField(
        source="supplier", queryset=Supplier.objects.all()
    )

    class Meta:
        model = Purchase
        fields = [
            "id",
            "supplier_id",
            "reference",
            "total_amount",
            "amount_paid",
            "status",
            "purchase_date",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_supplier_id(self, value):
        if value.workspace_id != self.context["request"].workspace.id:
            raise serializers.ValidationError("That supplier is not in this workspace.")
        return value


class QuotationSerializer(serializers.ModelSerializer):
    customer_phone = BlankableCharField(max_length=40)
    items_summary = BlankableCharField()
    notes = BlankableCharField()

    def validate_number(self, value):
        # There is a DB constraint behind this. Without the check here it
        # surfaces as an IntegrityError 500 rather than a field error.
        value = value.strip()
        qs = Quotation.objects.filter(
            workspace=self.context["request"].workspace, number=value
        )
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                "A quotation with that number already exists."
            )
        return value

    class Meta:
        model = Quotation
        fields = [
            "id",
            "number",
            "customer_name",
            "customer_phone",
            "items_summary",
            "total_amount",
            "valid_until",
            "status",
            "notes",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class ShiftSerializer(serializers.ModelSerializer):
    staff_name = BlankableCharField(max_length=200)
    user_id = serializers.PrimaryKeyRelatedField(
        source="user", read_only=True, allow_null=True
    )

    class Meta:
        model = Shift
        fields = [
            "id",
            "user_id",
            "staff_name",
            "shift_type",
            "opening_float",
            "closing_cash",
            "expected_cash",
            "status",
            "started_at",
            "ended_at",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "user_id"]
