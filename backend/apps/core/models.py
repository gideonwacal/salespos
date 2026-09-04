"""Shared model bases.

Every business table is scoped to a workspace. Putting the FK on an abstract
base means no domain model can quietly forget its tenant.
"""

import uuid

from django.db import models


class UUIDModel(models.Model):
    """UUID primary keys, because the frontend treats every id as a string."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True


class WorkspaceScoped(UUIDModel):
    """A row that belongs to exactly one workspace."""

    workspace = models.ForeignKey(
        "accounts.Workspace",
        on_delete=models.CASCADE,
        related_name="%(class)ss",
    )

    class Meta:
        abstract = True
