"""Patients, visits and what was prescribed at them.

The clinical spine. Everything a clinic does hangs off a patient and a visit:
the vitals a nurse takes, what the clinician found, what was ordered, and what
the dispensary actually handed over.

Kept deliberately separate from the retail tables. A sale is a basket and a
total; a visit is a person's medical record, and the two should not share a
row just because both end in money changing hands. They meet at dispensing,
where a prescription draws down the same stock the shop sells.

Note on scope: this is a record of care, not a substitute for one. Uganda's
Ministry of Health publishes EMR implementation guidance, and a deployment
holding real patient data needs a compliance review that no amount of good
schema design replaces.
"""

from django.db import models

from apps.core.models import WorkspaceScoped


class Patient(WorkspaceScoped):
    """Someone the clinic treats. The record everything else attaches to."""

    SEX_CHOICES = [("female", "Female"), ("male", "Male"), ("other", "Other")]

    # Readable, per-business, and what gets written on a card and called out in
    # a waiting room. Generated on first save rather than typed.
    patient_number = models.CharField(max_length=20)
    full_name = models.CharField(max_length=200)
    sex = models.CharField(max_length=10, choices=SEX_CHOICES, blank=True, default="")
    date_of_birth = models.DateField(null=True, blank=True)
    # Plenty of patients do not know their birth date, and a clinic still needs
    # an age to dose by. Stored as given rather than inferred from a date that
    # was never offered.
    stated_age = models.PositiveSmallIntegerField(null=True, blank=True)

    phone = models.CharField(max_length=40, blank=True, default="")
    village = models.CharField(max_length=200, blank=True, default="")
    nin = models.CharField(max_length=32, blank=True, default="")

    next_of_kin_name = models.CharField(max_length=200, blank=True, default="")
    next_of_kin_phone = models.CharField(max_length=40, blank=True, default="")

    # Read before anything is prescribed, so it is a field of its own rather
    # than a line buried in notes.
    allergies = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        db_table = "patients"
        ordering = ["full_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "patient_number"], name="uniq_patient_number_per_workspace"
            )
        ]
        indexes = [
            models.Index(fields=["workspace", "full_name"]),
            models.Index(fields=["workspace", "patient_number"]),
        ]

    def __str__(self):
        return f"{self.patient_number} · {self.full_name}"

    @property
    def age(self):
        """Years, from whichever of the two the clinic was given."""
        if self.stated_age:
            return self.stated_age
        if not self.date_of_birth:
            return None
        from django.utils import timezone

        today = timezone.localdate()
        return (
            today.year
            - self.date_of_birth.year
            - ((today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day))
        )


class Visit(WorkspaceScoped):
    """One attendance: the queue slot, the consultation and its record."""

    STATUS_CHOICES = [
        ("waiting", "Waiting"),
        ("in_consultation", "With the clinician"),
        ("to_dispense", "Waiting for medicine"),
        ("closed", "Closed"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="visits")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="waiting")

    complaint = models.TextField(blank=True, default="")

    # Vitals, as a nurse takes them. Text rather than numbers for blood
    # pressure because it is written "120/80" and splitting it buys nothing.
    temperature = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    blood_pressure = models.CharField(max_length=20, blank=True, default="")
    pulse = models.PositiveSmallIntegerField(null=True, blank=True)
    weight = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)

    examination = models.TextField(blank=True, default="")
    diagnosis = models.TextField(blank=True, default="")
    treatment_plan = models.TextField(blank=True, default="")

    clinician = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="visits"
    )
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "visits"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "status", "-created_at"])]

    def __str__(self):
        return f"{self.patient_id} · {self.created_at:%Y-%m-%d}"


class Prescription(WorkspaceScoped):
    """One medicine ordered at a visit, and what was actually handed over.

    Ordered and dispensed are separate on purpose. A clinician writes for
    thirty tablets; the dispensary has twenty. The record has to be able to say
    that, rather than quietly agreeing with whichever number was typed last.
    """

    visit = models.ForeignKey(Visit, on_delete=models.CASCADE, related_name="prescriptions")
    # Denormalised so a patient's medicine history is one query, not a join
    # through every visit they have ever made.
    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="prescriptions"
    )

    # Null when the clinician writes for something this dispensary does not
    # stock — which happens, and losing the order because of it would be worse.
    product = models.ForeignKey(
        "inventory.Product",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="prescriptions",
    )
    medicine = models.CharField(max_length=200)
    dose = models.CharField(max_length=120, blank=True, default="")
    frequency = models.CharField(max_length=120, blank=True, default="")
    duration = models.CharField(max_length=120, blank=True, default="")
    instructions = models.CharField(max_length=255, blank=True, default="")

    quantity_ordered = models.PositiveIntegerField(default=0)
    quantity_dispensed = models.PositiveIntegerField(default=0)
    dispensed_at = models.DateTimeField(null=True, blank=True)
    dispensed_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dispensed",
    )

    class Meta:
        db_table = "prescriptions"
        ordering = ["created_at"]
        indexes = [models.Index(fields=["workspace", "-created_at"])]

    def __str__(self):
        return f"{self.medicine} x{self.quantity_ordered}"

    @property
    def outstanding(self) -> int:
        return max(0, self.quantity_ordered - self.quantity_dispensed)
