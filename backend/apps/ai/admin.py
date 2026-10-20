from django.contrib import admin

from apps.ai.models import Conversation, Message, PendingAction, ToolCall, WhatsAppIdentity


@admin.register(WhatsAppIdentity)
class WhatsAppIdentityAdmin(admin.ModelAdmin):
    list_display = ["phone", "user", "workspace", "verified_at", "active", "last_seen_at"]
    list_filter = ["active", "workspace"]
    search_fields = ["phone", "user__email", "workspace__name"]
    readonly_fields = ["created_at", "last_seen_at"]


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ["id", "workspace", "user", "channel", "last_active_at"]
    list_filter = ["channel", "workspace"]
    readonly_fields = ["created_at"]


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ["created_at", "workspace", "role", "content"]
    list_filter = ["role", "workspace"]
    readonly_fields = ["created_at"]


@admin.register(ToolCall)
class ToolCallAdmin(admin.ModelAdmin):
    """The audit trail. Refusals are as interesting as the successes."""

    list_display = ["created_at", "workspace", "name", "ok", "duration_ms", "error"]
    list_filter = ["ok", "name", "workspace"]
    search_fields = ["name", "error"]
    readonly_fields = ["created_at"]


@admin.register(PendingAction)
class PendingActionAdmin(admin.ModelAdmin):
    list_display = ["created_at", "workspace", "tool", "summary", "confirmed_at", "cancelled_at"]
    list_filter = ["tool", "workspace"]
    readonly_fields = ["created_at"]
