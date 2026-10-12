"""Patients, visits and dispensing — the rules that protect a patient record."""

from decimal import Decimal

from rest_framework.test import APITestCase

from apps.accounts.models import Membership, User, Workspace
from apps.clinical.models import Patient, Prescription, Visit
from apps.inventory.models import Product, StockTransaction


class ClinicalTests(APITestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name="Bright Clinic")
        self.clinician = User.objects.create_user(
            email="clinician@clinic.com", password="sup3rsecret!", full_name="Dr Aine"
        )
        Membership.objects.create(
            user=self.clinician, workspace=self.workspace, role="owner"
        )
        self.client.force_authenticate(self.clinician)
        self.headers = {"HTTP_X_WORKSPACE": str(self.workspace.id)}

        self.amoxil = Product.objects.create(
            workspace=self.workspace,
            name="Amoxil 500mg",
            unit_buying_price=Decimal("400"),
            unit_selling_price=Decimal("700"),
            stock_quantity=30,
        )

    def register(self, **overrides):
        body = {"full_name": "Aisha Nakato", "stated_age": 29, "sex": "female", **overrides}
        return self.client.post("/api/patients/", body, format="json", **self.headers)

    # --- patients ------------------------------------------------------------

    def test_card_numbers_are_issued_not_typed(self):
        first = self.register()
        second = self.register(full_name="Joseph Okello")
        self.assertEqual(first.data["patient_number"], "P00001")
        self.assertEqual(second.data["patient_number"], "P00002")

    def test_a_deleted_patient_does_not_hand_their_number_on(self):
        """Two files with one number is a mix-up nobody notices in time."""
        self.register()
        self.register(full_name="Joseph Okello")
        Patient.objects.get(patient_number="P00002").delete()

        third = self.register(full_name="Grace Among")
        self.assertEqual(third.data["patient_number"], "P00003")

    def test_age_is_taken_from_whichever_was_given(self):
        stated = self.register().data
        self.assertEqual(stated["age"], 29)

        dated = self.register(
            full_name="Peter Ssali", stated_age=None, date_of_birth="2000-01-01"
        ).data
        self.assertGreaterEqual(dated["age"], 25)

    # --- visits --------------------------------------------------------------

    def open_visit(self):
        patient = Patient.objects.create(
            workspace=self.workspace, patient_number="P00001", full_name="Aisha"
        )
        return self.client.post(
            "/api/visits/", {"patient_id": str(patient.id)}, format="json", **self.headers
        )

    def test_a_visit_starts_in_the_queue(self):
        response = self.open_visit()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], "waiting")

    def test_a_visit_carries_the_allergies_to_wherever_it_is_shown(self):
        """They are read before anything is prescribed, so they travel with it."""
        patient = Patient.objects.create(
            workspace=self.workspace,
            patient_number="P00009",
            full_name="Aisha",
            allergies="Penicillin",
        )
        visit = Visit.objects.create(workspace=self.workspace, patient=patient)

        response = self.client.get(f"/api/visits/{visit.id}/", **self.headers)
        self.assertEqual(response.data["allergies"], "Penicillin")

    # --- prescribing and dispensing -----------------------------------------

    def prescribe(self, quantity=10, product=True):
        patient = Patient.objects.create(
            workspace=self.workspace, patient_number="P00001", full_name="Aisha"
        )
        visit = Visit.objects.create(workspace=self.workspace, patient=patient)
        body = {
            "visit_id": str(visit.id),
            "medicine": "Amoxil 500mg",
            "quantity_ordered": quantity,
        }
        if product:
            body["product_id"] = str(self.amoxil.id)
        return self.client.post("/api/prescriptions/", body, format="json", **self.headers)

    def test_prescribing_takes_the_patient_from_the_visit(self):
        """Sending it twice would only create a way for the two to disagree."""
        response = self.prescribe()
        self.assertEqual(response.status_code, 201, response.data)

        order = Prescription.objects.get()
        self.assertEqual(order.patient_id, order.visit.patient_id)

    def test_prescribing_alone_moves_no_stock(self):
        self.prescribe()
        self.amoxil.refresh_from_db()
        self.assertEqual(self.amoxil.stock_quantity, 30)

    def test_dispensing_takes_it_off_the_shelf_and_says_who_for(self):
        order_id = self.prescribe().data["id"]

        response = self.client.post(
            f"/api/prescriptions/{order_id}/dispense/", {"quantity": 10}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 200, response.data)

        self.amoxil.refresh_from_db()
        self.assertEqual(self.amoxil.stock_quantity, 20)

        movement = StockTransaction.objects.get(product=self.amoxil)
        self.assertEqual(movement.type, "sale")
        self.assertIn("P00001", movement.notes)

    def test_a_short_dispense_leaves_the_rest_owed(self):
        """Ordered thirty, there are twenty: the record has to say so."""
        order_id = self.prescribe(quantity=30).data["id"]

        response = self.client.post(
            f"/api/prescriptions/{order_id}/dispense/", {"quantity": 20}, format="json", **self.headers
        )
        self.assertEqual(response.data["quantity_dispensed"], 20)
        self.assertEqual(response.data["outstanding"], 10)

    def test_dispensing_more_than_was_ordered_is_refused(self):
        order_id = self.prescribe(quantity=5).data["id"]
        response = self.client.post(
            f"/api/prescriptions/{order_id}/dispense/", {"quantity": 6}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 400)

    def test_dispensing_more_than_is_on_the_shelf_is_refused(self):
        order_id = self.prescribe(quantity=100).data["id"]
        response = self.client.post(
            f"/api/prescriptions/{order_id}/dispense/", {"quantity": 40}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 400)

        self.amoxil.refresh_from_db()
        self.assertEqual(self.amoxil.stock_quantity, 30)

    def test_something_we_do_not_stock_can_still_be_ordered(self):
        """Losing the order because the dispensary is out would be worse."""
        response = self.prescribe(product=False)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(Prescription.objects.get().product)

    # --- closing -------------------------------------------------------------

    def test_a_visit_will_not_close_over_undispensed_medicine(self):
        """Otherwise somebody goes home without their tablets and nothing says so."""
        order = Prescription.objects.get(pk=self.prescribe().data["id"])

        response = self.client.post(
            f"/api/visits/{order.visit_id}/close/", {}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 400)

        order.visit.refresh_from_db()
        self.assertNotEqual(order.visit.status, "closed")

    def test_it_can_be_closed_deliberately_over_one(self):
        order = Prescription.objects.get(pk=self.prescribe().data["id"])

        response = self.client.post(
            f"/api/visits/{order.visit_id}/close/", {"force": True}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "closed")

    # --- tenancy -------------------------------------------------------------

    def test_another_clinic_sees_none_of_these_patients(self):
        self.register()
        other = Workspace.objects.create(name="Other Clinic")
        stranger = User.objects.create_user(email="other@x.com", password="sup3rsecret!")
        Membership.objects.create(user=stranger, workspace=other, role="owner")

        self.client.force_authenticate(stranger)
        response = self.client.get("/api/patients/", HTTP_X_WORKSPACE=str(other.id))
        self.assertEqual(len(response.data["results"]), 0)
