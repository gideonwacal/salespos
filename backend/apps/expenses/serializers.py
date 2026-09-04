from django.utils import timezone
from rest_framework import serializers

from apps.expenses.models import Expense


class ExpenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Expense
        fields = [
            "id",
            "category",
            "amount",
            "description",
            "vendor",
            "expense_date",
            "payment_method",
            "status",
            "logged_by",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "logged_by"]

    def get_fields(self):
        fields = super().get_fields()
        fields["expense_date"].required = False
        return fields

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value

    def validate(self, attrs):
        attrs.setdefault("expense_date", timezone.localdate())

        request = self.context.get("request")
        role = getattr(request, "workspace_role", None) if request else None

        # Only owners may set a status; staff log expenses as pending and an
        # owner approves them. This was the `owner updates expenses` RLS policy.
        if role != "owner" and "status" in attrs:
            if self.instance is None:
                attrs["status"] = "pending"
            elif attrs["status"] != self.instance.status:
                raise serializers.ValidationError(
                    {"status": "Only the workspace owner can approve or reject expenses."}
                )

        # Staff may correct what they logged, but only while it is still
        # pending. Once an owner has ruled on an expense, letting the person who
        # raised it edit the amount would mean getting 10,000 approved and then
        # quietly making it 500,000.
        if (
            role != "owner"
            and self.instance is not None
            and self.instance.status != "pending"
        ):
            raise serializers.ValidationError(
                "This expense has already been "
                f"{self.instance.status}. Ask the owner to change it."
            )
        return attrs
