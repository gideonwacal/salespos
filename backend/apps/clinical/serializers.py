from django.db import transaction
from rest_framework import serializers

from apps.accounts.models import Workspace
from apps.clinical.models import Patient, Prescription, Visit
from apps.inventory.models import Product


class PatientSerializer(serializers.ModelSerializer):
    age = serializers.IntegerField(read_only=True)
    visit_count = serializers.SerializerMethodField()

    class Meta:
        model = Patient
        fields = [
            "id",
            "patient_number",
            "full_name",
            "sex",
            "date_of_birth",
            "stated_age",
            "age",
            "phone",
            "village",
            "nin",
            "next_of_kin_name",
            "next_of_kin_phone",
            "allergies",
            "notes",
            "visit_count",
            "created_at",
        ]
        # Generated, never typed: two patients with the same card number is a
        # mix-up nobody notices until the wrong file is pulled.
        read_only_fields = ["id", "created_at", "patient_number", "age", "visit_count"]

    def get_visit_count(self, obj) -> int:
        return obj.visits.count()

    @transaction.atomic
    def create(self, validated_data):
        workspace = validated_data["workspace"]
        # Counted on the workspace, not derived from the table: the highest
        # number in the table goes down when a patient is deleted, and the next
        # person through the door would be handed their card number.
        locked = Workspace.objects.select_for_update().get(pk=workspace.pk)
        locked.patient_counter += 1
        locked.save(update_fields=["patient_counter"])

        validated_data["patient_number"] = f"P{locked.patient_counter:05d}"
        return super().create(validated_data)


class PrescriptionSerializer(serializers.ModelSerializer):
    visit_id = serializers.PrimaryKeyRelatedField(source="visit", queryset=Visit.objects.all())
    patient_id = serializers.PrimaryKeyRelatedField(source="patient", read_only=True)
    product_id = serializers.PrimaryKeyRelatedField(
        source="product",
        queryset=Product.objects.all(),
        required=False,
        allow_null=True,
    )
    outstanding = serializers.IntegerField(read_only=True)

    class Meta:
        model = Prescription
        fields = [
            "id",
            "visit_id",
            "patient_id",
            "product_id",
            "medicine",
            "dose",
            "frequency",
            "duration",
            "instructions",
            "quantity_ordered",
            "quantity_dispensed",
            "outstanding",
            "dispensed_at",
            "dispensed_by",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "patient_id",
            "quantity_dispensed",
            "dispensed_at",
            "dispensed_by",
            "outstanding",
        ]

    def validate_visit(self, value):
        workspace = self.context["request"].workspace
        if value.workspace_id != workspace.id:
            raise serializers.ValidationError("That visit is not in this workspace.")
        return value

    def create(self, validated_data):
        # The patient is whoever the visit is for; asking the client to send it
        # too would only create a way for the two to disagree.
        validated_data["patient"] = validated_data["visit"].patient
        return super().create(validated_data)


class VisitSerializer(serializers.ModelSerializer):
    patient_id = serializers.PrimaryKeyRelatedField(
        source="patient", queryset=Patient.objects.all()
    )
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    patient_number = serializers.CharField(source="patient.patient_number", read_only=True)
    allergies = serializers.CharField(source="patient.allergies", read_only=True)
    prescriptions = PrescriptionSerializer(many=True, read_only=True)

    class Meta:
        model = Visit
        fields = [
            "id",
            "patient_id",
            "patient_name",
            "patient_number",
            "allergies",
            "status",
            "complaint",
            "temperature",
            "blood_pressure",
            "pulse",
            "weight",
            "examination",
            "diagnosis",
            "treatment_plan",
            "clinician",
            "closed_at",
            "prescriptions",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "patient_name",
            "patient_number",
            "allergies",
            "prescriptions",
        ]

    def validate_patient(self, value):
        workspace = self.context["request"].workspace
        if value.workspace_id != workspace.id:
            raise serializers.ValidationError("That patient is not in this workspace.")
        return value
