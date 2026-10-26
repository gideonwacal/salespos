from rest_framework import serializers

from apps.inventory.models import (
    DamageReport,
    Product,
    ProductUnit,
    StockTransaction,
    VehicleFit,
)


class VehicleFitSerializer(serializers.ModelSerializer):
    product_id = serializers.PrimaryKeyRelatedField(
        source="product", queryset=Product.objects.all()
    )

    class Meta:
        model = VehicleFit
        fields = [
            "id",
            "product_id",
            "make",
            "model",
            "year_from",
            "year_to",
            "engine",
            "note",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        """A range that runs backwards is a typo, and it would match nothing."""
        start = attrs.get("year_from")
        end = attrs.get("year_to")
        if start and end and start > end:
            raise serializers.ValidationError({"year_to": "The last year is before the first."})
        return attrs

    def validate_product(self, value):
        workspace = self.context["request"].workspace
        if value.workspace_id != workspace.id:
            raise serializers.ValidationError("That part is not in this workspace.")
        return value


class ProductUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductUnit
        fields = ["id", "product", "name", "factor", "price", "wholesale_price",
                  "is_default", "sort_order", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_factor(self, value):
        if value <= 0:
            raise serializers.ValidationError(
                "How many of the base unit is this? It has to be more than zero."
            )
        return value

    def validate_product(self, value):
        # A unit must belong to a product of this workspace, not someone else's.
        if value.workspace_id != self.context["request"].workspace.id:
            raise serializers.ValidationError("That product is not in this workspace.")
        return value


class ProductSerializer(serializers.ModelSerializer):
    low_stock = serializers.BooleanField(read_only=True)
    # Nested read-only: the till needs every way an item can be sold in the
    # same request that lists it, and units are edited through their own
    # endpoint.
    units = ProductUnitSerializer(many=True, read_only=True)
    # Nested read-only: the catalogue shows what a part fits, and fitments are
    # added and removed through their own endpoint.
    fits = VehicleFitSerializer(many=True, read_only=True)
    # Sent as a name so the dashboard does not have to join against the staff
    # list to say who added an item.
    created_by_name = serializers.CharField(
        source="created_by.full_name", read_only=True, default=""
    )

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "category",
            "unit_buying_price",
            "unit_selling_price",
            "supplier_price",
            "wholesale_price",
            "stock_quantity",
            "reorder_level",
            "expiry_date",
            "barcode",
            "unit_of_measure",
            "units",
            "batch_number",
            "prescription_only",
            "is_service",
            "part_number",
            "brand",
            "shelf_location",
            "fits",
            "is_glass_bottle",
            "bottles_per_unit",
            "bulk_min_qty",
            "bulk_discount_percent",
            "low_stock",
            "created_by",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "low_stock",
            "created_by",
            "created_by_name",
        ]


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
