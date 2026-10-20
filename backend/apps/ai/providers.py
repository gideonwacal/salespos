"""The model, behind an interface thin enough to swap.

Gemini is first because it has a free tier, but nothing above this file knows
that. A provider takes a system prompt, a conversation and a list of tool
declarations, and returns either some text or a request to call a tool. Adding
Groq or anything else means one more class here and one environment variable.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

import requests
from django.conf import settings

log = logging.getLogger(__name__)


class AIUnavailable(Exception):
    """The model could not be reached or refused to answer.

    Always turned into an apology before it reaches a person: the reason is for
    the log, not for the shop.
    """


@dataclass
class ToolRequest:
    name: str
    params: dict = field(default_factory=dict)


@dataclass
class Turn:
    """One step back from the model: either words, or a tool to run."""

    text: str = ""
    tool_requests: list[ToolRequest] = field(default_factory=list)

    @property
    def wants_tools(self) -> bool:
        return bool(self.tool_requests)


class AIProvider:
    """Interface every model provider implements."""

    name = "base"

    def respond(self, *, system: str, history: list[dict], tools: list[dict]) -> Turn:
        """Take one step.

        `history` is a list of {role, content} where role is user, assistant or
        tool, and a tool entry additionally carries `name`.
        """
        raise NotImplementedError


class GeminiProvider(AIProvider):
    """Google's Gemini, over the REST API.

    Uses `requests`, which the project already depends on for the mobile money
    integrations, so the assistant adds no new packages.
    """

    name = "gemini"

    def __init__(self, api_key: str = "", model: str = "", timeout: int = 20):
        self.api_key = api_key or settings.GEMINI_API_KEY
        self.model = model or settings.GEMINI_MODEL
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _contents(self, history: list[dict]) -> list[dict]:
        """Translate our history into Gemini's shape.

        Gemini has no "tool" role: a tool result is a user-role part of type
        functionResponse, and the model's own request is a model-role part of
        type functionCall. Getting this wrong makes the model repeat the same
        call for ever, so the two are kept adjacent and in order.
        """
        out = []
        for entry in history:
            role = entry["role"]
            if role == "tool":
                out.append(
                    {
                        "role": "user",
                        "parts": [
                            {
                                "functionResponse": {
                                    "name": entry["name"],
                                    "response": entry["content"],
                                }
                            }
                        ],
                    }
                )
            elif role == "tool_request":
                out.append(
                    {
                        "role": "model",
                        "parts": [
                            {"functionCall": {"name": entry["name"], "args": entry["content"]}}
                        ],
                    }
                )
            else:
                out.append(
                    {
                        "role": "model" if role == "assistant" else "user",
                        "parts": [{"text": entry["content"]}],
                    }
                )
        return out

    def respond(self, *, system: str, history: list[dict], tools: list[dict]) -> Turn:
        if not self.configured:
            raise AIUnavailable("GEMINI_API_KEY is not set.")

        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": self._contents(history),
            "generationConfig": {
                "temperature": 0.2,  # a figure is not a creative choice
                "maxOutputTokens": 800,
            },
        }
        if tools:
            body["tools"] = [{"functionDeclarations": tools}]

        url = (
            f"{settings.GEMINI_BASE_URL}/v1beta/models/{self.model}:generateContent"
        )
        try:
            response = requests.post(
                url,
                params={"key": self.api_key},
                json=body,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"},
            )
        except requests.RequestException as exc:
            raise AIUnavailable(f"Could not reach Gemini: {exc}") from exc

        if response.status_code == 429:
            raise AIUnavailable("Gemini rate limit reached.")
        if response.status_code >= 400:
            raise AIUnavailable(
                f"Gemini returned {response.status_code}: {response.text[:300]}"
            )

        try:
            payload = response.json()
        except json.JSONDecodeError as exc:
            raise AIUnavailable("Gemini returned something that was not JSON.") from exc

        candidates = payload.get("candidates") or []
        if not candidates:
            # Usually a safety block. There is nothing useful to say about it.
            raise AIUnavailable(f"Gemini returned no answer: {str(payload)[:300]}")

        parts = (candidates[0].get("content") or {}).get("parts") or []
        turn = Turn()
        for part in parts:
            if "functionCall" in part:
                call = part["functionCall"]
                turn.tool_requests.append(
                    ToolRequest(name=call.get("name", ""), params=dict(call.get("args") or {}))
                )
            elif "text" in part:
                turn.text += part["text"]
        return turn


class ScriptedProvider(AIProvider):
    """A provider that follows a script instead of a model.

    Lets the tool loop, the tenant isolation and the WhatsApp plumbing be
    tested exactly as they run in production, without a network call or an API
    key. Tests assert on real behaviour this way rather than on a mock.
    """

    name = "scripted"

    def __init__(self, turns: list[Turn] | None = None):
        self.turns = list(turns or [])
        self.seen: list[dict] = []

    def respond(self, *, system: str, history: list[dict], tools: list[dict]) -> Turn:
        self.seen.append({"system": system, "history": list(history), "tools": tools})
        if not self.turns:
            return Turn(text="(no script left)")
        return self.turns.pop(0)


class FailingProvider(AIProvider):
    """Always unavailable, for testing what a shop is told when Gemini is down."""

    name = "failing"

    def respond(self, **_):
        raise AIUnavailable("simulated outage")


def get_provider() -> AIProvider:
    """Build the configured provider.

    Named by `AI_PROVIDER` so switching is an environment variable and not a
    code change.
    """
    choice = (settings.AI_PROVIDER or "gemini").lower()
    if choice == "gemini":
        return GeminiProvider()
    if choice == "scripted":
        return ScriptedProvider()
    raise AIUnavailable(f"Unknown AI_PROVIDER {choice!r}.")
