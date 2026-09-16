export const PLAN_NAMES: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
};

export const planName = (id: string) => PLAN_NAMES[id] ?? id;

export function money(value: string | number, currency = "UGX") {
  const amount = Number(value ?? 0);
  const whole = ["UGX", "KES", "TZS", "RWF"].includes(currency);
  return `${currency} ${amount.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

export const count = (value: number) => Number(value ?? 0).toLocaleString("en-US");

export function date(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ago(value: string | null | undefined) {
  if (!value) return "—";
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  return date(value);
}

export const stamp = (value: string) => new Date(value).toLocaleString("en-GB");
