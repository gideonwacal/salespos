from rest_framework import serializers

from apps.inventory.models import DamageReport, Product, StockTransaction


class ProductSerializer(serializers.ModelSerializer):
    low_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "category",
            "unit_buying_price",
            "unit_selling_price",
            "wholesale_price",
            "stock_quantity",
            "reorder_level",
            "expiry_date",
            "barcode",
            "unit_of_measure",
            "batch_number",
            "prescription_only",
            "is_glass_bottle",
            "bottles_per_unit",
            "bulk_min_qty",
            "bulk_discount_percent",
            "low_stock",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "low_stock"]


class StockTransactionSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = StockTransaction
        fields = [
            "id",
            "product",
            "product_name",
            "type",
            "quantity",
            "notes",
            "expiry_date",
            "performed_by",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "performed_by", "product_name"]

    def validate_quantity(self, value):
        if value == 0:
            raise serializers.ValidationError("Quantity cannot be zero.")
        return value

    def validate_product(self, value):
        workspace = self.context["request"].workspace
        if value.workspace_id != workspace.id:
            raise serializers.ValidationError("That product is not in this workspace.")
        return value


class DamageReportSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = DamageReport
        fields = [
            "id",
            "product",
            "product_name",
            "quantity",
            "reason",
            "photo_url",
            "reported_by",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "reported_by", "product_name"]

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return value

    def validate_product(self, value):
        workspace = self.context["request"].workspace
        if value.workspace_id != workspace.id:
            raise serializers.ValidationError("That product is not in this workspace.")
        return value
