"""Record every successful change made through the API.

Runs after the view, so DRF has already authenticated the request and copied
the user onto the underlying Django request. Request bodies are never stored:
they carry passwords and are not needed to say what happened.
"""

import logging
import re

from apps.console.models import ActivityLog

log = logging.getLogger(__name__)

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Logged elsewhere (sign-in, console decisions) or not activity at all.
SKIP = re.compile(r"^/api/(auth/(login|refresh|verify)/|console/|health/)")

RESOURCES = {
    "products": "product",
    "stock-transactions": "stock movement",
    "damage-reports": "damage report",
    "sales": "sale",
    "sale-items": "sale line",
    "expenses": "expense",
    "customers": "customer",
    "debts": "debt",
    "debt-payments": "debt payment",
    "bottle-movements": "bottle movement",
    "suppliers": "supplier",
    "purchases": "purchase",
    "quotations": "quotation",
    "shifts": "shift",
    "members": "staff member",
    "workspaces": "business settings",
    "subscription-payments": "subscription payment",
}

CUSTOM = {
    ("auth", "register"): "signed up a new business",
    ("products", "clear"): "cleared the stock list",
    ("workspaces", "erase-data"): "erased all business data",
    ("members", "deactivate"): "deactivated a staff member",
    ("expenses", "approve"): "approved an expense",
    ("expenses", "reject"): "rejected an expense",
}

VERBS = {"POST": "added", "PUT": "updated", "PATCH": "updated", "DELETE": "deleted"}


def describe(method, path):
    parts = [p for p in path.split("/") if p][1:]  # drop "api"
    if not parts:
        return ""
    resource = parts[0]
    if len(parts) >= 2 and (resource, parts[-1]) in CUSTOM:
        return CUSTOM[(resource, parts[-1])]
    if resource == "sales" and method == "POST" and len(parts) == 1:
        return "made a sale"
    if resource == "subscription-payments" and method == "POST":
        return "submitted a subscription payment"
    label = RESOURCES.get(resource, resource.replace("-", " "))
    return f"{VERBS[method]} {label}"


def target_from(data):
    if not isinstance(data, dict):
        return ""
    for key in ("name", "transaction_id", "full_name", "email", "description", "total_amount"):
        value = data.get(key)
        if value not in (None, ""):
            return value
    return ""


class ActivityLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            request.method in WRITE_METHODS
            and request.path.startswith("/api/")
            and not SKIP.match(request.path)
            and response.status_code < 400
        ):
            try:
                self.record(request, response)
            except Exception:  # never let the audit trail break a sale
                log.exception("Could not record activity for %s", request.path)
        return response

    def record(self, request, response):
        from apps.accounts.models import User, Workspace
        from apps.core.tenancy import resolve_workspace

        action = describe(request.method, request.path)
        if not action:
            return
        data = getattr(response, "data", None)

        user = getattr(request, "user", None)
        workspace = None
        if request.path.startswith("/api/auth/register/") and isinstance(data, dict):
            user = User.objects.filter(pk=(data.get("user") or {}).get("id")).first()
            workspace = Workspace.objects.filter(pk=(data.get("workspace") or {}).get("id")).first()
        elif user is not None and user.is_authenticated:
            try:
                workspace, _ = resolve_workspace(request)
            except Exception:
                workspace = None
        else:
            return

        ActivityLog.record(
            request,
            action,
            user=user,
            workspace=workspace,
            target=target_from(data),
            status_code=response.status_code,
        )
