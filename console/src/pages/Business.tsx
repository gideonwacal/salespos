import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Ban, Gift, ShieldCheck } from "lucide-react";
import { api, type Access, type BusinessDetail } from "../api";
import { ago, count, date, money, planName, PLAN_NAMES } from "../format";
import { Link } from "../router";
import {
  Button,
  Failed,
  Feed,
  Input,
  Label,
  Loading,
  Metric,
  PaymentTag,
  Panel,
  Select,
  StateTag,
  Tag,
  cx,
} from "../ui";

const ACCESS: { value: Access; label: string; help: string; icon: typeof ShieldCheck }[] = [
  {
    value: "standard",
    label: "Standard",
    help: "14-day trial, then they must pay a subscription.",
    icon: ShieldCheck,
  },
  {
    value: "free",
    label: "Free",
    help: "Use their plan without paying. No trial countdown, no payment prompts.",
    icon: Gift,
  },
  {
    value: "suspended",
    label: "Suspended",
    help: "Everyone in this business is locked out until you change it back.",
    icon: Ban,
  },
];

export function Business({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["business", id],
    queryFn: () => api.business(id),
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <Failed error={error} />;

  const saved = (next: BusinessDetail) => {
    queryClient.setQueryData(["business", id], next);
    queryClient.invalidateQueries({ queryKey: ["businesses"] });
    queryClient.invalidateQueries({ queryKey: ["overview"] });
  };

  return (
    <>
      <Link
        to="/businesses"
        className="inline-flex items-center gap-1 text-xs text-dim hover:text-text"
      >
        <ArrowLeft className="size-3.5" /> Businesses
      </Link>
      <div className="mb-1 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{data.name || "Unnamed business"}</h1>
        <StateTag state={data.state} />
      </div>
      <p className="mb-6 text-sm text-dim">
        {[data.industry, data.address, data.city, data.country, data.phone, data.email]
          .filter(Boolean)
          .join(" · ")}
        {" · "}joined {date(data.created_at)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Sales recorded"
          value={count(data.stats.sales)}
          hint={`${data.stats.sales_30d} in 30 days`}
        />
        <Metric label="Sales value" value={money(data.stats.sales_total, data.currency)} />
        <Metric label="Products" value={count(data.stats.products)} />
        <Metric label="Staff" value={count(data.members.filter((m) => m.active).length)} />
      </div>

      <Decisions business={data} onSaved={saved} />

      <Referrals block={data.referral} />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="People">
          <ul className="divide-y divide-line/70">
            {data.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {m.full_name || m.email}{" "}
                    <span className="text-xs capitalize text-dim">· {m.role}</span>
                  </p>
                  <p className="text-xs text-dim">
                    {m.email}
                    {m.phone && ` · ${m.phone}`} · signed in {ago(m.last_login)}
                  </p>
                </div>
                <div className="flex gap-1">
                  {!m.active && <Tag className="border-line text-dim">Removed</Tag>}
                  {!m.user_active && <Tag className="border-bad/50 text-bad">Blocked</Tag>}
                </div>
              </li>
            ))}
          </ul>
          <Link
            to="/users"
            query={{ search: data.members[0]?.email }}
            className="mt-2 inline-block text-xs text-info hover:underline"
          >
            Manage sign-in access →
          </Link>
        </Panel>

        <Panel title="Subscription payments">
          {data.payments.length === 0 ? (
            <p className="py-4 text-sm text-dim">No payments submitted.</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {data.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="font-mono text-sm">
                      {money(p.amount, p.currency)}{" "}
                      <span className="font-sans text-xs text-dim">
                        {planName(p.plan)} × {p.months} mo
                      </span>
                    </p>
                    <p className="font-mono text-[11px] text-dim">
                      {p.transaction_id} · {p.payer_phone} · {date(p.created_at)}
                    </p>
                  </div>
                  <PaymentTag status={p.status} note={p.note} />
                </li>
              ))}
            </ul>
          )}
          {data.payments.some((p) => p.status === "pending") && (
            <Link
              to="/payments"
              query={{ status: "pending" }}
              className="mt-2 inline-block text-xs text-info hover:underline"
            >
              Review pending →
            </Link>
          )}
        </Panel>
      </div>

      <Panel
        className="mt-6"
        title="Activity in this business"
        action={
          <Link
            to="/activity"
            query={{ workspace: data.id }}
            className="text-xs text-info hover:underline"
          >
            Full history →
          </Link>
        }
      >
        <Feed entries={data.activity} showBusiness={false} />
      </Panel>
    </>
  );
}

const day = (value: string | null) => (value ? value.slice(0, 10) : "");

function Decisions({
  business,
  onSaved,
}: {
  business: BusinessDetail;
  onSaved: (next: BusinessDetail) => void;
}) {
  const initial = () => ({
    access: business.access,
    access_note: business.access_note,
    plan: business.plan,
    trial_ends: day(business.trial_ends),
    paid_until: day(business.paid_until),
    subscribed: business.subscribed,
  });
  const [form, setForm] = useState(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(initial()), [business]);

  const save = useMutation({
    mutationFn: () =>
      api.updateBusiness(business.id, { ...form, paid_until: form.paid_until || null }),
    onSuccess: (next) => {
      onSaved(next);
      toast.success("Decision saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save."),
  });

  const extend = (field: "trial_ends" | "paid_until", days: number) =>
    setForm((f) => {
      const base = f[field] ? new Date(f[field]) : new Date();
      const start = base.getTime() < Date.now() ? new Date() : base;
      start.setDate(start.getDate() + days);
      return {
        ...f,
        [field]: start.toISOString().slice(0, 10),
        subscribed: field === "paid_until" ? true : f.subscribed,
      };
    });

  const suspending = form.access === "suspended" && business.access !== "suspended";

  return (
    <Panel
      className="mt-6 border-signal/40"
      title="Your decision"
      action={<span className="text-xs text-dim">takes effect immediately · logged</span>}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {ACCESS.map((option) => {
          const selected = form.access === option.value;
          const danger = option.value === "suspended";
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setForm({ ...form, access: option.value })}
              className={cx(
                "rounded-lg border p-3 text-left transition-colors",
                selected
                  ? danger
                    ? "border-bad bg-bad/10"
                    : "border-signal bg-signal/10"
                  : "border-line hover:border-dim",
              )}
            >
              <p
                className={cx(
                  "flex items-center gap-2 text-sm font-semibold",
                  selected && (danger ? "text-bad" : "text-signal"),
                )}
              >
                <option.icon className="size-4" />
                {option.label}
              </p>
              <p className="mt-1 text-xs text-dim">{option.help}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <Label>Plan</Label>
          <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
            {Object.entries(PLAN_NAMES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <div>
          <Label>Trial ends</Label>
          <Input
            type="date"
            value={form.trial_ends}
            onChange={(e) => setForm({ ...form, trial_ends: e.target.value })}
          />
          <div className="mt-1 flex gap-1">
            <Button tone="ghost" size="sm" onClick={() => extend("trial_ends", 7)}>
              +7d
            </Button>
            <Button tone="ghost" size="sm" onClick={() => extend("trial_ends", 14)}>
              +14d
            </Button>
          </div>
        </div>
        <div>
          <Label>Paid until</Label>
          <Input
            type="date"
            value={form.paid_until}
            onChange={(e) =>
              setForm({ ...form, paid_until: e.target.value, subscribed: !!e.target.value })
            }
          />
          <div className="mt-1 flex gap-1">
            <Button tone="ghost" size="sm" onClick={() => extend("paid_until", 30)}>
              +1 month
            </Button>
          </div>
        </div>
        <label className="block">
          <Label>Private note</Label>
          <Input
            placeholder="Why this decision"
            value={form.access_note}
            onChange={(e) => setForm({ ...form, access_note: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          tone={suspending ? "danger" : "signal"}
          disabled={save.isPending}
          onClick={() => {
            if (
              suspending &&
              !window.confirm(`Suspend ${business.name}? Everyone in it will be locked out.`)
            ) {
              return;
            }
            save.mutate();
          }}
        >
          {save.isPending ? "Saving…" : suspending ? "Suspend business" : "Save decision"}
        </Button>
        <Button tone="ghost" onClick={() => setForm(initial())}>
          Reset
        </Button>
      </div>
    </Panel>
  );
}


/** Who this business brought in, and who brought this business.
 *
 *  Both directions are shown. The outbound list says whether the invite
 *  scheme is working for them; the inbound line is how you would notice one
 *  account minting others to unlock itself — five sibling businesses that all
 *  arrived the same afternoon and never sold anything is a pattern worth
 *  seeing. */
function Referrals({ block }: { block: BusinessDetail["referral"] }) {
  const short = block.businesses.length === 0 && block.opens === 0 && !block.referred_by;
  if (short && !block.code) {
    return (
      <Panel className="mt-6" title="Referrals">
        <p className="py-4 text-sm text-dim">
          This business has never opened its invite link.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      className="mt-6"
      title="Referrals"
      action={
        block.code ? (
          <span className="font-mono text-xs text-dim">code {block.code}</span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Businesses referred"
          value={count(block.signups)}
          hint={`${block.needed} unlocks 3 days`}
          accent={block.signups >= block.needed}
        />
        <Metric
          label="Link opened by"
          value={count(block.opens)}
          hint={`${block.total_opens} times in total`}
        />
        <Metric
          label="Free days claimed"
          value={block.grace_granted_at ? "Yes" : "No"}
          hint={block.grace_granted_at ? date(block.grace_granted_at) : "not yet"}
        />
        <Metric
          label="Free days end"
          value={block.grace_until ? date(block.grace_until) : "—"}
          hint={block.grace_active ? "running now" : "not running"}
          accent={block.grace_active}
        />
      </div>

      {block.referred_by && (
        <p className="mt-4 rounded-md border border-line/70 px-3 py-2 text-sm text-dim">
          Brought in by{" "}
          <Link
            to={`/businesses/${block.referred_by.id}`}
            className="font-medium text-info hover:underline"
          >
            {block.referred_by.name}
          </Link>{" "}
          on {date(block.referred_by.joined)}
        </p>
      )}

      {block.businesses.length > 0 && (
        <>
          <p className="mb-1 mt-5 text-xs uppercase tracking-wide text-dim">
            Businesses they referred
          </p>
          <ul className="divide-y divide-line/70">
            {block.businesses.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <Link
                    to={`/businesses/${b.id}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {b.name || "Unnamed business"}
                  </Link>
                  <p className="text-xs text-dim">joined {date(b.joined)}</p>
                </div>
                {b.subscribed ? (
                  <Tag className="border-ok/40 text-ok">Paying</Tag>
                ) : (
                  <Tag className="border-line text-dim">Not paying</Tag>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
