from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.clinical.views import PatientViewSet, PrescriptionViewSet, VisitViewSet

router = DefaultRouter()
router.register("patients", PatientViewSet, basename="patient")
router.register("visits", VisitViewSet, basename="visit")
router.register("prescriptions", PrescriptionViewSet, basename="prescription")

urlpatterns = [path("", include(router.urls))]
