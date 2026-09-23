from django.urls import include, path
from django.views.decorators.csrf import csrf_exempt
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView

from apps.accounts.views import (
    BillingInfoView,
    LoginView,
    MembershipViewSet,
    MeView,
    RegisterView,
    FlutterwaveCheckoutView,
    FlutterwaveVerifyView,
    FlutterwaveWebhookView,
    SubscriptionPaymentViewSet,
    WorkspaceViewSet,
)

router = DefaultRouter()
router.register("workspaces", WorkspaceViewSet, basename="workspace")
router.register("members", MembershipViewSet, basename="member")
router.register(
    "subscription-payments", SubscriptionPaymentViewSet, basename="subscription-payment"
)

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/verify/", TokenVerifyView.as_view(), name="token-verify"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("billing/", BillingInfoView.as_view(), name="billing"),
    path("billing/checkout/", FlutterwaveCheckoutView.as_view(), name="billing-checkout"),
    path("billing/verify/", FlutterwaveVerifyView.as_view(), name="billing-verify"),
    # Flutterwave posts here, not a browser: no session, no CSRF token, and the
    # shared hash instead.
    path(
        "billing/flutterwave-webhook/",
        csrf_exempt(FlutterwaveWebhookView.as_view()),
        name="billing-flutterwave-webhook",
    ),
    path("", include(router.urls)),
]
