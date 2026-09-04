import { useEffect, useMemo, useState } from "react";
import { Calculator as CalcIcon, X, Check, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { moneyIn } from "@/lib/format";
import { CURRENCIES, currencyByCode } from "@/lib/demo";
import { useBusiness } from "@/hooks/useBusiness";

const KEYS = [
  ["7", "8", "9", "/"],
  ["4", "5", "6", "*"],
  ["1", "2", "3", "-"],
  ["0", ".", "%", "+"],
];

/** Rates are a per-device convenience, remembered between shifts. */
const RATE_KEY = "salespos-calc-rates";

function loadRates(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(RATE_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function saveRates(rates: Record<string, number>) {
  try {
    localStorage.setItem(RATE_KEY, JSON.stringify(rates));
  } catch {
    /* private mode — this shift only */
  }
}

/**
 * Floating utility calculator.
 *
 * Works in the shop's own currency, whatever that is, and can quote a total in
 * a second one for a customer paying in dollars or across a border. The rate is
 * typed by whoever is on the counter and remembered on that device — the app
 * has no live FX feed, and a stale rate quietly applied to a sale would be
 * worse than one someone had to look at.
 *
 * Applying to checkout always applies the shop-currency amount: the sale is
 * recorded in the currency the books are kept in.
 */
export function PosCalculator({
  onApply,
  applyLabel = "Apply total to checkout",
}: {
  onApply?: (value: number) => void;
  applyLabel?: string;
}) {
  const business = useBusiness();
  const base = useMemo(() => {
    const currency = currencyByCode(business.currency);
    return {
      code: currency.code as string,
      symbol: business.currency_symbol || currency.symbol,
      decimals: currency.decimals,
    };
  }, [business.currency, business.currency_symbol]);

  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<number | null>(null);

  const [quoteCode, setQuoteCode] = useState(base.code);
  const [rates, setRates] = useState<Record<string, number>>({});
  useEffect(() => setRates(loadRates()), []);
  // Following the shop's currency matters when the owner changes it mid-session.
  useEffect(() => setQuoteCode(base.code), [base.code]);

  const converting = quoteCode !== base.code;
  const rate = rates[`${base.code}_${quoteCode}`] ?? 0;

  const setRate = (value: number) => {
    const next = { ...rates, [`${base.code}_${quoteCode}`]: value };
    setRates(next);
    saveRates(next);
  };

  const evaluate = (input: string) => {
    if (!/^[\d+\-*/.%()\s]*$/.test(input)) return null;
    try {
      // percentages: "200*10%" → "200*10/100"
      const safe = input.replace(/%/g, "/100");
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict"; return (${safe})`)() as unknown;
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };

  const press = (k: string) => {
    const next = expr + k;
    setExpr(next);
    setResult(evaluate(next));
  };

  const equals = () => {
    const v = evaluate(expr);
    if (v === null) return;
    setResult(v);
    setExpr(String(v));
  };

  /** Round to the shop currency's own precision, not to whole units. */
  const toBasePrecision = (value: number) => {
    const factor = 10 ** base.decimals;
    return Math.round(value * factor) / factor;
  };

  return (
    <>
      <Button
        id="tour-calculator"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open calculator"
        className="no-print fixed bottom-5 right-5 z-40 size-14 rounded-full shadow-lg transition-transform hover:scale-105"
      >
        {open ? <X className="size-5" /> : <CalcIcon className="size-5" />}
      </Button>

      <div
        className={cn(
          "no-print fixed bottom-24 right-5 z-40 w-[268px] origin-bottom-right rounded-2xl border border-border bg-card p-3 shadow-xl transition-all duration-200",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
      >
        <div className="rounded-lg bg-muted px-3 py-2 text-right">
          <p className="tabular truncate text-xs text-muted-foreground">{expr || "0"}</p>
          <p className="tabular truncate text-lg font-bold">
            {result === null ? "—" : moneyIn(result, base.code, base.symbol)}
          </p>
          {converting && result !== null && (
            <p className="tabular truncate text-xs font-semibold text-primary">
              {rate > 0 ? (
                <>= {moneyIn(result * rate, quoteCode)}</>
              ) : (
                <span className="text-muted-foreground">set a rate below</span>
              )}
            </p>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <ArrowLeftRight className="size-3.5 shrink-0 text-muted-foreground" />
          <select
            aria-label="Quote in another currency"
            value={quoteCode}
            onChange={(e) => setQuoteCode(e.target.value)}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code === base.code ? `${c.code} (shop)` : c.code}
              </option>
            ))}
          </select>
          {converting && (
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              aria-label={`Rate from ${base.code} to ${quoteCode}`}
              placeholder="rate"
              value={rate || ""}
              onChange={(e) => setRate(Number(e.target.value) || 0)}
              className="h-8 w-[86px] text-xs"
            />
          )}
        </div>
        {converting && (
          <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
            1 {base.code} = {rate || "?"} {quoteCode}. Checkout still records{" "}
            {base.code}.
          </p>
        )}

        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {KEYS.flat().map((k) => (
            <Button key={k} variant={/[\d.]/.test(k) ? "outline" : "secondary"} onClick={() => press(k)}>
              {k}
            </Button>
          ))}
          <Button
            variant="ghost"
            className="col-span-2"
            onClick={() => {
              setExpr("");
              setResult(null);
            }}
          >
            Clear
          </Button>
          <Button className="col-span-2" onClick={equals}>
            =
          </Button>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {[5, 10, 15].map((p) => (
            <Button
              key={p}
              size="sm"
              variant="outline"
              onClick={() => {
                const value = evaluate(expr);
                if (value === null) return;
                // Round to the currency's precision — whole shillings, but
                // cents for a shop trading in dollars.
                const discounted = toBasePrecision(value * (1 - p / 100));
                setExpr(String(discounted));
                setResult(discounted);
              }}
            >
              -{p}%
            </Button>
          ))}
        </div>

        {onApply && (
          <Button
            className="mt-2 w-full bg-success text-success-foreground hover:bg-success/90"
            disabled={result === null}
            onClick={() => {
              if (result === null) return;
              // Always the shop-currency figure, never the converted quote.
              onApply(toBasePrecision(result));
              setOpen(false);
            }}
          >
            <Check className="size-4" /> {applyLabel}
          </Button>
        )}
      </div>
    </>
  );
}
