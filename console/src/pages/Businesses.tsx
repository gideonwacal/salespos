import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ago, date, planName } from "../format";
import { go, Link } from "../router";
import { Empty, Input, PageTitle, Panel, Select, StateTag, Table } from "../ui";

export function Businesses({ query }: { query: URLSearchParams }) {
  const state = query.get("state") ?? undefined;
  const search = query.get("search") ?? undefined;
  const [text, setText] = useState(search ?? "");

  const { data = [], isLoading } = useQuery({
    queryKey: ["businesses", state, search],
    queryFn: () => api.businesses({ state, search }),
  });

  // Marking one seen takes it off the queue, so the list is what is left to do.
  const queryClient = useQueryClient();
  const review = useMutation({
    mutationFn: (id: string) => api.reviewBusiness(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["businesses"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <>
      <PageTitle aside={<span className="font-mono text-xs text-dim">{data.length} shown</span>}>
        Businesses
      </PageTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            go("/businesses", { state, search: text.trim() || undefined });
          }}
        >
          <Input
            placeholder="Search name, phone, email or owner…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </form>
        <Select
          className="w-auto"
          value={state ?? ""}
          onChange={(e) => go("/businesses", { search, state: e.target.value || undefined })}
        >
          <option value="">All businesses</option>
          <option value="unreviewed">Needs review</option>
          <option value="trial">On trial</option>
          <option value="paying">Paying</option>
          <option value="expired">Trial ended, unpaid</option>
          <option value="free">Free access</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      <Panel flush>
        <Table
          head={[
            "Business",
            "Owner",
            "Status",
            "Plan",
            "Until",
            "Staff",
            "Last active",
            "Joined",
            "",
          ]}
        >
          {isLoading && <Empty colSpan={9}>loading…</Empty>}
          {!isLoading && data.length === 0 && <Empty colSpan={9}>No businesses match.</Empty>}
          {data.map((b) => (
            <tr key={b.id}>
              <td>
                <Link to={`/businesses/${b.id}`} className="font-medium hover:text-signal">
                  {b.name || "Unnamed"}
                </Link>
                <p className="text-xs text-dim">
                  {[b.industry, b.city, b.phone].filter(Boolean).join(" · ")}
                </p>
              </td>
              <td className="text-dim">{b.owner ?? "—"}</td>
              <td>
                <StateTag state={b.state} />
              </td>
              <td>{planName(b.plan)}</td>
              <td className="whitespace-nowrap font-mono text-xs">
                {b.state === "paying"
                  ? date(b.paid_until)
                  : b.state === "trial"
                    ? date(b.trial_ends)
                    : "—"}
              </td>
              <td className="font-mono">{b.members}</td>
              <td className="whitespace-nowrap font-mono text-xs text-dim">
                {ago(b.last_activity)}
              </td>
              <td className="whitespace-nowrap font-mono text-xs text-dim">{date(b.created_at)}</td>
              <td className="text-right">
                {b.reviewed_at === null && (
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate(b.id)}
                    className="whitespace-nowrap rounded border border-info/50 px-2 py-1 text-xs text-info transition-colors hover:bg-info/10 disabled:opacity-50"
                  >
                    Mark reviewed
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
