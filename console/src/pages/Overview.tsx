import { useQuery } from "@tanstack/react-query";
import { api, type BusinessState } from "../api";
import { count, money } from "../format";
import { Link } from "../router";
import { Failed, Feed, Loading, Metric, PageTitle, Panel, STATE_LABEL } from "../ui";

const STATES: BusinessState[] = [
  "trial",
  "paying",
  "referral_grace",
  "expired",
  "free",
  "suspended",
];

export function Overview() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["overview"],
    queryFn: api.overview,
    refetchInterval: 30_000,
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <Failed error={error} />;

  return (
    <>
      <PageTitle
        aside={<span className="font-mono text-xs text-dim">live · refreshes every 30s</span>}
      >
        Overview
      </PageTitle>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Businesses"
          value={count(data.businesses)}
          hint={`+${data.signups_30d} in 30 days`}
        />
        <Metric
          label="Users"
          value={count(data.users)}
          hint={`${data.active_users_7d} active this week`}
        />
        <Metric
          label="Revenue this month"
          value={money(data.revenue_month)}
          hint={`${money(data.revenue_total)} all time`}
        />
        <Link to="/payments" query={{ status: "pending" }}>
          <Metric
            label="Payments to confirm"
            value={count(data.pending_payments)}
            hint={data.pending_payments ? "Review now →" : "All clear"}
            accent={data.pending_payments > 0}
          />
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATES.map((state) => (
          <Link key={state} to="/businesses" query={{ state }}>
            <Metric label={STATE_LABEL[state]} value={count(data.states[state])} />
          </Link>
        ))}
      </div>

      {/* How the invite scheme is doing. Opens are shown beside signups
          because the gap between them is the thing worth watching: a lot of
          opens and no signups means the link travels but the pitch does not. */}
      <Panel className="mt-6" title="Referrals">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label="Businesses referred"
            value={count(data.referrals.signups)}
            hint={`+${data.referrals.signups_30d} in 30 days`}
          />
          <Metric
            label="Link opens"
            value={count(data.referrals.link_opens)}
            hint={
              data.referrals.link_opens
                ? `${Math.round(
                    (data.referrals.signups / data.referrals.link_opens) * 100,
                  )}% signed up`
                : "none yet"
            }
          />
          <Metric
            label="Businesses sharing"
            value={count(data.referrals.referring_businesses)}
          />
          <Metric
            label="Claimed free days"
            value={count(data.referrals.grace_granted)}
            hint="3 days each, once"
          />
        </div>
      </Panel>

      <Panel
        className="mt-6"
        title={`Live activity · ${count(data.activity_24h)} events in 24h`}
        action={
          <Link to="/activity" className="text-xs text-info hover:underline">
            Full log →
          </Link>
        }
      >
        <Feed entries={data.recent_activity} />
      </Panel>
    </>
  );
}
