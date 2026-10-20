# The WhatsApp assistant

A business owner sends a WhatsApp message and gets an answer built from their
own POS data. The same agent answers the website and the dashboard.

```
WhatsApp ──┐
Web chat ──┼─→ adapter ─→ AgentContext ─→ AgentService ─→ AIProvider (Gemini)
Dashboard ─┘   (identity)   (TRUST           │              ↕ function calls
                            BOUNDARY)        ↓
                                        ToolRegistry → validate → authorize
                                                           ↓
                                             existing POS services & querysets
```

Nothing here reimplements the POS. Tools call the same service functions the
REST API calls, in-process, so a figure quoted on WhatsApp and the same figure
on the dashboard come from one piece of code.

## The security model

**The model cannot name a business.** No tool schema declares a `workspace_id`,
`business_id` or any other tenant parameter — `ToolRegistry.register` raises at
import time if one ever appears, and a test asserts it across every registered
tool. There is nothing to forge and nothing for a future tool author to forget
to filter.

Tenant identity comes from `AgentContext`, built only by `build_context()` from
either a verified JWT or a verified WhatsApp link. It applies the same gates as
the REST API: a suspended business, an unverified owner or a lapsed
subscription stops the assistant exactly as it stops the dashboard.

The role is re-read from `Membership` on **every message**, never cached on the
link, so deactivating a staff member revokes their WhatsApp access at once.

A WhatsApp number is never matched against `User.phone`. That field is typed in
by hand and never verified, so trusting it would let anyone claim another
person's WhatsApp by editing their own profile. A link is made from inside the
dashboard and completed by sending a 6-digit code from the handset.

## Files

| File | What it does |
|---|---|
| `context.py` | `AgentContext` — the trust boundary |
| `dates.py` | "last week" → two dates, in the business's timezone |
| `registry.py` | Tool declarations, the tenant guard, authorization |
| `tools.py` | The 16 tools |
| `providers.py` | `AIProvider` → `GeminiProvider`, plus test providers |
| `agent.py` | The tool-calling loop, memory, the confirmation gate |
| `whatsapp.py` | `WhatsAppProvider` → `MetaWhatsAppProvider` |
| `views.py` | `/api/ai/chat/` and the webhook |
| `ratelimit.py` | Per-user and per-business hourly caps |

The AI provider and the WhatsApp provider are separate abstractions on purpose:
swapping Gemini for Groq touches `providers.py` only, and swapping Meta for
another gateway touches `whatsapp.py` only.

## Configuration

All optional. With nothing set the assistant reports itself unavailable and the
rest of the app is unchanged.

```bash
# The model. aistudio.google.com/apikey — the free tier is enough to try it.
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash

# WhatsApp: developers.facebook.com → your app → WhatsApp → API Setup
WHATSAPP_TOKEN=...               # permanent token from a System User
WHATSAPP_PHONE_NUMBER_ID=...     # on the API Setup page
WHATSAPP_VERIFY_TOKEN=...        # you invent this; type it into Meta too
WHATSAPP_APP_SECRET=...          # App Settings → Basic → App Secret
WHATSAPP_WELCOME_TEMPLATE=       # the greeting sent at sign-up (see below)
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_REMINDER_TEMPLATE=      # only needed to send customer reminders

# Optional limits
AI_RATE_PER_USER_HOUR=60
AI_RATE_PER_WORKSPACE_HOUR=300
AI_CONFIRM_MINUTES=10
```

`WHATSAPP_APP_SECRET` is not optional in practice. Without it the webhook
refuses every request: an unsigned webhook URL is an open door, and anyone who
learned the URL could post a message claiming to be the owner's number.

## Migrations

```bash
python manage.py migrate
```

Adds `ai_conversations`, `ai_messages`, `ai_tool_calls`, `ai_pending_actions`
and `whatsapp_identities`, plus one additive `workspaces.timezone` column
defaulting to `Africa/Kampala`. No existing table is otherwise touched and no
data is moved.

## Pointing Meta at the webhook

1. Deploy, so `https://<your-host>/api/webhooks/whatsapp/` is reachable.
2. Meta app → WhatsApp → Configuration → Edit webhook.
3. Callback URL: that URL. Verify token: your `WHATSAPP_VERIFY_TOKEN`.
4. Subscribe to the **messages** field.

Meta calls `GET` with a challenge; the view echoes it as plain text. Every
later `POST` is checked against `WHATSAPP_APP_SECRET` before anything is read
from it.

## Linking a number

### At sign-up (the usual way)

The sign-up form has a **WhatsApp business number** field. Fill it in and the
greeting goes out the moment the account is created:

```
POST /api/auth/register/   {..., "whatsapp_number": "0772000111"}
→ {..., "whatsapp": {"number": "256772000111",
                     "pairing_code": "481920",
                     "welcome_sent": true}}
```

They reply `481920` from that handset and get

> 🎉 **Welcome to your business!**
> Nakawa Traders is now set up on SalesPos, and this is your assistant.

From then on they just ask questions.

**The first message has to be a template.** Meta only allows free text inside a
24-hour window that the *customer* opens by messaging first, and a shop that
signed up ten seconds ago has never messaged us. So `WHATSAPP_WELCOME_TEMPLATE`
names a template you had approved in advance; their reply opens the window, and
everything after it is ordinary text.

Create it at business.facebook.com → WhatsApp Manager → Message templates,
category **Utility**, with two body placeholders in this order:

```
Welcome to SalesPos, {{1}}! 🎉

Your business assistant is ready. Reply with the code {{2}} to link this
number, then just ask me things like "How much did I sell today?"
```

Approval usually takes under an hour. Until it is approved, sign-up still
works: `welcome_sent` comes back `false`, and the app shows the pairing code on
screen so the owner can link the number by hand.

**A typed number is a claim, not proof.** Until somebody replies from that
handset the link stays unverified and the assistant answers nothing through it.
A mistyped digit would otherwise put one shop's takings on a stranger's phone.
A wrong recipient replying "who is this?" does *not* link them — only the code
does, which is why the code exists at all.

A number that is already *verified* against another business is refused at
sign-up. An unverified claim does not reserve it, so a typo cannot squat on
somebody else's number.

### Later, from Settings

```
POST /api/ai/whatsapp-identities/   {"phone": "0772000111"}
→ {"pairing_code": "481920", ...}
```

Same pairing step, for a shop that skipped the field or is changing handsets.

## Trying it without WhatsApp

```
POST /api/ai/chat/   {"message": "How much did I sell today?"}
→ {"reply": "...", "conversation_id": "..."}
```

Same agent, same tools, same tenant isolation — authenticated with the ordinary
JWT and `X-Workspace` header. This is what the website chat uses.

## Testing

```bash
python manage.py test apps.ai
```

70 tests. The model is *scripted*, not mocked: `ScriptedProvider` returns the
same turns a real provider would, so the tool loop, the authorization and the
WhatsApp plumbing are exercised as they actually run.

The ones that matter most are in `TenantIsolationTests` — that business A never
sees business B, that extra arguments naming another workspace change nothing,
and that no tool schema has ever grown a tenant parameter.

## Known gaps

- **There are no branches in SalesPos.** `get_branch_performance` says so and
  offers the per-staff breakdown instead, rather than inventing a split.
- **Roles are `owner` and `manager` only.** The permission mechanism your
  spec asks for is built, but mapped to the two roles that exist. Read tools
  mirror what each role can already `GET` through the REST API; tightening
  that is a one-line `owner_only=True` per tool.
- **Proactive insights are not scheduled.** Every figure they need is already
  a tool call; what is missing is something to run them on a timer.
