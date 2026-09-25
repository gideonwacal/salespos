"""The platform owner's console API.

Every endpoint here is superuser-only and crosses tenant boundaries on
purpose: it is how the owner of SalesPos watches every business, decides what
each one may do, and confirms subscription payments.
"""

from datetime import datetime, time, timedelta

from django.db import transaction
from django.db.models import Count, Max, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.cache import add_never_cache_headers
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Membership, SubscriptionPayment, User, Workspace
from apps.console.models import ActivityLog
from apps.inventory.models import Product
from apps.sales.models import Sale


class IsPlatformOwner(BasePermission):
    message = "This area is for the SalesPos platform owner only."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_active and user.is_superuser)


class ConsoleView(APIView):
    permission_classes = [IsPlatformOwner]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        add_never_cache_headers(response)
        return response

    def audit(self, request, action, *, workspace=None, target=""):
        ActivityLog.record(
            request, action, user=request.user, workspace=workspace, target=target,
            status_code=200, by_platform=True,
        )


def limit_offset(request, default=50, maximum=500):
    try:
        limit = min(max(int(request.query_params.get("limit", default)), 1), maximum)
        offset = max(int(request.query_params.get("offset", 0)), 0)
    except ValueError:
        limit, offset = default, 0
    return limit, offset


def billing_state(workspace, now):
    # Unreviewed comes first on purpose: a business nobody has looked at is the
    # thing to act on, whatever its trial says.
    if workspace.reviewed_at is None:
        return "unreviewed"
    if workspace.access == "suspended":
        return "suspended"
    if workspace.access == "free":
        return "free"
    if workspace.subscribed and workspace.paid_until and workspace.paid_until > now:
        return "paying"
    if workspace.trial_ends and workspace.trial_ends > now:
        return "trial"
    return "expired"


def iso(value):
    return value.isoformat() if value else None


def activity_row(entry):
    return {
        "id": str(entry.id),
        "created_at": iso(entry.created_at),
        "action": entry.action,
        "target": entry.target,
        "method": entry.method,
        "path": entry.path,
        "ip": entry.ip,
        "by_platform": entry.by_platform,
        "user": entry.user.email if entry.user else None,
        "user_id": str(entry.user_id) if entry.user_id else None,
        "workspace": entry.workspace.name if entry.workspace else None,
        "workspace_id": str(entry.workspace_id) if entry.workspace_id else None,
    }


def payment_row(payment):
    return {
        "id": str(payment.id),
        "workspace": payment.workspace.name,
        "workspace_id": str(payment.workspace_id),
        "submitted_by": payment.submitted_by.email if payment.submitted_by else None,
        "plan": payment.plan,
        "months": payment.months,
        "amount": str(payment.amount),
        "currency": payment.currency,
        "payer_phone": payment.payer_phone,
        "transaction_id": payment.transaction_id,
        "status": payment.status,
        "note": payment.note,
        "reviewed_at": iso(payment.reviewed_at),
        "created_at": iso(payment.created_at),
    }


class OverviewView(ConsoleView):
    """GET /api/console/overview/"""

    def get(self, request):
        now = timezone.now()
        month_start = timezone.make_aware(
            datetime.combine(now.date().replace(day=1), time.min)
        )
        workspaces = list(Workspace.objects.all())
        states = {"trial": 0, "paying": 0, "expired": 0, "free": 0, "suspended": 0}
        for workspace in workspaces:
            states[billing_state(workspace, now)] += 1

        approved = SubscriptionPayment.objects.filter(status="approved")
        return Response(
            {
                "businesses": len(workspaces),
                "states": states,
                "users": User.objects.count(),
                "active_users_7d": ActivityLog.objects.filter(
                    created_at__gte=now - timedelta(days=7), user__isnull=False
                ).values("user").distinct().count(),
                "signups_30d": Workspace.objects.filter(
                    created_at__gte=now - timedelta(days=30)
                ).count(),
                "pending_payments": SubscriptionPayment.objects.filter(status="pending").count(),
                "revenue_total": str(approved.aggregate(t=Sum("amount"))["t"] or 0),
                "revenue_month": str(
                    approved.filter(reviewed_at__gte=month_start).aggregate(t=Sum("amount"))["t"]
                    or 0
                ),
                "activity_24h": ActivityLog.objects.filter(
                    created_at__gte=now - timedelta(hours=24)
                ).count(),
                "recent_activity": [
                    activity_row(e)
                    for e in ActivityLog.objects.select_related("user", "workspace")[:15]
                ],
            }
        )


class BusinessListView(ConsoleView):
    """GET /api/console/businesses/?search=&state="""

    def get(self, request):
        now = timezone.now()
        queryset = Workspace.objects.annotate(
            member_count=Count("memberships", filter=Q(memberships__active=True), distinct=True),
        ).order_by("-created_at")
        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
                | Q(memberships__user__email__icontains=search)
            ).distinct()

        last_seen = dict(
            ActivityLog.objects.filter(workspace__isnull=False)
            .values_list("workspace")
            .annotate(last=Max("created_at"))
        )
        owners = {}
        for membership in Membership.objects.filter(role="owner").select_related("user"):
            owners.setdefault(membership.workspace_id, membership.user.email)

        wanted = request.query_params.get("state", "")
        rows = []
        for workspace in queryset:
            state = billing_state(workspace, now)
            if wanted and state != wanted:
                continue
            rows.append(
                {
                    "id": str(workspace.id),
                    "name": workspace.name,
                    "industry": workspace.industry,
                    "city": workspace.city,
                    "phone": workspace.phone,
                    "owner": owners.get(workspace.id),
                    "plan": workspace.plan,
                    "access": workspace.access,
                    "state": state,
                    "trial_ends": iso(workspace.trial_ends),
                    "paid_until": iso(workspace.paid_until),
                    "members": workspace.member_count,
                    "last_activity": iso(last_seen.get(workspace.id)),
                    "reviewed_at": iso(workspace.reviewed_at),
                    "email": workspace.email,
                    "created_at": iso(workspace.created_at),
                }
            )
        return Response(rows)


class BusinessReviewView(ConsoleView):
    """POST /api/console/businesses/<id>/review/ — "I have looked at this one."

    Deliberately not an approval: the business was never held waiting for it.
    It is a record that somebody at the platform has seen the shop, checked the
    name and the phone number, and is content to have it here — which is the
    check an email round trip was never really doing.
    """

    def post(self, request, pk):
        workspace = get_object_or_404(Workspace, pk=pk)
        first_time = workspace.reviewed_at is None

        workspace.reviewed_at = timezone.now()
        workspace.reviewed_by = request.user
        workspace.save(update_fields=["reviewed_at", "reviewed_by"])

        if first_time:
            ActivityLog.record(
                request,
                "reviewed a new business",
                workspace=workspace,
                target=workspace.name,
                by_platform=True,
            )
        return Response({"id": str(workspace.id), "reviewed_at": iso(workspace.reviewed_at)})


class BusinessDetailView(ConsoleView):
    """GET/PATCH /api/console/businesses/<id>/ — look at one business, decide its fate."""

    EDITABLE = {"access", "access_note", "plan", "trial_ends", "paid_until", "subscribed"}

    def payload(self, workspace):
        now = timezone.now()
        sales = Sale.objects.filter(workspace=workspace)
        return {
            "id": str(workspace.id),
            "name": workspace.name,
            "tagline": workspace.tagline,
            "industry": workspace.industry,
            "address": workspace.address,
            "city": workspace.city,
            "country": workspace.country,
            "phone": workspace.phone,
            "email": workspace.email,
            "currency": workspace.currency,
            "plan": workspace.plan,
            "access": workspace.access,
            "access_note": workspace.access_note,
            "state": billing_state(workspace, now),
            "subscribed": workspace.subscribed,
            "trial_ends": iso(workspace.trial_ends),
            "paid_until": iso(workspace.paid_until),
            "configured": workspace.configured,
            "reviewed_at": iso(workspace.reviewed_at),
            "reviewed_by": workspace.reviewed_by.email if workspace.reviewed_by else None,
            "created_at": iso(workspace.created_at),
            "stats": {
                "sales": sales.count(),
                "sales_total": str(sales.aggregate(t=Sum("total_amount"))["t"] or 0),
                "sales_30d": sales.filter(created_at__gte=now - timedelta(days=30)).count(),
                "products": Product.objects.filter(workspace=workspace).count(),
            },
            "members": [
                {
                    "id": str(m.id),
                    "user_id": str(m.user_id),
                    "email": m.user.email,
                    "full_name": m.user.full_name,
                    "phone": m.user.phone,
                    "role": m.role,
                    "active": m.active,
                    "user_active": m.user.is_active,
                    "last_login": iso(m.user.last_login),
                }
                for m in workspace.memberships.select_related("user").order_by("created_at")
            ],
            "payments": [
                payment_row(p)
                for p in workspace.subscription_payments.select_related("workspace", "submitted_by")
            ],
            "activity": [
                activity_row(e)
                for e in ActivityLog.objects.filter(workspace=workspace).select_related(
                    "user", "workspace"
                )[:100]
            ],
        }

    def get(self, request, pk):
        return Response(self.payload(get_object_or_404(Workspace, pk=pk)))

    @transaction.atomic
    def patch(self, request, pk):
        workspace = get_object_or_404(Workspace.objects.select_for_update(), pk=pk)
        data = {k: v for k, v in request.data.items() if k in self.EDITABLE}
        errors = {}
        changes = []

        if "access" in data:
            if data["access"] not in dict(Workspace.ACCESS_CHOICES):
                errors["access"] = "Choose standard, free or suspended."
            elif data["access"] != workspace.access:
                changes.append(f"access {workspace.access} → {data['access']}")
                workspace.access = data["access"]
        if "access_note" in data:
            workspace.access_note = str(data["access_note"] or "")[:255]
        if "plan" in data:
            if data["plan"] not in dict(Workspace.PLAN_CHOICES):
                errors["plan"] = "Unknown plan."
            elif data["plan"] != workspace.plan:
                changes.append(f"plan {workspace.plan} → {data['plan']}")
                workspace.plan = data["plan"]
        if "subscribed" in data and bool(data["subscribed"]) != workspace.subscribed:
            workspace.subscribed = bool(data["subscribed"])
            changes.append(f"subscribed = {workspace.subscribed}")
        for field in ("trial_ends", "paid_until"):
            if field not in data:
                continue
            raw = data[field]
            if raw in (None, ""):
                if field == "trial_ends":
                    errors[field] = "A trial end date is required."
                    continue
                if getattr(workspace, field) is not None:
                    setattr(workspace, field, None)
                    changes.append(f"{field} cleared")
                continue
            try:
                value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError:
                errors[field] = "Use a date like 2026-12-31."
                continue
            if timezone.is_naive(value):
                value = timezone.make_aware(datetime.combine(value.date(), time(23, 59)))
            current = getattr(workspace, field)
            if current is not None and current.date() == value.date():
                continue
            setattr(workspace, field, value)
            changes.append(f"{field} → {value.date().isoformat()}")

        if errors:
            transaction.set_rollback(True)
            return Response(errors, status=400)

        workspace.save()
        if changes:
            self.audit(request, "changed business: " + "; ".join(changes), workspace=workspace,
                       target=workspace.name)
        return Response(self.payload(workspace))


class UserListView(ConsoleView):
    """GET /api/console/users/?search="""

    def get(self, request):
        queryset = User.objects.order_by("-created_at").prefetch_related("memberships__workspace")
        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(email__icontains=search) | Q(full_name__icontains=search) | Q(phone__icontains=search)
            )
        last_seen = dict(
            ActivityLog.objects.filter(user__isnull=False)
            .values_list("user")
            .annotate(last=Max("created_at"))
        )
        return Response(
            [
                {
                    "id": str(u.id),
                    "email": u.email,
                    "full_name": u.full_name,
                    "phone": u.phone,
                    "is_active": u.is_active,
                    "is_superuser": u.is_superuser,
                    "last_login": iso(u.last_login),
                    "last_activity": iso(last_seen.get(u.id)),
                    "created_at": iso(u.created_at),
                    "businesses": [
                        {
                            "id": str(m.workspace_id),
                            "name": m.workspace.name,
                            "role": m.role,
                            "active": m.active,
                        }
                        for m in u.memberships.all()
                    ],
                }
                for u in queryset
            ]
        )


class UserDetailView(ConsoleView):
    """PATCH /api/console/users/<id>/ — block or restore someone's sign-in."""

    def patch(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        if "is_active" not in request.data:
            return Response({"is_active": "Nothing to change."}, status=400)
        active = bool(request.data["is_active"])
        if user == request.user and not active:
            return Response({"is_active": "You can't block your own account."}, status=400)
        if user.is_superuser and not active:
            return Response({"is_active": "Platform owner accounts can't be blocked here."},
                            status=400)
        user.is_active = active
        user.save(update_fields=["is_active"])
        self.audit(request, "restored user sign-in" if active else "blocked user sign-in",
                   target=user.email)
        return Response({"id": str(user.id), "is_active": user.is_active})


class PaymentListView(ConsoleView):
    """GET /api/console/payments/?status="""

    def get(self, request):
        queryset = SubscriptionPayment.objects.select_related("workspace", "submitted_by")
        wanted = request.query_params.get("status", "")
        if wanted:
            queryset = queryset.filter(status=wanted)
        limit, offset = limit_offset(request, default=200)
        return Response([payment_row(p) for p in queryset[offset : offset + limit]])


class PaymentDecisionView(ConsoleView):
    """POST /api/console/payments/<id>/approve/ or /reject/"""

    def post(self, request, pk, decision):
        if decision not in ("approve", "reject"):
            return Response({"detail": "Not found."}, status=404)
        payment =get_object_or_404(SubscriptionPayment.objects.select_related("workspace"), pk=pk)
        if payment.status != "pending":
            return Response({"detail": f"This payment is already {payment.status}."}, status=400)
        if decision == "approve":
            payment.approve()
            action = "approved subscription payment"
        else:
            payment.reject(str(request.data.get("note", "")) or "Payment not found on the MTN statement.")
            action = "rejected subscription payment"
        self.audit(request, action, workspace=payment.workspace, target=payment.transaction_id)
        payment.refresh_from_db()
        return Response(payment_row(payment))


class ActivityListView(ConsoleView):
    """GET /api/console/activity/?workspace=&user=&search=&limit=&offset="""

    def get(self, request):
        queryset = ActivityLog.objects.select_related("user", "workspace")
        params = request.query_params
        if params.get("workspace"):
            queryset = queryset.filter(workspace_id=params["workspace"])
        if params.get("user"):
            queryset = queryset.filter(user_id=params["user"])
        if params.get("search"):
            term = params["search"].strip()
            queryset = queryset.filter(
                Q(action__icontains=term)
                | Q(target__icontains=term)
                | Q(user__email__icontains=term)
                | Q(workspace__name__icontains=term)
            )
        limit, offset = limit_offset(request, default=100)
        rows = list(queryset[offset : offset + limit + 1])
        return Response(
            {
                "results": [activity_row(e) for e in rows[:limit]],
                "has_more": len(rows) > limit,
            }
        )
