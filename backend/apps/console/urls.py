from django.urls import path

from apps.console import views

urlpatterns = [
    path("console/overview/", views.OverviewView.as_view(), name="console-overview"),
    path("console/businesses/", views.BusinessListView.as_view(), name="console-businesses"),
    path(
        "console/businesses/<uuid:pk>/",
        views.BusinessDetailView.as_view(),
        name="console-business",
    ),
    path("console/users/", views.UserListView.as_view(), name="console-users"),
    path("console/users/<uuid:pk>/", views.UserDetailView.as_view(), name="console-user"),
    path("console/payments/", views.PaymentListView.as_view(), name="console-payments"),
    path(
        "console/payments/<uuid:pk>/<str:decision>/",
        views.PaymentDecisionView.as_view(),
        name="console-payment-decision",
    ),
    path("console/activity/", views.ActivityListView.as_view(), name="console-activity"),
]
