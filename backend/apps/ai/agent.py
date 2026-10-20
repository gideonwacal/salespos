"""The tool-calling loop.

One pass through `answer()` is: load enough history to understand a follow-up,
ask the model, run whatever tools it asked for (checking each one), hand the
results back, and repeat until it has words instead of tool calls. Then store
the turn.

Three things are deliberately kept away from the model:

  * which business is being asked about — that comes from AgentContext;
  * what today's date is — resolved in dates.py against the shop's clock;
  * whether the user said yes to a write — decided by `consent` below.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from apps.ai import tools as _tools  # noqa: F401  (registers every tool on import)
from apps.ai.dates import today_in
from apps.ai.models import Conversation, Message, PendingAction, ToolCall
from apps.ai.providers import AIUnavailable, Turn, get_provider
from apps.ai.registry import ToolDenied, ToolError, registry

log = logging.getLogger(__name__)

# How many past turns to replay. Enough for "what about yesterday?" to make
# sense, nowhere near enough to put the database in the prompt.
HISTORY_TURNS = 12
HISTORY_WINDOW = timedelta(hours=6)

# A model that keeps asking for tools is either confused or looping. Four
# rounds is more than any real question has needed.
MAX_ROUNDS = 4

GENERIC_FAILURE = (
    "I'm having trouble reaching your business data right now. "
    "Please try again in a moment."
)

SYSTEM_PROMPT = """You are the SalesPos assistant. You help the owner and staff \
of a Ugandan business understand their own shop through short WhatsApp-style \
messages.

How to answer:
- Lead with the figure asked for. Keep it to a few short lines.
- Use *bold* (single asterisks) for headline numbers and emoji sparingly as \
section markers. This is WhatsApp, not a report.
- Quote money exactly as the tools give it to you. Never recalculate, convert \
or round a figure yourself, and never add up numbers the tools did not add up.
- If a tool says there is no data, say so plainly. Never invent a figure, a \
product, a customer or a trend.
- Never mention tools, parameters, databases, IDs, workspaces or how you work. \
The person is a shopkeeper, not an engineer.
- Do not calculate dates. Pass the user's own words — "yesterday", "last \
month" — to the tools and let them work it out.
- If a question is ambiguous, ask one short clarifying question instead of \
guessing.
- Answer in the language the user writes in.

{business}
"""


def affirmative(text: str) -> bool:
    """Did the person agree, unambiguously?

    Deliberately narrow. A write that spends money or messages customers should
    need a clear yes, and anything else falls through to the model as an
    ordinary message. "yes but only the big ones" is not consent to the action
    as proposed.
    """
    cleaned = re.sub(r"[^a-z\s]", "", (text or "").lower()).strip()
    return cleaned in {
        "yes", "y", "yes please", "yep", "yeah", "yh", "sure", "ok", "okay",
        "go ahead", "do it", "confirm", "confirmed", "proceed", "send them",
        "send it", "yes do it", "yes go ahead", "please do", "eeh", "ok go ahead",
    }


def negative(text: str) -> bool:
    cleaned = re.sub(r"[^a-z\s]", "", (text or "").lower()).strip()
    return cleaned in {
        "no", "n", "nope", "cancel", "stop", "dont", "do not", "no thanks",
        "not now", "leave it", "nevermind", "never mind",
    }


class ConversationService:
    """Finding the right thread and remembering just enough of it."""

    @staticmethod
    def get_or_start(ctx, *, external_id: str = "") -> Conversation:
        existing = (
            Conversation.objects.filter(
                workspace=ctx.workspace,
                user=ctx.user,
                channel=ctx.channel,
                external_id=external_id or "",
                last_active_at__gte=timezone.now() - timedelta(days=1),
            )
            .order_by("-last_active_at")
            .first()
        )
        if existing:
            return existing
        return Conversation.objects.create(
            workspace=ctx.workspace,
            user=ctx.user,
            channel=ctx.channel,
            external_id=external_id or "",
        )

    @staticmethod
    def history(conversation: Conversation) -> list[dict]:
        """Recent turns, oldest first.

        Only user and assistant text is replayed. Tool results are not: they
        were already folded into the answer, and resending them grows the
        prompt without adding anything the reply does not already say.
        """
        rows = (
            Message.objects.filter(
                conversation=conversation,
                created_at__gte=timezone.now() - HISTORY_WINDOW,
            )
            .order_by("-created_at")[:HISTORY_TURNS]
        )
        return [{"role": m.role, "content": m.content} for m in reversed(list(rows))]


class AgentService:
    """Channel-independent. WhatsApp, the website and the dashboard all land here."""

    def __init__(self, provider=None):
        self.provider = provider or get_provider()

    # --- prompt ---------------------------------------------------------------

    def system_prompt(self, ctx) -> str:
        today = today_in(ctx.tz)
        business = (
            f"The business is {ctx.workspace.name}. "
            f"Today is {today:%A, %d %B %Y} in its local time. "
            f"Money is in {ctx.currency}. "
            f"You are speaking to {ctx.user.full_name or ctx.user.email}, "
            f"who is the {ctx.role}."
        )
        if not ctx.is_owner:
            business += (
                " They are not the owner, so some figures are not available to "
                "them. If a tool refuses, pass the refusal on politely and do "
                "not try another route to the same number."
            )
        return SYSTEM_PROMPT.format(business=business)

    # --- tools ----------------------------------------------------------------

    def run_tool(self, name: str, params: dict, ctx, conversation) -> dict:
        """Validate, authorize, execute, record. In that order, every time."""
        started = time.monotonic()
        record = {"name": name, "params": params, "ok": False, "error": "", "summary": ""}
        try:
            tool = registry.get(name)
            registry.authorize(tool, ctx)
            if tool.writes:
                # Proposed, never executed here. See `propose` below.
                raise ToolError("internal: write tools do not execute directly")
            if not isinstance(params, dict):
                raise ToolError("Tool arguments must be an object.")
            result = tool.run(params, ctx)
            record["ok"] = True
            record["summary"] = str(result)[:200]
            return result
        except (ToolError, ToolDenied) as exc:
            record["error"] = str(exc)[:255]
            return {"error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            # A bug in a tool must not become a stack trace in somebody's chat.
            log.exception("AI tool %s failed for workspace %s", name, ctx.workspace_id_safe())
            record["error"] = f"{type(exc).__name__}: {exc}"[:255]
            return {"error": "That information could not be loaded just now."}
        finally:
            ToolCall.objects.create(
                workspace=ctx.workspace,
                conversation=conversation,
                name=name[:80],
                params=record["params"] if isinstance(record["params"], dict) else {},
                ok=record["ok"],
                error=record["error"],
                result_summary=record["summary"],
                duration_ms=int((time.monotonic() - started) * 1000),
            )

    # --- the loop -------------------------------------------------------------

    def answer(self, *, ctx, text: str, external_id: str = "") -> str:
        conversation = ConversationService.get_or_start(ctx, external_id=external_id)
        Message.objects.create(
            workspace=ctx.workspace, conversation=conversation, role="user", content=text[:4000]
        )
        conversation.touch()

        reply = self._resolve(ctx=ctx, text=text, conversation=conversation)

        Message.objects.create(
            workspace=ctx.workspace,
            conversation=conversation,
            role="assistant",
            content=reply[:4000],
        )
        return reply

    def _resolve(self, *, ctx, text: str, conversation) -> str:
        # A pending write is settled before the model is consulted at all, so
        # consent is never something a language model interpreted.
        settled = self._settle_pending(ctx, text, conversation)
        if settled is not None:
            return settled

        declarations = [t.schema() for t in registry.for_role(ctx.role)]
        history = ConversationService.history(conversation)

        for _ in range(MAX_ROUNDS):
            try:
                turn: Turn = self.provider.respond(
                    system=self.system_prompt(ctx),
                    history=history,
                    tools=declarations,
                )
            except AIUnavailable as exc:
                log.warning("AI provider unavailable: %s", exc)
                return GENERIC_FAILURE

            if not turn.wants_tools:
                return (turn.text or "").strip() or (
                    "I did not understand that. Try asking about today's sales, "
                    "your stock, or who owes you money."
                )

            for request in turn.tool_requests:
                # A write is proposed, never run. The loop stops here: the next
                # thing that happens is the person saying yes or no.
                proposal = self._maybe_propose(request, ctx, conversation)
                if proposal is not None:
                    return proposal

                history.append(
                    {"role": "tool_request", "name": request.name, "content": request.params}
                )
                result = self.run_tool(request.name, request.params, ctx, conversation)
                history.append({"role": "tool", "name": request.name, "content": result})

        # Four rounds without an answer means the model is going in circles.
        log.warning("AI loop exhausted for workspace %s", ctx.workspace_id_safe())
        return (
            "I could not work that one out. Try asking it a different way, or "
            "ask about today's sales, your stock, or who owes you money."
        )

    def _maybe_propose(self, request, ctx, conversation) -> str | None:
        """If this is a write, describe it and ask. Returns None for reads."""
        try:
            tool = registry.get(request.name)
        except ToolError:
            return None  # unknown name; run_tool reports it to the model
        if not tool.writes:
            return None

        try:
            registry.authorize(tool, ctx)
            preview = (
                tool.preview(request.params, ctx)
                if tool.preview
                else {"question": f"Shall I {tool.name.replace('_', ' ')}?", "params": request.params}
            )
        except (ToolError, ToolDenied) as exc:
            ToolCall.objects.create(
                workspace=ctx.workspace, conversation=conversation, name=tool.name[:80],
                params=request.params if isinstance(request.params, dict) else {},
                ok=False, error=str(exc)[:255],
            )
            return str(exc)
        except Exception:  # noqa: BLE001
            log.exception("Preview of %s failed", tool.name)
            return GENERIC_FAILURE

        # Nothing to do — say so rather than asking them to approve a no-op.
        if preview.get("answer"):
            return preview["answer"]

        self.propose(
            ctx=ctx, conversation=conversation, tool_name=tool.name,
            params=preview.get("params") or {}, summary=preview["question"],
        )
        return preview["question"]

    # --- confirmation ---------------------------------------------------------

    def _settle_pending(self, ctx, text: str, conversation) -> str | None:
        """Run, cancel or expire a write the person was asked to approve."""
        pending = (
            PendingAction.objects.filter(conversation=conversation, confirmed_at=None, cancelled_at=None)
            .order_by("-created_at")
            .first()
        )
        if pending is None:
            return None

        if not pending.open:  # expired while they thought about it
            pending.cancelled_at = timezone.now()
            pending.save(update_fields=["cancelled_at"])
            return None

        if negative(text):
            pending.cancelled_at = timezone.now()
            pending.save(update_fields=["cancelled_at"])
            return "No problem — I haven't done anything."

        if not affirmative(text):
            # Anything other than a clear yes or no drops the proposal and is
            # treated as a new question. Better to make them ask again than to
            # act on "yes, but only the overdue ones" as though it were "yes".
            pending.cancelled_at = timezone.now()
            pending.save(update_fields=["cancelled_at"])
            return None

        tool = registry.get(pending.tool)
        try:
            registry.authorize(tool, ctx)
            result = tool.run(dict(pending.params), ctx)
        except (ToolError, ToolDenied) as exc:
            pending.cancelled_at = timezone.now()
            pending.save(update_fields=["cancelled_at"])
            return str(exc)
        except Exception:  # noqa: BLE001
            log.exception("Confirmed action %s failed", pending.tool)
            pending.cancelled_at = timezone.now()
            pending.save(update_fields=["cancelled_at"])
            return GENERIC_FAILURE

        pending.confirmed_at = timezone.now()
        pending.save(update_fields=["confirmed_at"])
        ToolCall.objects.create(
            workspace=ctx.workspace,
            conversation=conversation,
            name=pending.tool[:80],
            params=dict(pending.params),
            ok=True,
            result_summary=str(result)[:200],
        )
        return str(result.get("message") or "Done.")

    @staticmethod
    def propose(*, ctx, conversation, tool_name: str, params: dict, summary: str) -> PendingAction:
        """Record a write that is waiting on a yes."""
        return PendingAction.objects.create(
            workspace=ctx.workspace,
            conversation=conversation,
            tool=tool_name,
            params=params,
            summary=summary[:500],
            expires_at=timezone.now() + timedelta(minutes=settings.AI_CONFIRM_MINUTES),
        )
