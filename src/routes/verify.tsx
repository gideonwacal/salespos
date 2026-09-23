/**
 * The page the link in the inbox lands on.
 *
 * Does one thing and says plainly which of the three ways it went: confirmed,
 * already done, or a link that is no longer any good. The last case offers the
 * way out rather than leaving someone re-clicking a dead link — that is the
 * whole reason the resend exists.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, CircleAlert, Loader2, MailCheck } from "lucide-react";
import { resendVerification, verifyEmail } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { APP } from "@/lib/format";

export const Route = createFileRoute("/verify")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Confirm your email — SalesPos" },
      { name: "description", content: "Confirm your email address to finish setting up SalesPos." },
    ],
  }),
  component: VerifyPage,
});

type State = "checking" | "done" | "bad" | "missing";

function VerifyPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [state, setState] = useState<State>("checking");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      setState("missing");
      return;
    }
    verifyEmail(token)
      .then(() => {
        setState("done");
        // The session is holding a stale "unverified" — ask the server again
        // so the shop opens without a sign-out and back in.
        refresh();
      })
      .catch(() => setState("bad"));
    // Runs once, on the token in the address bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resend = async () => {
    if (!email.trim()) return toast.error("Enter the email you signed up with");
    setBusy(true);
    try {
      const { sent } = await resendVerification(email.trim());
      toast.success(
        sent
          ? "A new link is on its way."
          : "If that address needs confirming, a new link is on its way.",
      );
    } catch {
      toast.error("Could not send that just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand px-6 py-16">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6 text-center">
          {state === "checking" && (
            <>
              <Loader2 className="mx-auto size-10 animate-spin text-primary" />
              <p className="text-lg font-bold">Confirming your email…</p>
            </>
          )}

          {state === "done" && (
            <>
              <BadgeCheck className="mx-auto size-12 text-success" />
              <p className="text-lg font-extrabold">Email confirmed</p>
              <p className="text-sm text-muted-foreground">
                {APP.name} is open. You can start setting up your shop.
              </p>
              <Button className="w-full" onClick={() => navigate({ to: "/dashboard" })}>
                Go to my dashboard
              </Button>
            </>
          )}

          {(state === "bad" || state === "missing") && (
            <>
              <CircleAlert className="mx-auto size-12 text-warning-foreground" />
              <p className="text-lg font-extrabold">
                {state === "missing" ? "No link in this address" : "That link has expired"}
              </p>
              <p className="text-sm text-muted-foreground">
                {state === "missing"
                  ? "Open the link from your email, or ask for a new one below."
                  : "Links work once and last seven days. Ask for a fresh one and it will arrive shortly."}
              </p>
              <div className="space-y-2 text-left">
                <Input
                  type="email"
                  inputMode="email"
                  placeholder="The email you signed up with"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Button className="w-full" disabled={busy} onClick={resend}>
                  <MailCheck className="size-4" />
                  {busy ? "Sending…" : "Send me a new link"}
                </Button>
              </div>
              <Link to="/auth" className="block text-xs text-muted-foreground underline">
                Back to sign in
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
