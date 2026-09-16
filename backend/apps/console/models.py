"""The platform owner's audit trail.

Every change a shop makes through the API, every sign-in, and every decision
taken in the console lands here, so the console can answer "who did what, to
which business, and when" without digging through each domain table.
"""

import uuid

from django.conf import settings
from django.db import models


def client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR") or None


class ActivityLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    workspace = models.ForeignKey(
        "accounts.Workspace",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    action = models.CharField(max_length=120)
    # What it was done to, e.g. the product name or the transaction ID.
    target = models.CharField(max_length=200, blank=True, default="")
    method = models.CharField(max_length=10, blank=True, default="")
    path = models.CharField(max_length=255, blank=True, default="")
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    # True for decisions taken by the platform owner in the console.
    by_platform = models.BooleanField(default=False)

    class Meta:
        db_table = "activity_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["workspace", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.user} {self.action}"

    @classmethod
    def record(cls, request, action, *, user=None, workspace=None, target="", status_code=None,
               by_platform=False):
        return cls.objects.create(
            user=user,
            workspace=workspace,
            action=action[:120],
            target=str(target)[:200],
            method=request.method[:10],
            path=request.path[:255],
            status_code=status_code,
            ip=client_ip(request),
            by_platform=by_platform,
        )
