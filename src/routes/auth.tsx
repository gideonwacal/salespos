import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { MessageCircle, Store, PlayCircle } from "lucide-react";
import { startDemo, getBusiness } from "@/lib/demo";
import { DEMO_TRADES } from "@/lib/demoTrades";
import { signIn as authSignIn, signUp as authSignUp } from "@/lib/auth";
import type { MeResponse } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { APP } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDUSTRY_GROUPS, resolveIndustry } from "@/lib/industry";
import { clearReferral, takeReferral } from "@/routes/r.$code";
import { PasswordInput } from "@/components/PasswordInput";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WhatsAppLink } from "@/lib/auth";
import heroImage from "@/assets/market-hero.jpg";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — SalesPos" },
      {
        name: "description",
        content:
          "Sign in to your SalesPos workspace or create a new business account in under a minute.",
      },
      { property: "og:title", content: "Sign in — SalesPos" },
      {
        property: "og:description",
        content: "Sign in to your SalesPos workspace or create a new business account.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  // Held after sign-up so the owner is offered the WhatsApp tap while
  // they are still here, rather than in a toast that disappears.
  const [activate, setActivate] = useState<WhatsAppLink | null>(null);
  const [signIn, setSignIn] = useState({ email: "", password: "" });
  const [signUp, setSignUp] = useState({
    business: "",
    industry: "wholesale",
    full_name: "",
    email: "",
    phone: "",
    whatsapp: "",
    password: "",
  });

  const afterAuth = (me?: MeResponse) => {
    // The server has just answered; asking it the same question again is a
    // whole round trip nobody is waiting for on purpose.
    refresh(me);
    navigate({ to: getBusiness().configured ? "/dashboard" : "/setup", replace: true });
  };

  const doSignIn = async () => {
    setBusy(true);
    try {
      const { user, me } = await authSignIn(signIn.email.trim(), signIn.password);
      toast.success("Welcome back");
      // The platform owner has no shop of their own, so there is no dashboard
      // to land on — they are asked which of the two jobs this is.
      if (user.platform) {
        refresh(me);
        navigate({ to: "/platform", replace: true });
        return;
      }
      afterAuth(me);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  const doSignUp = async () => {
    if (!signUp.business.trim()) return toast.error("Business name is required");
    // Django's password validators reject anything under 8 characters.
    if (signUp.password.length < 8)
      return toast.error("Use at least 8 characters for the password");
    setBusy(true);
    try {
      const created = await authSignUp({
        businessName: signUp.business.trim(),
        fullName: signUp.full_name.trim() || signUp.email.split("@")[0],
        email: signUp.email.trim(),
        phone: signUp.phone.trim(),
        whatsappNumber: signUp.whatsapp.trim(),
        password: signUp.password,
        industry: signUp.industry,
        // Set by /r/<code> if they arrived through somebody's invite link.
        referralCode: takeReferral(),
      });
      // Spent, win or lose. Leaving it behind would credit a second business
      // to the same link if they signed up twice from one browser.
      clearReferral();

      toast.success("Workspace created — let's set up your business");
      refresh();

      // One tap from here starts the conversation from their own handset,
      // which is what Meta needs before the assistant may write to them at
      // all. Held in front of them rather than announced in a toast.
      if (created.whatsapp?.activation_link) {
        setActivate(created.whatsapp);
        return;
      }
      if (created.whatsapp && !created.whatsapp.welcome_sent) {
        toast.success(
          `Send ${created.whatsapp.pairing_code} to the SalesPos WhatsApp number to link it`,
          { duration: 12000 },
        );
      }
      navigate({ to: "/setup", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  };

  // Which trade the visitor wants to see. A wholesaler's crates tell a
  // pharmacist nothing, and the first thing anybody does with a demo is look
  // for their own stock on the shelf.
  const [tradeOpen, setTradeOpen] = useState(false);

  const demo = (trade: string) => {
    startDemo(trade);
    window.location.href = "/pos";
  };

  /** Sent on, with or without the WhatsApp step done. */
  const onwards = () => {
    setActivate(null);
    navigate({ to: "/setup", replace: true });
  };

  return (
    <>
    {activate && (
      <Dialog open onOpenChange={(open) => !open && onwards()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="size-5 text-success" />
              Turn on your WhatsApp assistant
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Tap below and WhatsApp opens with a short message already typed.
            Send it, and you can ask about your shop any time — "How much did I
            sell today?", "Who owes me money?"
          </p>

          <Button asChild className="w-full bg-success hover:bg-success/90">
            {/* A plain link, not a fetch: the point is that the message is
                sent by them, from their own handset. That is what opens
                Meta's 24-hour window and proves the number is theirs. */}
            <a href={activate.activation_link} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 size-4" />
              Open WhatsApp
            </a>
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Or send{" "}
            <span className="font-mono font-semibold">{activate.pairing_code}</span>{" "}
            to our WhatsApp number yourself.
          </p>

          <Button variant="ghost" onClick={onwards} className="w-full">
            I'll do this later
          </Button>
        </DialogContent>
      </Dialog>
    )}
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative flex min-h-[320px] flex-col justify-between overflow-hidden bg-sidebar p-8 text-sidebar-foreground lg:min-h-screen lg:p-10">
        <img
          src={heroImage}
          alt="Wholesale shop with sacks of grains, beans and lentils ready for sale"
          className="absolute inset-0 size-full object-cover"
          width={1408}
          height={1600}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-sidebar/70 via-sidebar/40 to-sidebar/80" />
        <div className="relative z-10 flex flex-col justify-between gap-10 h-full">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
              <Store className="size-5" />
            </span>
            <span className="text-lg font-extrabold text-sidebar-accent-foreground">
              {APP.name}
            </span>
          </Link>
          <div className="space-y-4 rounded-2xl border border-white/15 bg-sidebar/40 p-6 backdrop-blur-md">
            <h2 className="max-w-md text-3xl font-extrabold leading-tight text-sidebar-accent-foreground">
              Run the business and the back office from one screen.
            </h2>
            {/* Every line has to be true of a pharmacy, a hardware store and a
                clinic as much as a wholesaler — the trade is chosen at sign-up,
                and the page before it should not assume one. */}
            <ul className="space-y-2 text-sm text-sidebar-foreground/85">
              <li>• Fast counter sales with retail, wholesale and trade pricing</li>
              <li>• Credit customers, debtors and what each one still owes</li>
              <li>• Live stock with batch, expiry and reorder alerts</li>
              <li>• End-of-day reconciliation and profit reports</li>
            </ul>
          </div>
          <p className="text-xs text-sidebar-foreground/60">{APP.tagline}</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-xl">Welcome to {APP.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create business</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="space-y-3 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="si-email">Email</Label>
                  <Input
                    id="si-email"
                    type="email"
                    value={signIn.email}
                    onChange={(e) => setSignIn({ ...signIn, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="si-pass">Password</Label>
                  <PasswordInput
                    id="si-pass"
                    value={signIn.password}
                    onChange={(e) => setSignIn({ ...signIn, password: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && doSignIn()}
                  />
                </div>
                <Button className="w-full" disabled={busy} onClick={doSignIn}>
                  Sign in
                </Button>
              </TabsContent>

              <TabsContent value="signup" className="space-y-3 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="su-biz">Business name</Label>
                  <Input
                    id="su-biz"
                    value={signUp.business}
                    onChange={(e) => setSignUp({ ...signUp, business: e.target.value })}
                    placeholder="e.g. Northline Traders"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-industry">What kind of business is it?</Label>
                  <Select
                    value={signUp.industry}
                    onValueChange={(v) => setSignUp({ ...signUp, industry: v })}
                  >
                    <SelectTrigger id="su-industry">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRY_GROUPS.map((group) => (
                        <SelectGroup key={group.family}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {group.profiles.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {resolveIndustry(signUp.industry).blurb}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="su-name">Your name</Label>
                    <Input
                      id="su-name"
                      value={signUp.full_name}
                      onChange={(e) => setSignUp({ ...signUp, full_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-phone">Phone</Label>
                    <Input
                      id="su-phone"
                      value={signUp.phone}
                      onChange={(e) => setSignUp({ ...signUp, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-whatsapp">
                    WhatsApp business number{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="su-whatsapp"
                    inputMode="tel"
                    placeholder="0772 000 111"
                    value={signUp.whatsapp}
                    onChange={(e) => setSignUp({ ...signUp, whatsapp: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    We'll send a welcome message here so you can ask your assistant
                    things like "How much did I sell today?" straight from WhatsApp.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-email">Email</Label>
                  <Input
                    id="su-email"
                    type="email"
                    value={signUp.email}
                    onChange={(e) => setSignUp({ ...signUp, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-pass">Password</Label>
                  <PasswordInput
                    id="su-pass"
                    value={signUp.password}
                    onChange={(e) => setSignUp({ ...signUp, password: e.target.value })}
                  />
                </div>
                <Button className="w-full" disabled={busy} onClick={doSignUp}>
                  Create my workspace
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Starts a 14-day trial on the Growth plan. No card needed.
                </p>
              </TabsContent>
            </Tabs>

            <div className="mt-5 border-t border-border pt-4">
              {!tradeOpen ? (
                <>
                  <Button variant="outline" className="w-full" onClick={() => setTradeOpen(true)}>
                    <PlayCircle className="size-4" /> Try demo mode
                  </Button>
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Loaded with sample stock, sales and debtors. Nothing is saved.
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-center text-sm font-semibold">Which business do you run?</p>
                  <div className="grid gap-1.5">
                    {DEMO_TRADES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => demo(t.id)}
                        className="rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary"
                      >
                        <span className="block text-sm font-semibold">{t.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{t.blurb}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTradeOpen(false)}
                    className="w-full text-center text-xs text-muted-foreground underline"
                  >
                    Never mind
                  </button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  );
}
