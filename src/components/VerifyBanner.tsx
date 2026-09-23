/**
 * Why the shop will not open yet, and the one button that fixes it.
 *
 * An owner held for an unconfirmed address would otherwise meet a dashboard of
 * empty tables and errors with nothing saying why. This says why, on every
 * page, and sends the link again without making them find a page to do it on.
 */

import { useState } from "react";
import { toast } from "sonner";
import { MailCheck, MailWarning } from "lucide-react";
import { resendVerification } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export function VerifyBanner() {
  const { needsVerification, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (!needsVerification || !user) return null;

  const resend = async () => {
    setBusy(true);
    try {
      await resendVerification(user.email);
      setSent(true);
      toast.success("A new link is on its way.");
    } catch {
      toast.error("Could not send that just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning-soft px-4 py-2.5 text-sm md:px-6">
      <MailWarning className="size-4 shrink-0 text-warning-foreground" />
      <p className="min-w-[200px] flex-1">
        <span className="font-semibold">Confirm your email to open the shop.</span>{" "}
        <span className="text-muted-foreground">
          We sent a link to {user.email}. Until it is opened, your tills and stock stay closed.
        </span>
      </p>
      <Button size="sm" variant="outline" disabled={busy || sent} onClick={resend}>
        <MailCheck className="size-3.5" />
        {sent ? "Link sent" : busy ? "Sending…" : "Send it again"}
      </Button>
    </div>
  );
}
