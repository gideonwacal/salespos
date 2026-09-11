"""Operations that span every app in the workspace."""

from django.apps import apps as django_apps
from django.db import transaction

from apps.core.models import WorkspaceScoped


def workspace_models():
    """Every concrete table that belongs to a workspace.

    Derived from the base class rather than listed by hand, so a new app that
    inherits WorkspaceScoped is covered the day it is added instead of being
    quietly left behind in the next erase.
    """
    return [
        model
        for model in django_apps.get_models()
        if issubclass(model, WorkspaceScoped) and not model._meta.abstract
    ]


@transaction.atomic
def erase_workspace_data(*, workspace) -> dict:
    """Empty the business out, keeping the people who run it.

    Every workspace-scoped row goes: stock, sales, expenses, customers, debts,
    suppliers, quotations, the lot. Users, their memberships and the business
    profile itself are untouched — they are not data the shop entered, they are
    who is allowed in and what the shop is called. The owner stays signed in
    and the staff keep their logins.

    One transaction, because a half-erased shop is worse than either end of it.
    """
    models = workspace_models()

    # Counted before anything is deleted: once a cascade has run, the rows it
    # took are gone from the tables that would otherwise report them.
    counts = {
        model._meta.model_name: model.objects.filter(workspace=workspace).count()
        for model in models
    }

    for model in models:
        model.objects.filter(workspace=workspace).delete()

    return {"erased": sum(counts.values()), "tables": counts}
