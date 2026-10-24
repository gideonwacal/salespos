import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Eye, Gift, Share2, Store, Users } from "lucide-react";

import { fetchReferrals } from "@/lib/api";
import { trialStatus } from "@/lib/demo";
import { useBusiness } from "@/hooks/useBusiness";
import { shortDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/referrals")({
  head: () => ({
    meta: [
      { title: "Invite & earn — SalesPos" },
      {
        name: "description",
        content:
          "Share your SalesPos invite link. Five businesses that sign up through it unlock three more days.",
      },
    ],
  }),
  component: ReferralsPage,
});

function ReferralsPage() {
  const business = useBusiness();
  const status = trialStatus(business);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["referrals"],
    queryFn: fetchReferrals,
    staleTime: 30_000,
  });

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked outside a secure context and on some Android
      // browsers. The link is on screen and selectable either way.
      toast.error("Could not copy — select the link and copy it by hand");
    }
  };

  const share = async () => {
    if (!data) return;
    const text = `Run your shop on SalesPos — sales, stock and profit in one place. ${data.link}`;
    // The share sheet is how this actually travels: straight into WhatsApp.
    if (navigator.share) {
      try {
        await navigator.share({ title: "SalesPos", text, url: data.link });
        return;
      } catch {
        return; // they dismissed the sheet; not an error
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading your invite link…</p>;
  }
  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Could not load your invite link. Only the business owner can see this page.
        </p>
      </div>
    );
  }

  const progress = Math.min(100, (data.signups / data.needed) * 100);
  const done = data.signups >= data.needed;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invite &amp; earn</h1>
        <p className="text-sm text-muted-foreground">
          Get {data.needed} businesses onto SalesPos and we'll unlock your account for{" "}
          {data.grace_days} more days — once.
        </p>
      </div>

      {/* The link, which is the whole point of the page. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Share2 className="h-4 w-4" /> Your invite link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={data.link} className="font-mono text-xs sm:text-sm" />
            <div className="flex gap-2">
              <Button variant="outline" onClick={copy} className="flex-1 sm:flex-none">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-2">{copied ? "Copied" : "Copy"}</span>
              </Button>
              <Button onClick={share} className="flex-1 sm:flex-none">
                <Share2 className="h-4 w-4" />
                <span className="ml-2">Share</span>
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Your code is <span className="font-mono font-semibold">{data.code}</span>. Anyone
            who signs up through this link is counted to you.
          </p>
        </CardContent>
      </Card>

      {/* Progress toward the unlock. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gift className="h-4 w-4" /> Progress to {data.grace_days} free days
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold">
              {data.signups}
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                / {data.needed}
              </span>
            </span>
            {data.grace_granted ? (
              <Badge variant="secondary">Already claimed</Badge>
            ) : done ? (
              <Badge className="bg-emerald-600">Unlocked</Badge>
            ) : (
              <span className="text-sm text-muted-foreground">
                {data.remaining} to go
              </span>
            )}
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          {data.grace_active && data.grace_until && (
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              Your {data.grace_days} free days are running — they end{" "}
              {shortDate(data.grace_until)}.{" "}
              {status.locked ? null : (
                <>
                  After that you'll need the subscription to carry on.{" "}
                  <Link to="/billing" className="font-semibold underline">
                    Subscribe now
                  </Link>
                </>
              )}
            </p>
          )}

          {data.grace_granted && !data.grace_active && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              You've already used your free days. Carrying on needs the
              subscription —{" "}
              <Link to="/billing" className="font-semibold underline">
                see the price
              </Link>
              .
            </p>
          )}

          {/* Said plainly, because the opposite is the obvious assumption. */}
          <p className="text-xs text-muted-foreground">
            Only businesses that finish signing up count. Opening the link is
            tracked below so you can see how it's travelling, but it doesn't
            count toward the {data.needed}.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Who actually joined. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="h-4 w-4" /> Businesses that joined ({data.signups})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.businesses.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nobody has signed up through your link yet.
              </p>
            ) : (
              <ul className="divide-y">
                {data.businesses.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{b.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Joined {shortDate(b.joined)}
                      </p>
                    </div>
                    {b.subscribed && (
                      <Badge variant="secondary" className="shrink-0">
                        Subscribed
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Who opened it — what they asked to be able to monitor. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4" /> Link opens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex gap-6">
              <div>
                <p className="text-2xl font-bold">{data.opens}</p>
                <p className="text-xs text-muted-foreground">people</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{data.total_opens}</p>
                <p className="text-xs text-muted-foreground">times opened</p>
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {data.opens > 0 ? Math.round((data.signups / data.opens) * 100) : 0}%
                </p>
                <p className="text-xs text-muted-foreground">signed up</p>
              </div>
            </div>

            {data.visits.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nobody has opened your link yet. Share it and check back.
              </p>
            ) : (
              <ul className="max-h-64 divide-y overflow-y-auto">
                {data.visits.map((v, i) => (
                  <li key={i} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      {v.device || "Opened"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {shortDate(v.opened)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {/* Said once, so nobody wonders what is being collected. */}
            <p className="mt-3 text-xs text-muted-foreground">
              We don't record who opened the link — only that somebody did, and
              roughly what they opened it on.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
