import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import type { ActivityEntry, BusinessState, PaymentStatus } from "./api";
import { ago, stamp } from "./format";
import { Link } from "./router";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export function Panel({
  title,
  action,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel/90 backdrop-blur", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-dim">{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Button({
  tone = "default",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "signal" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        tone === "signal" && "bg-signal text-signal-ink hover:brightness-110",
        tone === "danger" && "bg-bad/90 text-ink hover:bg-bad",
        tone === "ghost" && "text-dim hover:bg-panel-2 hover:text-text",
        tone === "default" && "border border-line bg-panel-2 text-text hover:border-dim",
        className,
      )}
    />
  );
}

const field =
  "w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-text placeholder:text-dim/70 focus:border-signal focus:outline-none";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(field, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(field, "pr-8", props.className)} />;
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-dim">
      {children}
    </span>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

const Dot = () => <span className="size-1.5 rounded-full bg-current" />;

const STATE: Record<BusinessState, [string, string]> = {
  trial: ["On trial", "border-warn/40 text-warn"],
  paying: ["Paying", "border-ok/40 text-ok"],
  expired: ["Trial ended", "border-line text-dim"],
  free: ["Free access", "border-info/40 text-info"],
  suspended: ["Suspended", "border-bad/50 text-bad"],
};

export const STATE_LABEL = Object.fromEntries(
  Object.entries(STATE).map(([k, [label]]) => [k, label]),
) as Record<BusinessState, string>;

export function StateTag({ state }: { state: BusinessState }) {
  const [label, className] = STATE[state];
  return (
    <Tag className={className}>
      <Dot />
      {label}
    </Tag>
  );
}

const PAYMENT: Record<PaymentStatus, [string, string]> = {
  pending: ["To confirm", "border-warn/40 text-warn"],
  approved: ["Approved", "border-ok/40 text-ok"],
  rejected: ["Rejected", "border-bad/50 text-bad"],
};

export function PaymentTag({ status, note }: { status: PaymentStatus; note?: string }) {
  const [label, className] = PAYMENT[status];
  return (
    <span title={note || undefined}>
      <Tag className={className}>
        <Dot />
        {label}
      </Tag>
    </span>
  );
}

export function Metric({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border bg-panel/90 p-4 transition-colors",
        accent ? "border-signal/60" : "border-line",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">{label}</p>
      <p
        className={cx(
          "mt-2 font-mono text-2xl font-semibold tabular-nums",
          accent ? "text-signal" : "text-text",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-dim">{hint}</p>}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {head.map((h, i) => (
              <th
                key={i}
                className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-dim"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70 [&_td]:px-4 [&_td]:py-3 [&_tr:hover]:bg-panel-2/60">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ children, colSpan }: { children: ReactNode; colSpan?: number }) {
  const body = <p className="py-8 text-center text-sm text-dim">{children}</p>;
  return colSpan ? (
    <tr>
      <td colSpan={colSpan}>{body}</td>
    </tr>
  ) : (
    body
  );
}

export function PageTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {aside}
    </div>
  );
}

export function Feed({
  entries,
  showBusiness = true,
}: {
  entries: ActivityEntry[];
  showBusiness?: boolean;
}) {
  if (!entries.length) return <Empty>No activity yet.</Empty>;
  return (
    <ol className="relative">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3 py-2.5 text-sm">
          <span
            className={cx(
              "mt-1.5 size-2 shrink-0 rounded-full",
              e.by_platform ? "bg-signal shadow-[0_0_10px] shadow-signal/60" : "bg-line",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="leading-snug">
              <span className="font-medium">{e.user ?? "Someone"}</span>{" "}
              <span className={e.by_platform ? "text-signal" : "text-dim"}>{e.action}</span>
              {e.target && <span className="text-text"> · {e.target}</span>}
              {showBusiness && e.workspace && e.workspace_id && (
                <>
                  <span className="text-dim"> in </span>
                  <Link to={`/businesses/${e.workspace_id}`} className="text-info hover:underline">
                    {e.workspace}
                  </Link>
                </>
              )}
            </p>
          </div>
          <time
            className="shrink-0 font-mono text-xs text-dim"
            title={`${stamp(e.created_at)}${e.ip ? ` · ${e.ip}` : ""}`}
          >
            {ago(e.created_at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

export function Loading() {
  return <p className="py-10 text-center font-mono text-sm text-dim">loading…</p>;
}

export function Failed({ error }: { error: unknown }) {
  return (
    <p className="rounded-lg border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
      {error instanceof Error ? error.message : "Something went wrong."}
    </p>
  );
}
