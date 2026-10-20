"""The trust boundary.

Everything the agent is allowed to see is decided here and nowhere else. The
model never supplies a workspace, a user or a role: it supplies a question and,
at most, a date range and a few filters. Tenant identity is resolved from a
verified JWT or a verified WhatsApp link before the model is ever called, and
travels to the tools as a separate argument from the model's parameters.

That separation is the whole security design. A tool signature looks like

    run(params: dict, ctx: AgentContext)

and no tool's JSON schema declares a workspace, business or tenant field, so
there is nothing for the model to forge and nothing for a tool author to forget
to filter. `test_no_tool_accepts_a_tenant_parameter` fails the build if that
ever stops being true.
"""

from __future__ import annotations

from dataclasses import dataclass
from zoneinfo import ZoneInfo

from rest_framework.exceptions import PermissionDenied

from apps.accounts.models import Membership

# Where the shops are. A workspace carries its own timezone, but a row written
# before that field existed falls back to here rather than to UTC, which would
# put "today" three hours behind the counter.
DEFAULT_TIMEZONE = "Africa/Kampala"


@dataclass(frozen=True)
class AgentContext:
    """Who is asking, on behalf of which business, with what authority."""

    user: object
    workspace: object
    role: str
    channel: str  # "whatsapp" | "web"

    @property
    def tz(self) -> ZoneInfo:
        name = getattr(self.workspace, "timezone", "") or DEFAULT_TIMEZONE
        try:
            return ZoneInfo(name)
        except Exception:
            # A workspace saved with a timezone this machine's database does
            # not know should not take the whole assistant down.
            return ZoneInfo(DEFAULT_TIMEZONE)

    @property
    def currency(self) -> str:
        return getattr(self.workspace, "currency_symbol", "") or "UGX"

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"

    def workspace_id_safe(self):
        """For log lines, which must never be the thing that raises."""
        return getattr(self.workspace, "id", None)


def live_role(user, workspace) -> str:
    """Read the role off Membership now, rather than trusting a stored copy.

    A WhatsApp link made last month must not keep answering after the owner
    deactivated that member this morning, so the role is never cached on the
    link row — it is looked up on every single message.

    The platform owner stands in any business, matching `resolve_workspace`.
    """
    if getattr(user, "is_superuser", False):
        return "owner"
    membership = Membership.objects.filter(
        user=user, workspace=workspace, active=True
    ).first()
    if membership is None:
        raise PermissionDenied("You no longer have access to this business.")
    return membership.role


def build_context(*, user, workspace, channel: str) -> AgentContext:
    """The only sanctioned way to make a context.

    Applies the same gates as the REST API: a suspended business, an unverified
    owner or an unpaid subscription stops the assistant exactly as it stops the
    dashboard. An assistant that kept answering after the app locked would be a
    way around the lock.
    """
    from apps.core.tenancy import ensure_email_verified, ensure_workspace_paid

    if workspace is None:
        raise PermissionDenied("No business selected.")

    role = live_role(user, workspace)
    ensure_email_verified(user, role)
    ensure_workspace_paid(workspace)
    return AgentContext(user=user, workspace=workspace, role=role, channel=channel)
