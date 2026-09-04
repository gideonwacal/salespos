from rest_framework import serializers

from apps.sales.models import Sale, SaleItem


class SaleItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = SaleItem
        fields = [
            "id",
            "sale",
            "product",
            "product_name",
            "quantity",
            "unit_price",
            "unit_cost",
            "subtotal",
        ]
        read_only_fields = fields


class SaleItemInputSerializer(serializers.Serializer):
    """One line of a checkout request."""

    product_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1)
    unit_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True, read_only=True)
    profit = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )

    class Meta:
        model = Sale
        fields = [
            "id",
            "sale_type",
            "total_amount",
            "total_cost",
            "profit",
            "payment_method",
            "customer_name",
            "cashier",
            "items",
            "created_at",
        ]
        read_only_fields = fields


class AmendSaleSerializer(serializers.Serializer):
    """PATCH /api/sales/<id>/ — the corrected basket.

    Same shape as a checkout: the client sends what the sale *should* say, and
    the service works out how the shelf has to move to match.
    """

    items = SaleItemInputSerializer(many=True)
    sale_type = serializers.ChoiceField(
        choices=["retail", "wholesale"], required=False
    )
    payment_method = serializers.CharField(required=False, allow_blank=True)
    customer_name = serializers.CharField(
        required=False, allow_blank=True, max_length=200
    )

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("A sale needs at least one item.")
        return value


class CheckoutSerializer(serializers.Serializer):
    """POST /api/sales/ — the whole basket in one request.

    Totals are computed server-side from the line items; the client cannot send
    a total that disagrees with what was actually sold.
    """

    items = SaleItemInputSerializer(many=True)
    sale_type = serializers.ChoiceField(
        choices=["retail", "wholesale"], default="retail"
    )
    payment_method = serializers.CharField(max_length=40, default="cash")
    customer_name = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=""
    )

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("A sale needs at least one item.")
        return value
