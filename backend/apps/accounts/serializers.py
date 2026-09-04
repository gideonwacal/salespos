from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

from apps.accounts.models import Membership, User, Workspace


class WorkspaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Workspace
        fields = [
            "id",
            "name",
            "tagline",
            "industry",
            "address",
            "city",
            "country",
            "phone",
            "email",
            "tax_id",
            "currency",
            "currency_symbol",
            "vat_percent",
            "receipt_footer",
            "logo_url",
            "low_stock_alerts",
            "expiry_alerts",
            "plan",
            "trial_ends",
            "subscribed",
            "paid_until",
            "configured",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name", "phone", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]


class MembershipSerializer(serializers.ModelSerializer):
    """Flattened for the staff page, which wants one row per teammate."""

    email = serializers.EmailField(source="user.email", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    user_id = serializers.UUIDField(source="user.id", read_only=True)

    class Meta:
        model = Membership
        fields = [
            "id",
            "user_id",
            "email",
            "full_name",
            "phone",
            "role",
            "active",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class MeSerializer(serializers.Serializer):
    """What the frontend's AuthProvider needs in one call."""

    user = UserSerializer()
    workspaces = serializers.SerializerMethodField()
    active_workspace = serializers.SerializerMethodField()
    role = serializers.CharField(allow_null=True)

    def get_workspaces(self, obj):
        return WorkspaceSerializer(
            [m.workspace for m in obj["memberships"]], many=True
        ).data

    def get_active_workspace(self, obj):
        workspace = obj.get("active_workspace")
        return WorkspaceSerializer(workspace).data if workspace else None


class RegisterSerializer(serializers.Serializer):
    """Sign-up creates the user, their business, and the owner membership.

    Mirrors `signUpLocal` in demo.ts, which does the same three things.
    """

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    full_name = serializers.CharField(max_length=200)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    business_name = serializers.CharField(max_length=200)
    industry = serializers.CharField(
        max_length=100, required=False, allow_blank=True, default=""
    )

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_password(self, value):
        validate_password(value)
        return value

    @transaction.atomic
    def create(self, validated_data):
        user = User.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            full_name=validated_data["full_name"],
            phone=validated_data.get("phone", ""),
        )
        workspace = Workspace.objects.create(
            name=validated_data["business_name"],
            email=user.email,
            phone=user.phone,
            # Chosen at sign-up: it decides which industry profile the whole UI
            # adopts, so the shop never has to configure it a second time.
            industry=validated_data.get("industry", ""),
        )
        Membership.objects.create(user=user, workspace=workspace, role="owner")
        return {"user": user, "workspace": workspace}


class InviteMemberSerializer(serializers.Serializer):
    """Owner adds a teammate to the current workspace."""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    full_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=["owner", "manager"], default="manager")

    def validate_password(self, value):
        validate_password(value)
        return value

    @transaction.atomic
    def create(self, validated_data):
        workspace = self.context["workspace"]
        email = validated_data["email"].strip().lower()

        user = User.objects.filter(email=email).first()
        if user is None:
            user = User.objects.create_user(
                email=email,
                password=validated_data["password"],
                full_name=validated_data.get("full_name", ""),
                phone=validated_data.get("phone", ""),
            )

        membership, created = Membership.objects.get_or_create(
            user=user,
            workspace=workspace,
            defaults={"role": validated_data["role"]},
        )
        if not created:
            raise serializers.ValidationError(
                {"email": "That person is already a member of this workspace."}
            )
        return membership
