/**
 * How paying actually works, played out rather than described.
 *
 * A shop that has never paid a subscription by mobile money does not want a
 * paragraph; it wants to watch someone do it once. This runs the whole thing —
 * pick a package, send the money, approve it on the handset, type the
 * reference, watch it turn green — on a loop, in a phone frame, with the same
 * number and prices the real page uses.
 *
 * It is drawn, not filmed: no video file to host, nothing to buffer on a slow
 * connection, and it stays right when the prices change because it reads them
 * from the same place the billing page does.
 */

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Check,
  Copy,
  Pause,
  Play,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { planById, type PlanId } from "@/lib/demo";
import { moneyIn } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** How long each scene holds before the next one. */
const SCENE_MS = 3600;
const TICK_MS = 60;

type Scene = {
  title: string;
  caption: string;
};

export function PaymentWalkthrough({
  plan = "growth",
  months = 1,
  number,
  holder,
}: {
  plan?: PlanId;
  months?: number;
  /** The real till number, so nobody learns the wrong one. */
  number: string;
  holder?: string;
}) {
  const chosen = planById(plan);
  const total = chosen.price_ugx * months;
  const amount = moneyIn(total, "UGX");
  const till = number || "0760 417 357";

  const scenes = useMemo<Scene[]>(
    () => [
      {
        title: "Pick your package",
        caption: `Choose the plan that fits the shop. ${chosen.name} is ${amount} a month.`,
      },
      {
        title: "Choose how to pay",
        caption: "Mobile money, or a bank transfer if you would rather.",
      },
      {
        title: "Send the money",
        caption: `The amount and the number are both on screen. Tap to open your MoMo menu.`,
      },
      {
        title: "Approve on your phone",
        caption: "Your handset asks for your PIN. Nobody can take the money without it.",
      },
      {
        title: "Type the transaction ID",
        caption: "Copy it from the confirmation SMS so the payment can be matched.",
      },
      {
        title: "That is it",
        caption: "The plan turns on once the payment is confirmed, and the shop reopens in full.",
      },
    ],
    [chosen.name, amount],
  );

  const [scene, setScene] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setElapsed((ms) => {
        if (ms + TICK_MS < SCENE_MS) return ms + TICK_MS;
        // Loops rather than stopping: someone walking past the counter should
        // be able to catch it from wherever it happens to be.
        setScene((s) => (s + 1) % scenes.length);
        return 0;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, scenes.length]);

  const go = (index: number) => {
    setScene(index);
    setElapsed(0);
  };

  const current = scenes[scene];

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Play className="size-4 text-brand" /> How paying works
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Watch it once — it takes under a minute at the counter.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-5 sm:grid-cols-[220px_1fr] sm:items-center">
          <Phone scene={scene} amount={amount} till={till} holder={holder} plan={chosen.name} />

          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Step {scene + 1} of {scenes.length}
              </p>
              <p className="text-lg font-extrabold leading-tight">{current.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{current.caption}</p>
            </div>

            {/* A scrubber, so it reads as something playing rather than a
                slideshow that happens to move. */}
            <div className="flex items-center gap-1.5">
              {scenes.map((s, i) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Step ${i + 1}: ${s.title}`}
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className={cn(
                      "block h-full rounded-full bg-primary transition-[width]",
                      i < scene ? "w-full" : i > scene ? "w-0" : "",
                    )}
                    style={i === scene ? { width: `${(elapsed / SCENE_MS) * 100}%` } : undefined}
                  />
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  go(0);
                  setPlaying(true);
                }}
              >
                <RotateCcw className="size-3.5" /> Start again
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** The handset the walkthrough plays inside. */
function Phone({
  scene,
  amount,
  till,
  holder,
  plan,
}: {
  scene: number;
  amount: string;
  till: string;
  holder?: string;
  plan: string;
}) {
  return (
    <div className="mx-auto w-[210px] rounded-[1.75rem] border-[6px] border-foreground/85 bg-background p-2 shadow-lg">
      <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-foreground/20" />
      <div className="h-[330px] overflow-hidden rounded-2xl bg-muted/40 p-2.5 text-[11px]">
        {scene === 0 && <ScenePlans plan={plan} amount={amount} />}
        {scene === 1 && <SceneMethods />}
        {scene === 2 && <SceneSend amount={amount} till={till} holder={holder} />}
        {scene === 3 && <SceneApprove amount={amount} till={till} />}
        {scene === 4 && <SceneReference />}
        {scene === 5 && <SceneDone plan={plan} />}
      </div>
    </div>
  );
}

function ScenePlans({ plan, amount }: { plan: string; amount: string }) {
  return (
    <div className="space-y-2">
      <p className="font-bold">Plan &amp; billing</p>
      {["Starter", "Growth", "Enterprise"].map((name) => (
        <div
          key={name}
          className={cn(
            "rounded-lg border p-2",
            name === plan ? "border-primary bg-primary/10" : "border-border bg-card",
          )}
        >
          <p className="font-semibold">{name}</p>
          {name === plan && (
            <>
              <p className="text-[10px] text-muted-foreground">{amount} / month</p>
              <div className="mt-1.5 rounded-md bg-primary px-2 py-1 text-center text-[10px] font-bold text-primary-foreground">
                Pay for {name}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function SceneMethods() {
  const rows = [
    { label: "MTN Mobile Money", picked: true },
    { label: "Airtel Money", picked: false },
    { label: "Bank transfer", picked: false },
  ];
  return (
    <div className="space-y-2">
      <p className="font-bold">How you want to pay</p>
      {rows.map((r) => (
        <div
          key={r.label}
          className={cn(
            "flex items-center gap-2 rounded-lg border p-2",
            r.picked ? "border-primary bg-primary/5" : "border-border bg-card",
          )}
        >
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-md",
              r.picked ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            <Smartphone className="size-3" />
          </span>
          <span className="flex-1 font-semibold">{r.label}</span>
          {r.picked && <Check className="size-3 text-primary" />}
        </div>
      ))}
    </div>
  );
}

function SceneSend({ amount, till, holder }: { amount: string; till: string; holder?: string }) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-card p-2">
        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Send exactly</p>
        <p className="text-base font-extrabold leading-tight">{amount}</p>
        <p className="mt-1.5 text-[9px] uppercase tracking-wide text-muted-foreground">Send to</p>
        <p className="flex items-center gap-1 text-base font-extrabold leading-tight">
          {till}
          <Copy className="size-3 text-muted-foreground" />
        </p>
        {holder && <p className="mt-1 text-[10px] text-muted-foreground">Name: {holder}</p>}
      </div>
      <div className="rounded-md bg-primary px-2 py-1.5 text-center text-[10px] font-bold text-primary-foreground">
        Open my MTN Mobile Money menu
      </div>
      <p className="text-center text-[9px] text-muted-foreground">
        Opens the dialler with the number ready
      </p>
    </div>
  );
}

function SceneApprove({ amount, till }: { amount: string; till: string }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="rounded-lg border border-foreground/20 bg-card p-3">
        <p className="font-bold">MTN Mobile Money</p>
        <p className="mt-1.5 text-[10px] leading-relaxed">
          Send {amount} to {till}?
        </p>
        <p className="mt-2 text-[10px] text-muted-foreground">Enter PIN:</p>
        <p className="tracking-[0.35em] text-base font-bold">••••</p>
        <div className="mt-2 flex gap-1.5">
          <span className="flex-1 rounded bg-primary px-2 py-1 text-center text-[10px] font-bold text-primary-foreground">
            OK
          </span>
          <span className="flex-1 rounded border border-border px-2 py-1 text-center text-[10px]">
            Cancel
          </span>
        </div>
      </div>
      <p className="mt-2 text-center text-[9px] text-muted-foreground">
        The money only moves when you approve it
      </p>
    </div>
  );
}

function SceneReference() {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-card p-2">
        <p className="text-[9px] font-semibold uppercase text-muted-foreground">New message</p>
        <p className="mt-1 text-[10px] leading-relaxed">
          You have sent UGX 100,000. Financial Transaction Id:{" "}
          <span className="font-bold">10294857361</span>.
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Transaction ID</p>
        <div className="rounded-md border border-primary bg-card px-2 py-1.5 font-mono text-[11px] font-bold">
          10294857361
        </div>
      </div>
      <div className="rounded-md bg-primary px-2 py-1.5 text-center text-[10px] font-bold text-primary-foreground">
        Submit payment
      </div>
    </div>
  );
}

function SceneDone({ plan }: { plan: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <BadgeCheck className="size-10 text-success" />
      <p className="text-sm font-extrabold">{plan} plan active</p>
      <Badge className="border-0 bg-success text-success-foreground text-[10px]">Paid</Badge>
      <p className="px-2 text-[10px] text-muted-foreground">
        Every module is open again. Paying again adds months on top of the time you have left.
      </p>
    </div>
  );
}
