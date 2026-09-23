from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView

from apps.accounts.views import (
    BillingInfoView,
    LoginView,
    MembershipViewSet,
    MeView,
    RegisterView,
    ResendVerificationView,
    VerifyEmailView,
    MobileMoneyChargeView,
    MobileMoneyStatusView,
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
    path("auth/verify-email/", VerifyEmailView.as_view(), name="verify-email"),
    path(
        "auth/resend-verification/",
        ResendVerificationView.as_view(),
        name="resend-verification",
    ),
    path("billing/", BillingInfoView.as_view(), name="billing"),
    path("billing/charge/", MobileMoneyChargeView.as_view(), name="billing-charge"),
    path(
        "billing/charge/<str:reference>/",
        MobileMoneyStatusView.as_view(),
        name="billing-charge-status",
    ),
    path("", include(router.urls)),
]
