from rest_framework import serializers

from apps.ai.models import Conversation, Message, WhatsAppIdentity


class ChatRequestSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000, trim_whitespace=True)
    # Lets the web client keep one thread across a page reload. Checked against
    # the caller's own workspace before it is used.
    conversation_id = serializers.UUIDField(required=False, allow_null=True)

    def validate_message(self, value):
        if not value.strip():
            raise serializers.ValidationError("Ask me something.")
        return value.strip()


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "role", "content", "created_at"]


class ConversationSerializer(serializers.ModelSerializer):
    messages = MessageSerializer(many=True, read_only=True)

    class Meta:
        model = Conversation
        fields = ["id", "channel", "last_active_at", "messages"]


class WhatsAppIdentitySerializer(serializers.ModelSerializer):
    verified = serializers.BooleanField(read_only=True)

    class Meta:
        model = WhatsAppIdentity
        fields = ["id", "phone", "verified", "verified_at", "last_seen_at", "active", "created_at"]
        read_only_fields = ["verified_at", "last_seen_at", "created_at"]
