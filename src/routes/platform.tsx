/**
 * Where the platform owner lands: which of the two jobs is this?
 *
 * They have no shop of their own, so there is no dashboard to drop them on.
 * Either they are here to run the platform — every business, payments,
 * activity — or they are here to look inside one shop, usually because
 * somebody rang up about it. Asking is one tap and removes the guess.
 *
 * Opening a business is standing in it, not joining it: nothing is written to
 * that shop's staff list, because that list belongs to the shop and a stranger
 * appearing in it would be the shop's problem to explain.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, ExternalLink, Search, ShieldCheck, Store } from "lucide-react";
import {
  CONSOLE_URL,
  consoleConfigured,
  fetchMe,
  setWorkspaceId,
  type ApiWorkspace,
} from "@/lib/api";
import { businessFrom } from "@/lib/auth";
import { mergeServerBusiness } from "@/lib/demo";
import { useAuth } from "@/hooks/useAuth";
import { resolveIndustry } from "@/lib/industry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { APP } from "@/lib/format";

export const Route = createFileRoute("/platform")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Choose where to go — SalesPos" },
      {
        name: "description",
        content: "Open the Control Room, or step into one business.",
      },
    ],
  }),
  component: PlatformChooser,
});

function PlatformChooser() {
  const navigate = useNavigate();
  const { user, isPlatform, loading, refresh } = useAuth();
  const [shops, setShops] = useState<ApiWorkspace[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  // Safe to read directly: this route is ssr:false, so there is no server
  // render to disagree with.
  const hasConsole = consoleConfigured();

  useEffect(() => {
    // Anyone who is not the platform owner has a shop of their own and no
    // business being asked this question.
    if (!loading && user && !isPlatform) navigate({ to: "/dashboard", replace: true });
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, user, isPlatform, navigate]);

  useEffect(() => {
    fetchMe()
      .then((me) => setShops(me.workspaces ?? []))
      .catch(() => toast.error("Could not load the businesses just now."))
      .finally(() => setFetching(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter((s) =>
      [s.name, s.city, s.phone, s.industry]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [shops, query]);

  /** Step into a shop: point every request at it, then go to its dashboard. */
  const open = async (shop: ApiWorkspace) => {
    setBusy(shop.id);
    try {
      setWorkspaceId(shop.id);
      mergeServerBusiness(businessFrom(shop));
      // The session is holding "no workspace"; ask again so the shell knows
      // whose shop it is showing before the dashboard renders.
      refresh();
      navigate({ to: "/dashboard" });
    } catch {
      toast.error("Could not open that business.");
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-brand px-6 py-12 text-brand-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5" />
          <p className="text-sm font-semibold">
            Signed in as {user?.full_name || user?.email} · platform owner
          </p>
        </div>

        <h1 className="text-3xl font-extrabold leading-tight">Where are you headed?</h1>

        {/* The console is a separate site and is deployed separately. Offering
            the link before it exists sends the browser to localhost:8090 —
            the visitor's own machine — which reads as "server down" and gives
            no clue what is actually wrong. */}
        {hasConsole ? (
          <a href={CONSOLE_URL} className="block">
            <Card className="transition-shadow hover:shadow-lg">
              <CardContent className="flex items-center gap-4 p-5">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Building2 className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold">Control Room</p>
                  <p className="text-sm text-muted-foreground">
                    Every business, their payments, users and activity — and who needs reviewing.
                  </p>
                </div>
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </a>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex items-center gap-4 p-5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Building2 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-muted-foreground">Control Room</p>
                <p className="text-sm text-muted-foreground">
                  Not deployed yet. Publish the <code>console/</code> site, then set{" "}
                  <code>VITE_CONSOLE_URL</code> on this app and redeploy.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="size-4" /> Open a business
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Step into a shop and see exactly what its owner sees. Nothing is added to their staff
              list.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by name, town, phone or trade"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="max-h-[45vh] space-y-2 overflow-y-auto">
              {fetching && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Loading businesses…
                </p>
              )}
              {!fetching && filtered.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {shops.length === 0
                    ? "No businesses have registered yet."
                    : "No business matches that."}
                </p>
              )}
              {filtered.map((shop) => (
                <button
                  key={shop.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => open(shop)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{shop.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {[String(shop.city ?? ""), String(shop.phone ?? "")]
                        .filter(Boolean)
                        .join(" · ") || "No contact on file"}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {resolveIndustry(String(shop.industry ?? "")).label}
                  </Badge>
                  {busy === shop.id && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">opening…</span>
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-brand-foreground/60">
          {APP.name} · you are standing in these shops, not joining them
        </p>
      </div>
    </div>
  );
}
