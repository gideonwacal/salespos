"""What the model is allowed to ask for, and the gate every request goes through.

A tool is a name, a JSON schema the model sees, and a function the backend
runs. The registry is the only thing that can turn the first into the third,
which is what stops a hallucinated tool name from reaching any code.

Two rules are enforced here rather than left to each tool author:

  * No schema may declare a tenant parameter. Registration raises if one does.
  * A tool declares `owner_only` and `writes`; the executor checks both before
    the function is reached.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

TENANT_WORDS = {
    "workspace", "workspace_id", "business", "business_id", "tenant",
    "tenant_id", "company_id", "org_id", "user_id", "owner_id",
}


class ToolError(Exception):
    """A tool failed in a way the person should hear about, in plain words.

    Anything else that goes wrong becomes a generic apology: a stack trace, a
    column name or a constraint message is not something a shopkeeper should
    ever be shown.
    """


class ToolDenied(ToolError):
    """The person is not allowed this one. Distinguished so it can be logged."""


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    run: Callable
    # JSON-schema-ish properties, exactly as handed to the model.
    parameters: dict = field(default_factory=dict)
    required: tuple = ()
    owner_only: bool = False
    # A write tool never executes on the model's say-so; it is proposed and
    # waits for a human yes. See agent.py.
    writes: bool = False
    # Write tools only. Works out what the action would actually do, so the
    # person is asked about real numbers — "remind 18 customers owing UGX
    # 24.7M" — rather than about their own words played back at them.
    # Returns {"question": str, "params": dict} or {"answer": str} when there
    # turns out to be nothing to do.
    preview: Callable | None = None

    def schema(self) -> dict:
        """The declaration the model is given."""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": self.parameters,
                "required": list(self.required),
            },
        }


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> Tool:
        if tool.name in self._tools:
            raise ValueError(f"Tool {tool.name!r} is already registered.")
        leaked = sorted(set(tool.parameters) & TENANT_WORDS)
        if leaked:
            # Caught at import time, so this can never ship. The model must not
            # be able to name a business even to be ignored: a parameter that
            # exists is a parameter somebody eventually reads.
            raise ValueError(
                f"Tool {tool.name!r} declares tenant parameter(s) {leaked}. "
                "Tenant identity comes from AgentContext, never from the model."
            )
        self._tools[tool.name] = tool
        return tool

    def tool(self, name, description, *, parameters=None, required=(), owner_only=False,
             writes=False, preview=None):
        """Decorator form, so a tool sits next to its own implementation."""

        def wrap(fn):
            self.register(
                Tool(
                    name=name,
                    description=description,
                    run=fn,
                    parameters=parameters or {},
                    required=tuple(required),
                    owner_only=owner_only,
                    writes=writes,
                    preview=preview,
                )
            )
            return fn

        return wrap

    def get(self, name: str) -> Tool:
        tool = self._tools.get(name)
        if tool is None:
            # The model invented a name. Told plainly so it can correct itself
            # on the next turn rather than repeating the same call.
            raise ToolError(f"There is no tool called {name!r}.")
        return tool

    def for_role(self, role: str) -> list[Tool]:
        """What this person's role may see declared at all.

        A tool an owner-only caller cannot run is not offered to the model
        either. Advertising it would invite the model to promise something it
        is about to be refused.
        """
        if role == "owner":
            return list(self._tools.values())
        return [t for t in self._tools.values() if not t.owner_only]

    def authorize(self, tool: Tool, ctx) -> None:
        if tool.owner_only and not ctx.is_owner:
            raise ToolDenied(
                "Only the business owner can see that. Ask the owner to run it for you."
            )

    def __len__(self):
        return len(self._tools)

    def __contains__(self, name):
        return name in self._tools


registry = ToolRegistry()
