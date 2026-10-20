from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.ai.views import (
    ChatView,
    ConversationViewSet,
    WhatsAppIdentityViewSet,
    WhatsAppWebhookView,
)

router = DefaultRouter()
router.register("ai/conversations", ConversationViewSet, basename="ai-conversation")
router.register("ai/whatsapp-identities", WhatsAppIdentityViewSet, basename="whatsapp-identity")

urlpatterns = [
    path("ai/chat/", ChatView.as_view(), name="ai-chat"),
    path("webhooks/whatsapp/", WhatsAppWebhookView.as_view(), name="whatsapp-webhook"),
    path("", include(router.urls)),
]
