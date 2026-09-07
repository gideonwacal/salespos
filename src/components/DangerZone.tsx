/**
 * The owner's reset button, and the guard rail around it.
 *
 * Clearing a store is not undoable and there is no confirmation dialog anyone
 * reads, so this asks for something a thumb cannot do by accident: the owner
 * types the word out. The two actions are deliberately different — emptying
 * the shelves keeps the price list a shop spent weeks building, and is almost
 * always what "clear everything" actually means.
 *
 * Whatever is cleared is filed as an adjustment per product first, so the
 * movement chart still shows where the stock went, and the cashier's screen
 * catches up on its next refresh rather than holding a phantom shelf.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert, Trash2, Undo2 } from "lucide-react";
import { clearStore } from "@/lib/db";
import { num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Mode = "zero" | "delete";

const COPY: Record<
  Mode,
  { title: string; word: string; button: string; blurb: string; warning: string }
> = {
  zero: {
    title: "Empty every shelf",
    word: "EMPTY",
    button: "Empty the shelves",
    blurb:
      "Sets every stock count to zero and keeps your items, prices and reorder levels. Use this to start a fresh stock take.",
    warning:
      "Every product drops to zero. The counter will not be able to sell anything until stock is received again.",
  },
  delete: {
    title: "Delete every item in the store",
    word: "DELETE",
    button: "Delete everything",
    blurb:
      "Removes the products themselves — names, prices, the lot. Items that appear on a past sale are kept and zeroed instead, because deleting one would erase that sale.",
    warning:
      "This cannot be undone. Your product list is gone and has to be entered or imported again.",
  },
};

export function DangerZone({ productCount }: { productCount: number }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const copy = mode ? COPY[mode] : null;
  const armed = !!copy && typed.trim().toUpperCase() === copy.word;

  const close = () => {
    setMode(null);
    setTyped("");
  };

  const run = async () => {
    if (!mode || !armed) return;
    setBusy(true);
    try {
      const result = await clearStore(mode);
      // Say what actually happened. "Kept" is the surprising part, and an owner
      // who is not told will assume the clear half-failed.
      const parts = [`${num(result.zeroed)} item${result.zeroed === 1 ? "" : "s"} zeroed`];
      if (result.deleted) parts.push(`${num(result.deleted)} deleted`);
      if (result.kept) parts.push(`${num(result.kept)} kept — they appear on past sales`);
      toast.success("Store cleared", { description: parts.join(" · ") });
      close();
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not clear the store");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="border-destructive/40 bg-destructive/[0.03]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <ShieldAlert className="size-4" /> Danger zone
          </CardTitle>
          <CardDescription>
            Owner only, and neither of these can be undone. Export your stock from Import &amp;
            export first if you might want it back.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row
            icon={Undo2}
            title={COPY.zero.title}
            blurb={COPY.zero.blurb}
            action={COPY.zero.button}
            disabled={productCount === 0}
            onClick={() => setMode("zero")}
          />
          <Row
            icon={Trash2}
            title={COPY.delete.title}
            blurb={COPY.delete.blurb}
            action={COPY.delete.button}
            disabled={productCount === 0}
            onClick={() => setMode("delete")}
          />
          {productCount === 0 && (
            <p className="text-xs text-muted-foreground">There is nothing in the store to clear.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="size-4" /> {copy?.title}
            </DialogTitle>
            <DialogDescription>{copy?.blurb}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
              {copy?.warning}
            </p>
            <p className="text-sm text-muted-foreground">
              This affects all {num(productCount)} item{productCount === 1 ? "" : "s"} in the store,
              and the counter sees it straight away.
            </p>
            <div className="space-y-1.5">
              <Label>
                Type <span className="font-mono font-bold">{copy?.word}</span> to confirm
              </Label>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={copy?.word}
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!armed || busy} onClick={run}>
              {busy ? "Clearing…" : copy?.button}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({
  icon: Icon,
  title,
  blurb,
  action,
  disabled,
  onClick,
}: {
  icon: typeof Trash2;
  title: string;
  blurb: string;
  action: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <div className="min-w-[220px] flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-3.5" /> {title}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
      </div>
      <Button variant="destructive" size="sm" disabled={disabled} onClick={onClick}>
        {action}
      </Button>
    </div>
  );
}
