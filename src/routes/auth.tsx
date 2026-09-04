import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Store, PlayCircle } from "lucide-react";
import { startDemo, getBusiness } from "@/lib/demo";
import { signIn as authSignIn, signUp as authSignUp } from "@/lib/auth";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDUSTRY_PROFILES } from "@/lib/industry";
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
  const [signIn, setSignIn] = useState({ email: "", password: "" });
  const [signUp, setSignUp] = useState({
    business: "",
    industry: "wholesale",
    full_name: "",
    email: "",
    phone: "",
    password: "",
  });

  const afterAuth = () => {
    refresh();
    navigate({ to: getBusiness().configured ? "/dashboard" : "/setup", replace: true });
  };

  const doSignIn = async () => {
    setBusy(true);
    try {
      await authSignIn(signIn.email.trim(), signIn.password);
      toast.success("Welcome back");
      afterAuth();
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
      await authSignUp({
        businessName: signUp.business.trim(),
        fullName: signUp.full_name.trim() || signUp.email.split("@")[0],
        email: signUp.email.trim(),
        phone: signUp.phone.trim(),
        password: signUp.password,
        industry: signUp.industry,
      });

      toast.success("Workspace created — let's set up your business");
      refresh();
      navigate({ to: "/setup", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  };

  const demo = () => {
    startDemo();
    window.location.href = "/pos";
  };

  return (
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
              Run the shop floor and the back office from one screen.
            </h2>
            <ul className="space-y-2 text-sm text-sidebar-foreground/85">
              <li>• Fast retail & wholesale checkout with tiered pricing</li>
              <li>• Credit, debtor and bottle-deposit tracking</li>
              <li>• Live stock, expiry and low-stock alerts</li>
              <li>• End-of-day reconciliation and P&L reports</li>
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
                  <Input
                    id="si-pass"
                    type="password"
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
                      {INDUSTRY_PROFILES.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {INDUSTRY_PROFILES.find((p) => p.id === signUp.industry)?.blurb}
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
                  <Input
                    id="su-pass"
                    type="password"
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
              <Button variant="outline" className="w-full" onClick={demo}>
                <PlayCircle className="size-4" /> Try demo mode
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Loaded with sample stock, sales and debtors. Nothing is saved.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
