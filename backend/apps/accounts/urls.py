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
    StripeCheckoutView,
    StripeWebhookView,
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
    path("billing/checkout/", StripeCheckoutView.as_view(), name="billing-checkout"),
    # Stripe posts here, not a browser: no session, no CSRF token, signature only.
    path(
        "billing/stripe-webhook/",
        csrf_exempt(StripeWebhookView.as_view()),
        name="billing-stripe-webhook",
    ),
    path("", include(router.urls)),
]
