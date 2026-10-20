"""The assistant's rules, especially the ones that keep businesses apart.

The model is scripted rather than mocked: `ScriptedProvider` returns the exact
turns a real provider would, so these exercise the genuine tool loop,
authorization and WhatsApp plumbing rather than a stand-in for them.
"""

import hashlib
import hmac
import json
from datetime import date, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITestCase

from apps.accounts.models import Membership, User, Workspace
from apps.ai.agent import AgentService, affirmative, negative
from apps.ai.context import AgentContext, build_context
from apps.ai.dates import DateError, resolve
from apps.ai.models import Conversation, Message, PendingAction, ToolCall, WhatsAppIdentity
from apps.ai.providers import AIUnavailable, FailingProvider, ScriptedProvider, ToolRequest, Turn
from apps.ai.registry import TENANT_WORDS, Tool, ToolDenied, ToolError, ToolRegistry, registry
from apps.expenses.models import Expense
from apps.inventory.models import Product
from apps.sales.services import create_sale
from apps.trade.models import Customer, Debt

KAMPALA = ZoneInfo("Africa/Kampala")

# Registered and torn down by ConfirmationTests. Named so it can never
# collide with a tool the application actually ships.
FAKE_WRITE = "_test_write_action"


def say(text):
    return Turn(text=text)


def call(name, **params):
    return Turn(tool_requests=[ToolRequest(name=name, params=params)])


class Base(APITestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name="Nakawa Traders", access="free")
        self.owner = User.objects.create_user(
            email="owner@nakawa.com", password="sup3rsecret!", full_name="Grace Nabwire",
            email_verified=True,
        )
        Membership.objects.create(user=self.owner, workspace=self.workspace, role="owner")

        self.staff = User.objects.create_user(
            email="staff@nakawa.com", password="sup3rsecret!", full_name="Peter Odoi",
            email_verified=True,
        )
        Membership.objects.create(user=self.staff, workspace=self.workspace, role="manager")

        self.sugar = Product.objects.create(
            workspace=self.workspace, name="Sugar 50kg Bale", unit_buying_price=Decimal("180000"),
            unit_selling_price=Decimal("215000"), stock_quantity=7, reorder_level=5,
        )
        self.flour = Product.objects.create(
            workspace=self.workspace, name="Maize Flour 25kg", unit_buying_price=Decimal("40000"),
            unit_selling_price=Decimal("47000"), stock_quantity=0, reorder_level=10,
        )

    def ctx(self, user=None, role="owner", channel="web"):
        return AgentContext(
            user=user or self.owner, workspace=self.workspace, role=role, channel=channel
        )

    def agent(self, *turns):
        return AgentService(provider=ScriptedProvider(list(turns)))


# --- the guarantee -----------------------------------------------------------


class TenantIsolationTests(Base):
    def setUp(self):
        super().setUp()
        self.other = Workspace.objects.create(name="Rival Shop", access="free")
        self.rival_owner = User.objects.create_user(
            email="rival@other.com", password="sup3rsecret!", email_verified=True
        )
        Membership.objects.create(user=self.rival_owner, workspace=self.other, role="owner")
        Product.objects.create(
            workspace=self.other, name="Rival Secret Stock", unit_buying_price=Decimal("1"),
            unit_selling_price=Decimal("999999"), stock_quantity=500, reorder_level=1,
        )
        create_sale(
            workspace=self.other, cashier=self.rival_owner,
            items=[{"product_id": Product.objects.get(workspace=self.other).id, "quantity": 1}],
        )

    def test_no_tool_accepts_a_tenant_parameter(self):
        """The model must not be able to name a business, even to be ignored."""
        for tool in registry.for_role("owner"):
            leaked = set(tool.parameters) & TENANT_WORDS
            self.assertEqual(leaked, set(), f"{tool.name} exposes {leaked} to the model")

    def test_registering_a_tenant_parameter_is_refused(self):
        bespoke = ToolRegistry()
        with self.assertRaises(ValueError) as caught:
            bespoke.register(
                Tool(
                    name="leaky", description="x", run=lambda p, c: {},
                    parameters={"business_id": {"type": "string"}},
                )
            )
        self.assertIn("tenant parameter", str(caught.exception))

    def test_business_a_cannot_see_business_b(self):
        """Asked from A, every tool returns A's figures and never B's."""
        result = registry.get("get_inventory_value").run({}, self.ctx())
        # B holds 500 units worth 999,999 each; A holds 7 bales.
        self.assertEqual(result["units_on_hand"], 7)

        sales = registry.get("get_sales_summary").run({"period": "this year"}, self.ctx())
        self.assertEqual(sales["transactions"], 0)  # A has sold nothing

        low = registry.get("get_low_stock_products").run({}, self.ctx())
        names = [p["name"] for p in low["products"]]
        self.assertNotIn("Rival Secret Stock", names)

    def test_the_model_cannot_widen_its_own_scope(self):
        """Extra arguments naming another business change nothing."""
        poisoned = {
            "workspace": str(self.other.id), "business_id": str(self.other.id),
            "workspace_id": str(self.other.id), "period": "this year",
        }
        result = registry.get("get_sales_summary").run(poisoned, self.ctx())
        self.assertEqual(result["transactions"], 0)

    def test_a_revoked_member_is_refused(self):
        Membership.objects.filter(user=self.staff, workspace=self.workspace).update(active=False)
        with self.assertRaises(PermissionDenied):
            build_context(user=self.staff, workspace=self.workspace, channel="whatsapp")


# --- authorization -----------------------------------------------------------


class AuthorizationTests(Base):
    def test_staff_are_not_offered_owner_only_tools(self):
        offered = {t.name for t in registry.for_role("manager")}
        self.assertNotIn("get_employee_performance", offered)
        self.assertIn("get_today_sales", offered)

    def test_an_owner_only_tool_refuses_staff(self):
        tool = registry.get("get_employee_performance")
        with self.assertRaises(ToolDenied):
            registry.authorize(tool, self.ctx(self.staff, role="manager"))

    def test_the_refusal_reaches_the_person_politely(self):
        agent = self.agent(
            call("get_employee_performance", period="this month"),
            say("Sorry, only the owner can see staff figures."),
        )
        reply = agent.answer(ctx=self.ctx(self.staff, role="manager"), text="how is each staff doing?")
        self.assertIn("owner", reply.lower())
        denied = ToolCall.objects.get(name="get_employee_performance")
        self.assertFalse(denied.ok)
        self.assertIn("owner", denied.error.lower())

    def test_a_suspended_business_cannot_use_the_assistant(self):
        self.workspace.access = "suspended"
        self.workspace.save(update_fields=["access"])
        with self.assertRaises(PermissionDenied):
            build_context(user=self.owner, workspace=self.workspace, channel="web")


# --- dates -------------------------------------------------------------------


class DateTests(APITestCase):
    def setUp(self):
        self.today = date(2026, 3, 18)  # a Wednesday

    def test_common_phrases(self):
        cases = {
            "today": (date(2026, 3, 18), date(2026, 3, 18)),
            "yesterday": (date(2026, 3, 17), date(2026, 3, 17)),
            "this week": (date(2026, 3, 16), date(2026, 3, 18)),
            "last week": (date(2026, 3, 9), date(2026, 3, 15)),
            "this month": (date(2026, 3, 1), date(2026, 3, 18)),
            "last month": (date(2026, 2, 1), date(2026, 2, 28)),
            "last year": (date(2025, 1, 1), date(2025, 12, 31)),
            "the last 30 days": (date(2026, 2, 17), date(2026, 3, 18)),
            "January": (date(2026, 1, 1), date(2026, 1, 31)),
            "2026-03-01 to 2026-03-05": (date(2026, 3, 1), date(2026, 3, 5)),
        }
        for phrase, (first, last) in cases.items():
            period = resolve(phrase, KAMPALA, today=self.today)
            self.assertEqual(period.start_date, first, phrase)
            self.assertEqual(period.last_date, last, phrase)

    def test_a_bare_month_means_the_one_that_already_happened(self):
        period = resolve("December", KAMPALA, today=self.today)
        self.assertEqual(period.start_date, date(2025, 12, 1))

    def test_the_range_is_half_open_so_midnight_is_not_counted_twice(self):
        today = resolve("today", KAMPALA, today=self.today)
        tomorrow_start = resolve("2026-03-19", KAMPALA, today=self.today).start
        self.assertEqual(today.end, tomorrow_start)

    def test_periods_are_measured_in_the_business_timezone(self):
        period = resolve("today", KAMPALA, today=self.today)
        self.assertEqual(period.start.utcoffset(), timedelta(hours=3))

    def test_nonsense_is_refused_rather_than_guessed(self):
        with self.assertRaises(DateError):
            resolve("whenever the rains came", KAMPALA, today=self.today)


# --- the tools answer with real figures --------------------------------------


class ToolTests(Base):
    def setUp(self):
        super().setUp()
        create_sale(
            workspace=self.workspace, cashier=self.owner,
            items=[{"product_id": self.sugar.id, "quantity": 2}],
            payment_method="cash",
        )
        create_sale(
            workspace=self.workspace, cashier=self.staff,
            items=[{"product_id": self.sugar.id, "quantity": 1}],
            payment_method="mobile_money",
        )
        Expense.objects.create(
            workspace=self.workspace, category="Transport", amount=Decimal("50000"),
            expense_date=timezone.now().date(), logged_by=self.owner,
        )
        self.customer = Customer.objects.create(
            workspace=self.workspace, name="John Mukasa", phone="0772000111"
        )
        Debt.objects.create(
            workspace=self.workspace, customer=self.customer, total_value=Decimal("1200000"),
            amount_paid=Decimal("200000"), issue_date=timezone.now().date(),
            due_date=timezone.now().date() + timedelta(days=30), status="pending",
        )

    def test_today_sales(self):
        result = registry.get("get_today_sales").run({}, self.ctx())
        self.assertEqual(result["transactions"], 3 if False else 2)
        self.assertIn("UGX", result["sales"])
        methods = {m["method"] for m in result["payment_methods"]}
        self.assertEqual(methods, {"cash", "mobile_money"})

    def test_yesterday_is_empty_and_says_so_honestly(self):
        result = registry.get("get_sales_summary").run({"period": "yesterday"}, self.ctx())
        self.assertEqual(result["transactions"], 0)

    def test_sales_for_a_specific_date(self):
        today = timezone.now().astimezone(KAMPALA).date().isoformat()
        result = registry.get("get_sales_by_date").run({"date": today}, self.ctx())
        self.assertEqual(result["transactions"], 2)

    def test_inventory_value_excludes_services(self):
        Product.objects.create(
            workspace=self.workspace, name="Delivery", is_service=True,
            unit_selling_price=Decimal("10000"), stock_quantity=0,
        )
        result = registry.get("get_inventory_value").run({}, self.ctx())
        self.assertEqual(result["units_on_hand"], 4)  # 7 bales less 3 sold

    def test_low_stock_lists_the_empty_shelf(self):
        result = registry.get("get_low_stock_products").run({}, self.ctx())
        names = [p["name"] for p in result["products"]]
        self.assertIn("Maize Flour 25kg", names)
        self.assertEqual(result["out_of_stock"], 1)

    def test_customer_debt_and_the_minimum_filter(self):
        result = registry.get("get_customer_debt").run({}, self.ctx())
        self.assertEqual(result["customers_owing"], 1)
        self.assertIn("John Mukasa", result["customers"][0]["name"])

        filtered = registry.get("get_customer_debt").run({"minimum": 5_000_000}, self.ctx())
        self.assertEqual(filtered["customers_owing"], 0)

    def test_customer_statement_for_a_partial_name(self):
        result = registry.get("get_customer_statement").run({"name": "mukasa"}, self.ctx())
        self.assertEqual(result["name"], "John Mukasa")
        self.assertEqual(len(result["debts"]), 1)

    def test_an_unknown_customer_is_not_invented(self):
        with self.assertRaises(ToolError):
            registry.get("get_customer_statement").run({"name": "Nobody At All"}, self.ctx())

    def test_profit_subtracts_expenses(self):
        result = registry.get("get_profit_summary").run({"period": "today"}, self.ctx())
        # 3 bales: 645,000 revenue less 540,000 cost = 105,000 gross,
        # less 50,000 of transport = 55,000 net.
        self.assertEqual(result["net_profit_exact"], "UGX 55,000")

    def test_expenses_by_category(self):
        result = registry.get("get_expenses").run({"period": "today"}, self.ctx())
        self.assertEqual(result["by_category"][0]["category"], "Transport")

    def test_branch_performance_admits_there_are_no_branches(self):
        """The honest answer to a question the data cannot support."""
        result = registry.get("get_branch_performance").run({}, self.ctx())
        self.assertEqual(result["branches_configured"], 0)
        self.assertIn("not set up with separate branches", result["note"])

    def test_employee_performance_splits_by_cashier(self):
        result = registry.get("get_employee_performance").run({"period": "today"}, self.ctx())
        names = {row["name"] for row in result["staff"]}
        self.assertEqual(names, {"Grace Nabwire", "Peter Odoi"})

    def test_an_unparseable_period_is_refused_not_guessed(self):
        with self.assertRaises(ToolError):
            registry.get("get_sales_summary").run({"period": "when the rains came"}, self.ctx())

    def test_limits_are_clamped(self):
        result = registry.get("get_top_products").run({"limit": 9999}, self.ctx())
        self.assertLessEqual(len(result["products"]), 25)


# --- the loop ----------------------------------------------------------------


class AgentLoopTests(Base):
    def test_a_tool_result_comes_back_as_an_answer(self):
        agent = self.agent(call("get_today_sales"), say("You've sold *UGX 0* today."))
        reply = agent.answer(ctx=self.ctx(), text="How much did I sell today?")
        self.assertIn("UGX 0", reply)
        self.assertTrue(ToolCall.objects.filter(name="get_today_sales", ok=True).exists())

    def test_a_nonexistent_tool_is_reported_not_executed(self):
        agent = self.agent(call("drop_all_tables"), say("I can't do that."))
        reply = agent.answer(ctx=self.ctx(), text="delete everything")
        self.assertEqual(reply, "I can't do that.")
        record = ToolCall.objects.get(name="drop_all_tables")
        self.assertFalse(record.ok)
        self.assertIn("no tool called", record.error.lower())

    def test_invalid_parameters_do_not_crash_the_turn(self):
        agent = self.agent(
            call("get_customer_debt", minimum="a sack of maize"),
            say("I couldn't read that amount."),
        )
        reply = agent.answer(ctx=self.ctx(), text="who owes me more than a sack of maize?")
        self.assertIn("amount", reply.lower())
        self.assertFalse(ToolCall.objects.get(name="get_customer_debt").ok)

    def test_a_broken_tool_apologises_without_leaking(self):
        registry._tools["explode"] = Tool(
            name="explode", description="t",
            run=lambda p, c: (_ for _ in ()).throw(ZeroDivisionError("division by zero")),
        )
        try:
            agent = self.agent(call("explode"), say("Sorry, I couldn't load that."))
            agent.answer(ctx=self.ctx(), text="break")
            record = ToolCall.objects.get(name="explode")
            self.assertFalse(record.ok)
            self.assertIn("ZeroDivisionError", record.error)  # kept in the log
            # ...but the model was handed a plain sentence, not the exception.
            handed = agent.provider.seen[-1]["history"][-1]["content"]
            self.assertNotIn("ZeroDivisionError", json.dumps(handed))
        finally:
            registry._tools.pop("explode", None)

    def test_provider_failure_becomes_an_apology(self):
        agent = AgentService(provider=FailingProvider())
        reply = agent.answer(ctx=self.ctx(), text="how much did I sell?")
        self.assertIn("trouble", reply.lower())
        self.assertNotIn("simulated", reply.lower())

    def test_a_looping_model_is_cut_off(self):
        agent = self.agent(*[call("get_today_sales") for _ in range(10)])
        reply = agent.answer(ctx=self.ctx(), text="sales?")
        self.assertIn("could not work that one out", reply.lower())

    def test_follow_up_questions_see_the_earlier_turns(self):
        agent = self.agent(
            call("get_today_sales"), say("UGX 0 today."),
            call("get_sales_summary", period="yesterday"), say("UGX 0 yesterday."),
        )
        ctx = self.ctx()
        agent.answer(ctx=ctx, text="How much did I sell today?")
        agent.answer(ctx=ctx, text="What about yesterday?")

        replayed = agent.provider.seen[-1]["history"]
        texts = [h["content"] for h in replayed if h["role"] in ("user", "assistant")]
        self.assertIn("How much did I sell today?", texts)
        self.assertIn("What about yesterday?", texts)
        self.assertEqual(Conversation.objects.count(), 1)

    def test_the_prompt_carries_the_business_not_the_model_guessing(self):
        agent = self.agent(say("hi"))
        agent.answer(ctx=self.ctx(), text="hello")
        system = agent.provider.seen[-1]["system"]
        self.assertIn("Nakawa Traders", system)
        self.assertIn("UGX", system)

    def test_staff_tools_are_the_only_ones_declared_to_staff(self):
        agent = self.agent(say("hi"))
        agent.answer(ctx=self.ctx(self.staff, role="manager"), text="hello")
        declared = {t["name"] for t in agent.provider.seen[-1]["tools"]}
        self.assertNotIn("get_employee_performance", declared)


# --- confirmation ------------------------------------------------------------


class ConfirmationTests(Base):
    def setUp(self):
        super().setUp()
        self.ran = []
        # A tool of its own rather than a stand-in for a real one: registering
        # over "send_payment_reminder" and popping it on cleanup deleted the
        # genuine tool for every test that ran afterwards.
        registry._tools[FAKE_WRITE] = Tool(
            name=FAKE_WRITE, description="t", writes=True, owner_only=True,
            run=lambda p, c: self.ran.append(p) or {"message": "Reminders sent."},
        )
        self.addCleanup(lambda: registry._tools.pop(FAKE_WRITE, None))

    def _propose(self, ctx):
        conversation = Conversation.objects.create(
            workspace=self.workspace, user=ctx.user, channel="web"
        )
        AgentService.propose(
            ctx=ctx, conversation=conversation, tool_name=FAKE_WRITE,
            params={"minimum": 500000}, summary="Remind 18 customers",
        )
        return conversation

    def test_a_write_tool_never_runs_from_the_model_alone(self):
        agent = self.agent(call(FAKE_WRITE, minimum=500000), say("..."))
        agent.answer(ctx=self.ctx(), text="send reminders to everyone owing 500k")
        self.assertEqual(self.ran, [], "a write executed without consent")

    def test_yes_runs_it(self):
        ctx = self.ctx()
        self._propose(ctx)
        reply = self.agent(say("unused")).answer(ctx=ctx, text="yes")
        self.assertEqual(reply, "Reminders sent.")
        self.assertEqual(len(self.ran), 1)
        self.assertTrue(PendingAction.objects.get().confirmed_at)

    def test_no_cancels_it(self):
        ctx = self.ctx()
        self._propose(ctx)
        reply = self.agent(say("unused")).answer(ctx=ctx, text="no")
        self.assertIn("haven't done anything", reply)
        self.assertEqual(self.ran, [])
        self.assertTrue(PendingAction.objects.get().cancelled_at)

    def test_a_qualified_yes_is_not_consent(self):
        """"yes but only the overdue ones" must not run the action as proposed."""
        ctx = self.ctx()
        self._propose(ctx)
        self.agent(say("Which ones did you mean?")).answer(
            ctx=ctx, text="yes but only the overdue ones"
        )
        self.assertEqual(self.ran, [])
        self.assertTrue(PendingAction.objects.get().cancelled_at)

    def test_an_expired_proposal_does_not_run(self):
        ctx = self.ctx()
        self._propose(ctx)
        PendingAction.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        self.agent(say("What would you like?")).answer(ctx=ctx, text="yes")
        self.assertEqual(self.ran, [])

    def test_consent_words(self):
        for word in ["yes", "Yes!", "go ahead", "OK", "confirm"]:
            self.assertTrue(affirmative(word), word)
        for word in ["no", "cancel", "Stop."]:
            self.assertTrue(negative(word), word)
        for word in ["yes, but not John", "maybe", "how much?"]:
            self.assertFalse(affirmative(word), word)


# --- WhatsApp ----------------------------------------------------------------


@override_settings(
    WHATSAPP_APP_SECRET="shh", WHATSAPP_VERIFY_TOKEN="hunter2",
    WHATSAPP_TOKEN="t", WHATSAPP_PHONE_NUMBER_ID="1",
)
class WhatsAppTests(Base):
    def setUp(self):
        super().setUp()
        self.sent = []

        import apps.ai.views as views

        class Fake:
            outer = self

            def send(inner, to, text):
                inner.outer.sent.append((to, text))
                return True

            def verify_signature(inner, body, header):
                from apps.ai.whatsapp import MetaWhatsAppProvider

                return MetaWhatsAppProvider().verify_signature(body, header)

            def parse(inner, payload):
                from apps.ai.whatsapp import MetaWhatsAppProvider

                return MetaWhatsAppProvider().parse(payload)

        original = views.get_whatsapp_provider
        views.get_whatsapp_provider = lambda: Fake()
        self.addCleanup(lambda: setattr(views, "get_whatsapp_provider", original))

        original_agent = views.AgentService
        views.AgentService = lambda *a, **k: AgentService(
            provider=ScriptedProvider([call("get_today_sales"), say("You've sold *UGX 0* today.")])
        )
        self.addCleanup(lambda: setattr(views, "AgentService", original_agent))

    def envelope(self, text, sender="256772000111"):
        return {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {
                                        "from": sender, "id": "wamid.1", "type": "text",
                                        "text": {"body": text},
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        }

    def post(self, payload, *, secret="shh"):
        body = json.dumps(payload).encode()
        signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return self.client.post(
            "/api/webhooks/whatsapp/", data=body, content_type="application/json",
            HTTP_X_HUB_SIGNATURE_256=signature,
        )

    def link(self, phone="256772000111", user=None, verified=True):
        return WhatsAppIdentity.objects.create(
            workspace=self.workspace, user=user or self.owner, phone=phone,
            verified_at=timezone.now() if verified else None,
            pairing_code="" if verified else "123456",
        )

    # verification

    def test_webhook_verification_echoes_the_challenge(self):
        response = self.client.get(
            "/api/webhooks/whatsapp/",
            {"hub.mode": "subscribe", "hub.verify_token": "hunter2", "hub.challenge": "42"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"42")

    def test_webhook_verification_refuses_a_wrong_token(self):
        response = self.client.get(
            "/api/webhooks/whatsapp/",
            {"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42"},
        )
        self.assertEqual(response.status_code, 403)

    # authenticity

    def test_an_unsigned_webhook_is_refused(self):
        response = self.client.post(
            "/api/webhooks/whatsapp/", data=json.dumps(self.envelope("hi")),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.sent, [])

    def test_a_forged_signature_is_refused(self):
        self.link()
        response = self.post(self.envelope("How much did I sell today?"), secret="wrong-secret")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.sent, [])

    @override_settings(WHATSAPP_APP_SECRET="")
    def test_without_a_secret_the_webhook_refuses_everything(self):
        """A missing secret must fail closed, not wave callers through."""
        self.link()
        response = self.post(self.envelope("hi"), secret="anything")
        self.assertEqual(response.status_code, 403)

    # identity

    def test_an_unknown_number_learns_nothing_about_any_business(self):
        response = self.post(self.envelope("How much did Nakawa sell today?"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.sent), 1)
        reply = self.sent[0][1]
        self.assertIn("isn't linked", reply)
        self.assertNotIn("Nakawa", reply)
        self.assertNotIn("UGX", reply)

    def test_a_known_number_gets_its_own_business_figures(self):
        self.link()
        response = self.post(self.envelope("How much did I sell today?"))
        self.assertEqual(response.status_code, 200)
        self.assertIn("UGX 0", self.sent[0][1])

    def test_a_matching_user_phone_does_not_grant_access(self):
        """User.phone is self-entered and unverified, so it must not authenticate."""
        self.owner.phone = "0772000111"
        self.owner.save(update_fields=["phone"])
        self.post(self.envelope("How much did I sell today?"))
        self.assertIn("isn't linked", self.sent[0][1])

    def test_an_unverified_link_is_completed_by_the_pairing_code(self):
        identity = self.link(verified=False)
        self.post(self.envelope("123456"))
        identity.refresh_from_db()
        self.assertTrue(identity.verified)
        self.assertIn("Welcome to your business", self.sent[0][1])
        self.assertIn("Nakawa Traders", self.sent[0][1])

    def test_an_unverified_link_answers_nothing_until_paired(self):
        self.link(verified=False)
        self.post(self.envelope("How much did I sell today?"))
        self.assertIn("6-digit code", self.sent[0][1])
        self.assertNotIn("UGX", self.sent[0][1])

    def test_a_deactivated_member_is_turned_away_at_whatsapp(self):
        self.link(user=self.staff)
        Membership.objects.filter(user=self.staff).update(active=False)
        self.post(self.envelope("How much did I sell today?"))
        self.assertIn("no longer have access", self.sent[0][1])

    def test_a_non_text_message_is_answered_politely(self):
        self.link()
        payload = self.envelope("")
        payload["entry"][0]["changes"][0]["value"]["messages"][0]["type"] = "image"
        self.post(payload)
        self.assertIn("text messages", self.sent[0][1])

    def test_a_status_callback_is_ignored(self):
        self.link()
        response = self.post({"entry": [{"changes": [{"value": {"statuses": [{"id": "x"}]}}]}]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.sent, [])

    def test_a_failing_handler_still_returns_200_so_meta_stops_retrying(self):
        import apps.ai.views as views

        views.AgentService = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
        self.link()
        response = self.post(self.envelope("sales?"))
        self.assertEqual(response.status_code, 200)

    def test_phone_numbers_normalise_to_one_form(self):
        from apps.ai.models import normalise_phone

        self.assertEqual(normalise_phone("0772 000 111"), "256772000111")
        self.assertEqual(normalise_phone("+256772000111"), "256772000111")
        self.assertEqual(normalise_phone("256772000111"), "256772000111")


# --- the shared endpoint -----------------------------------------------------


class ChatEndpointTests(Base):
    def setUp(self):
        super().setUp()
        import apps.ai.views as views

        original = views.AgentService
        views.AgentService = lambda *a, **k: AgentService(
            provider=ScriptedProvider([call("get_today_sales"), say("*UGX 0* today.")])
        )
        self.addCleanup(lambda: setattr(views, "AgentService", original))
        self.headers = {"HTTP_X_WORKSPACE": str(self.workspace.id)}

    def test_the_website_uses_the_same_agent(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/ai/chat/", {"message": "How much did I sell today?"}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("UGX 0", response.data["reply"])
        self.assertTrue(response.data["conversation_id"])

    def test_it_refuses_anonymous_callers(self):
        response = self.client.post("/api/ai/chat/", {"message": "sales?"}, format="json")
        self.assertIn(response.status_code, (401, 403))

    def test_an_empty_question_is_refused(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/ai/chat/", {"message": "   "}, format="json", **self.headers)
        self.assertEqual(response.status_code, 400)

    def test_another_workspaces_conversation_cannot_be_resumed(self):
        other = Workspace.objects.create(name="Rival", access="free")
        stranger = User.objects.create_user(email="x@y.com", password="sup3rsecret!")
        theirs = Conversation.objects.create(workspace=other, user=stranger, channel="web")

        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/ai/chat/",
            {"message": "sales?", "conversation_id": str(theirs.id)},
            format="json", **self.headers,
        )
        self.assertEqual(response.status_code, 403)

    @override_settings(AI_RATE_PER_USER_HOUR=2)
    def test_rate_limiting_protects_the_quota(self):
        self.client.force_authenticate(self.owner)
        for _ in range(2):
            self.client.post("/api/ai/chat/", {"message": "sales?"}, format="json", **self.headers)
        response = self.client.post(
            "/api/ai/chat/", {"message": "sales?"}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 429)

    def test_staff_cannot_read_another_persons_thread(self):
        Conversation.objects.create(workspace=self.workspace, user=self.owner, channel="web")
        self.client.force_authenticate(self.staff)
        response = self.client.get("/api/ai/conversations/", **self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 0)


class PaymentReminderTests(Base):
    """The spec's own worked example, end to end."""

    def setUp(self):
        super().setUp()
        self.sent = []
        today = timezone.now().date()
        for name, phone, owed in [
            ("Big Debtor", "0772000001", Decimal("3000000")),
            ("Medium Debtor", "0772000002", Decimal("700000")),
            ("Small Debtor", "0772000003", Decimal("50000")),
            ("No Phone", "", Decimal("900000")),
        ]:
            customer = Customer.objects.create(
                workspace=self.workspace, name=name, phone=phone
            )
            Debt.objects.create(
                workspace=self.workspace, customer=customer, total_value=owed,
                amount_paid=Decimal("0"), issue_date=today,
                due_date=today + timedelta(days=30), status="pending",
            )

        import apps.ai.tools as tools_module

        class Fake:
            outer = self

            def send(inner, to, text):
                inner.outer.sent.append((to, text))
                return True

        original = tools_module.get_whatsapp_provider if hasattr(
            tools_module, "get_whatsapp_provider"
        ) else None
        self._patch_provider(Fake())
        self.addCleanup(self._unpatch_provider)

    def _patch_provider(self, fake):
        import apps.ai.whatsapp as whatsapp_module

        self._original_provider = whatsapp_module.get_whatsapp_provider
        whatsapp_module.get_whatsapp_provider = lambda: fake

    def _unpatch_provider(self):
        import apps.ai.whatsapp as whatsapp_module

        whatsapp_module.get_whatsapp_provider = self._original_provider

    def test_it_asks_before_sending_anything(self):
        agent = self.agent(call("send_payment_reminder", minimum=500000))
        reply = agent.answer(ctx=self.ctx(), text="remind everyone who owes over 500,000")

        # Two reachable customers over the threshold, plus one with no phone.
        self.assertIn("2 customer(s)", reply)
        self.assertIn("UGX 3.70M", reply)
        self.assertIn("1 more have no phone number", reply)
        self.assertEqual(self.sent, [], "messages went out before anyone agreed")
        self.assertTrue(PendingAction.objects.get().open)

    @override_settings(WHATSAPP_REMINDER_TEMPLATE="payment_reminder")
    def test_yes_sends_to_exactly_those_customers(self):
        ctx = self.ctx()
        self.agent(call("send_payment_reminder", minimum=500000)).answer(
            ctx=ctx, text="remind everyone who owes over 500,000"
        )
        reply = self.agent(say("unused")).answer(ctx=ctx, text="yes")

        self.assertIn("Sent 2 reminder(s)", reply)
        recipients = {to for to, _ in self.sent}
        self.assertEqual(recipients, {"0772000001", "0772000002"})
        self.assertNotIn("0772000003", recipients, "a customer under the threshold was messaged")

    @override_settings(WHATSAPP_REMINDER_TEMPLATE="payment_reminder")
    def test_no_sends_nothing(self):
        ctx = self.ctx()
        self.agent(call("send_payment_reminder", minimum=500000)).answer(ctx=ctx, text="remind them")
        self.agent(say("unused")).answer(ctx=ctx, text="no")
        self.assertEqual(self.sent, [])

    def test_without_a_template_it_refuses_rather_than_half_sending(self):
        ctx = self.ctx()
        self.agent(call("send_payment_reminder", minimum=500000)).answer(ctx=ctx, text="remind them")
        reply = self.agent(say("unused")).answer(ctx=ctx, text="yes")
        self.assertIn("approved message template", reply)
        self.assertEqual(self.sent, [])

    def test_nobody_matching_is_said_plainly_not_asked_about(self):
        agent = self.agent(call("send_payment_reminder", minimum=99_000_000))
        reply = agent.answer(ctx=self.ctx(), text="remind anyone owing 99 million")
        self.assertIn("no one to remind", reply)
        self.assertFalse(PendingAction.objects.exists(), "a no-op was queued for confirmation")

    def test_staff_cannot_propose_it_at_all(self):
        agent = self.agent(call("send_payment_reminder", minimum=500000), say("..."))
        reply = agent.answer(ctx=self.ctx(self.staff, role="manager"), text="remind them")
        self.assertIn("owner", reply.lower())
        self.assertFalse(PendingAction.objects.exists())
        self.assertEqual(self.sent, [])


@override_settings(
    WHATSAPP_TOKEN="t", WHATSAPP_PHONE_NUMBER_ID="1", WHATSAPP_APP_SECRET="shh",
    WHATSAPP_WELCOME_TEMPLATE="salespos_welcome", REQUIRE_EMAIL_VERIFICATION=False,
)
class SignupWhatsAppTests(APITestCase):
    """Giving a WhatsApp number at sign-up, and being greeted on it."""

    def setUp(self):
        self.templates = []
        self.texts = []

        import apps.ai.whatsapp as whatsapp_module

        class Fake:
            outer = self

            def send(inner, to, text):
                inner.outer.texts.append((to, text))
                return True

            def send_template(inner, to, template, body_params):
                inner.outer.templates.append((to, template, body_params))
                return True

            def verify_signature(inner, body, header):
                from apps.ai.whatsapp import MetaWhatsAppProvider

                return MetaWhatsAppProvider().verify_signature(body, header)

            def parse(inner, payload):
                from apps.ai.whatsapp import MetaWhatsAppProvider

                return MetaWhatsAppProvider().parse(payload)

        self._original = whatsapp_module.get_whatsapp_provider
        whatsapp_module.get_whatsapp_provider = lambda: Fake()
        self.addCleanup(lambda: setattr(whatsapp_module, "get_whatsapp_provider", self._original))

        import apps.ai.views as views

        self._original_views = views.get_whatsapp_provider
        views.get_whatsapp_provider = lambda: Fake()
        self.addCleanup(lambda: setattr(views, "get_whatsapp_provider", self._original_views))

    def register(self, **overrides):
        body = {
            "email": "owner@nakawa.com",
            "password": "sup3rsecret!",
            "full_name": "Grace Nabwire",
            "business_name": "Nakawa Traders",
            "whatsapp_number": "0772000111",
            **overrides,
        }
        return self.client.post("/api/auth/register/", body, format="json")

    def test_signing_up_greets_the_number_straight_away(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)

        identity = WhatsAppIdentity.objects.get()
        self.assertEqual(identity.phone, "256772000111")
        self.assertEqual(identity.workspace.name, "Nakawa Traders")

        # One template message, carrying the business name and the code.
        self.assertEqual(len(self.templates), 1)
        to, template, params = self.templates[0]
        self.assertEqual(to, "256772000111")
        self.assertEqual(template, "salespos_welcome")
        self.assertEqual(params, ["Nakawa Traders", identity.pairing_code])

        self.assertTrue(response.data["whatsapp"]["welcome_sent"])

    def test_the_number_is_not_usable_until_they_reply(self):
        """A typed number is a claim; only a reply from the handset is proof."""
        self.register()
        identity = WhatsAppIdentity.objects.get()
        self.assertFalse(identity.verified)

    def test_replying_with_the_code_opens_the_business(self):
        self.register()
        identity = WhatsAppIdentity.objects.get()
        code = identity.pairing_code

        body = json.dumps(
            {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "messages": [
                                        {
                                            "from": "256772000111", "id": "wamid.1",
                                            "type": "text", "text": {"body": code},
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ]
            }
        ).encode()
        signature = "sha256=" + hmac.new(b"shh", body, hashlib.sha256).hexdigest()
        response = self.client.post(
            "/api/webhooks/whatsapp/", data=body, content_type="application/json",
            HTTP_X_HUB_SIGNATURE_256=signature,
        )
        self.assertEqual(response.status_code, 200)

        identity.refresh_from_db()
        self.assertTrue(identity.verified)
        self.assertEqual(identity.pairing_code, "", "the code should not be reusable")

        # And the greeting they actually asked for.
        self.assertEqual(len(self.texts), 1)
        self.assertIn("Welcome to your business", self.texts[0][1])
        self.assertIn("Nakawa Traders", self.texts[0][1])

    def test_a_wrong_reply_does_not_link_the_number(self):
        """Someone sent the message by mistake must not be linked by answering."""
        self.register()
        body = json.dumps(
            {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "messages": [
                                        {
                                            "from": "256772000111", "id": "wamid.2",
                                            "type": "text",
                                            "text": {"body": "who is this?"},
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ]
            }
        ).encode()
        signature = "sha256=" + hmac.new(b"shh", body, hashlib.sha256).hexdigest()
        self.client.post(
            "/api/webhooks/whatsapp/", data=body, content_type="application/json",
            HTTP_X_HUB_SIGNATURE_256=signature,
        )
        WhatsAppIdentity.objects.get().refresh_from_db()
        self.assertFalse(WhatsAppIdentity.objects.get().verified)

    def test_signing_up_without_a_number_is_fine(self):
        response = self.register(whatsapp_number="")
        self.assertEqual(response.status_code, 201)
        self.assertFalse(WhatsAppIdentity.objects.exists())
        self.assertIsNone(response.data["whatsapp"])
        self.assertEqual(self.templates, [])

    def test_a_number_without_a_country_code_is_rejected(self):
        response = self.register(whatsapp_number="12345")
        self.assertEqual(response.status_code, 400)
        self.assertIn("country code", str(response.data["whatsapp_number"]))
        self.assertFalse(User.objects.filter(email="owner@nakawa.com").exists())

    def test_a_number_already_linked_elsewhere_is_refused(self):
        other = Workspace.objects.create(name="Someone Else")
        stranger = User.objects.create_user(email="s@x.com", password="sup3rsecret!")
        WhatsAppIdentity.objects.create(
            workspace=other, user=stranger, phone="256772000111",
            verified_at=timezone.now(),
        )
        response = self.register()
        self.assertEqual(response.status_code, 400)
        self.assertIn("already linked", str(response.data["whatsapp_number"]))

    def test_an_unverified_claim_elsewhere_does_not_block_a_real_signup(self):
        """Only a *proved* link reserves a number, so a typo cannot squat on one."""
        other = Workspace.objects.create(name="Someone Else")
        stranger = User.objects.create_user(email="s@x.com", password="sup3rsecret!")
        WhatsAppIdentity.objects.create(
            workspace=other, user=stranger, phone="256772000111", pairing_code="000000"
        )
        self.assertEqual(self.register().status_code, 201)

    @override_settings(WHATSAPP_WELCOME_TEMPLATE="")
    def test_without_a_template_signup_still_works_and_says_so(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.data["whatsapp"]["welcome_sent"])
        # The code comes back so the app can show it instead.
        self.assertTrue(response.data["whatsapp"]["pairing_code"])
        self.assertEqual(self.templates, [])

    def test_a_failing_whatsapp_api_does_not_fail_the_signup(self):
        import apps.ai.whatsapp as whatsapp_module

        class Broken:
            def send_template(self, *a, **k):
                raise RuntimeError("Meta is down")

        whatsapp_module.get_whatsapp_provider = lambda: Broken()
        response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(email="owner@nakawa.com").exists())
        self.assertFalse(response.data["whatsapp"]["welcome_sent"])
