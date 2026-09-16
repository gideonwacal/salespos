import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Payment } from "../api";
import { ago, date, money, planName } from "../format";
import { go, Link } from "../router";
import { Button, Empty, PageTitle, Panel, PaymentTag, Table, cx } from "../ui";

const TABS = [
  { value: "pending", label: "To confirm" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "", label: "All" },
];

export function Payments({ query }: { query: URLSearchParams }) {
  const status = query.get("status") ?? "";
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["payments", status],
    queryFn: () => api.payments({ status: status || undefined }),
    refetchInterval: 30_000,
  });

  const decide = useMutation({
    mutationFn: (input: { payment: Payment; decision: "approve" | "reject"; note?: string }) =>
      api.decidePayment(input.payment.id, input.decision, input.note),
    onSuccess: (payment) => {
      toast.success(
        payment.status === "approved"
          ? `Approved: ${payment.workspace} is now on ${planName(payment.plan)}`
          : "Payment rejected",
      );
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update."),
  });

  return (
    <>
      <PageTitle
        aside={
          <div className="flex rounded-lg border border-line bg-panel p-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => go("/payments", { status: tab.value || undefined })}
                className={cx(
                  "rounded-md px-3 py-1 text-xs font-medium",
                  status === tab.value ? "bg-panel-2 text-text" : "text-dim hover:text-text",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      >
        Payments
      </PageTitle>
      <p className="-mt-3 mb-4 text-sm text-dim">
        Match each transaction ID and amount against the MTN messages on your phone before
        approving. Approval activates the plan at once.
      </p>

      <Panel flush>
        <Table
          head={[
            "Submitted",
            "Business",
            "Plan",
            "Amount",
            "Paid from",
            "Transaction ID",
            "Status",
            "",
          ]}
        >
          {isLoading && <Empty colSpan={8}>loading…</Empty>}
          {!isLoading && data.length === 0 && <Empty colSpan={8}>Nothing here.</Empty>}
          {data.map((p) => (
            <tr key={p.id}>
              <td className="whitespace-nowrap">
                <p className="font-mono text-xs">{date(p.created_at)}</p>
                <p className="font-mono text-[11px] text-dim">{ago(p.created_at)}</p>
              </td>
              <td>
                <Link
                  to={`/businesses/${p.workspace_id}`}
                  className="font-medium hover:text-signal"
                >
                  {p.workspace}
                </Link>
                <p className="text-xs text-dim">{p.submitted_by}</p>
              </td>
              <td className="whitespace-nowrap">
                {planName(p.plan)} <span className="text-dim">× {p.months} mo</span>
              </td>
              <td className="whitespace-nowrap font-mono font-semibold">
                {money(p.amount, p.currency)}
              </td>
              <td className="whitespace-nowrap font-mono text-xs">{p.payer_phone}</td>
              <td className="font-mono text-xs text-signal">{p.transaction_id}</td>
              <td>
                <PaymentTag status={p.status} note={p.note} />
              </td>
              <td>
                {p.status === "pending" && (
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      tone="signal"
                      disabled={decide.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Approve ${money(p.amount, p.currency)} from ${p.workspace} (${p.transaction_id})?`,
                          )
                        ) {
                          decide.mutate({ payment: p, decision: "approve" });
                        }
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => {
                        const note = window.prompt(
                          "Reason shown to the shop (optional)",
                          "Payment not found on the MTN statement.",
                        );
                        if (note === null) return;
                        decide.mutate({ payment: p, decision: "reject", note });
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
