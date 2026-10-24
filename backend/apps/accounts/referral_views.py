"""The referral link, the page behind it, and the signup it credits."""

from __future__ import annotations

from django.conf import settings
from django.utils.cache import add_never_cache_headers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts import referrals
from apps.core.tenancy import resolve_workspace


def link_for(code: str) -> str:
    base = (settings.APP_BASE_URL or "").rstrip("/")
    return f"{base}/r/{code}"


class MyReferralsView(APIView):
    """GET /api/referrals/me/ — this business's link and how it is doing.

    Owner only. A referral link is how a business buys itself three days, and
    the staff who cannot pay the subscription have no business issuing one.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace, role = resolve_workspace(request)
        if workspace is None:
            self.permission_denied(request, message="No business selected.")
        if role != "owner":
            self.permission_denied(
                request, message="Only the business owner can see the referral link."
            )

        code = referrals.code_for(workspace)
        response = Response(
            {
                "code": code,
                "link": link_for(code),
                **referrals.counts(workspace),
                "businesses": referrals.referred_businesses(workspace),
                "visits": referrals.recent_visits(workspace),
            }
        )
        # The link is a credential of sorts; keep it out of shared caches.
        add_never_cache_headers(response)
        return response


class ReferralVisitView(APIView):
    """POST /api/referrals/visit/ — somebody opened an invite link.

    Public by necessity: the person opening the link has no account yet, which
    is the entire point of the link. Throttled, because an open endpoint that
    writes a row is an invitation to fill the table.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "referral_visit"

    def post(self, request):
        workspace = referrals.resolve(request.data.get("code", ""))
        if workspace is None:
            # Deliberately the same answer as a valid code. Telling a stranger
            # which codes exist turns this into a way of enumerating them.
            return Response({"ok": True, "business": None})
        referrals.record_visit(workspace, request)
        return Response({"ok": True, "business": workspace.name})
