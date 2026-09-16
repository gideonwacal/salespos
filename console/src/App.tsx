import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Building2,
  CreditCard,
  Gauge,
  LogOut,
  Radar,
  Users as UsersIcon,
} from "lucide-react";
import { fetchMe, isSignedIn, signIn, signOut } from "./api";
import { Link, useLocation } from "./router";
import { Button, Input, Label, cx } from "./ui";
import { Overview } from "./pages/Overview";
import { Businesses } from "./pages/Businesses";
import { Business } from "./pages/Business";
import { Users } from "./pages/Users";
import { Payments } from "./pages/Payments";
import { ActivityPage } from "./pages/Activity";

const NAV = [
  { to: "/", label: "Overview", icon: Gauge },
  { to: "/businesses", label: "Businesses", icon: Building2 },
  { to: "/users", label: "Users", icon: UsersIcon },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/activity", label: "Activity", icon: Activity },
];

export function App() {
  const [signedIn, setSignedIn] = useState(isSignedIn);
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, enabled: signedIn });

  const leave = () => {
    signOut();
    queryClient.clear();
    setSignedIn(false);
  };

  if (!signedIn || me.isError) return <SignIn onDone={() => setSignedIn(true)} />;
  if (!me.data) return <p className="p-10 text-center font-mono text-sm text-dim">verifying…</p>;
  if (!me.data.user.is_superuser) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-sm">
        <p>That account is not the platform owner.</p>
        <Button onClick={leave}>Sign in with another account</Button>
      </div>
    );
  }

  return <Shell email={me.data.user.email} onSignOut={leave} />;
}

function Shell({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const { path, query } = useLocation();
  const businessId = path.match(/^\/businesses\/([0-9a-f-]{36})$/)?.[1];

  let page;
  if (path === "/") page = <Overview />;
  else if (businessId) page = <Business id={businessId} />;
  else if (path === "/businesses") page = <Businesses query={query} />;
  else if (path === "/users") page = <Users query={query} />;
  else if (path === "/payments") page = <Payments query={query} />;
  else if (path === "/activity") page = <ActivityPage query={query} />;
  else page = <p className="text-dim">Nothing here.</p>;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-line bg-ink/80 backdrop-blur md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-5 py-5">
          <Radar className="size-5 text-signal" />
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Control Room</p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-dim">SalesPos</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {NAV.map((item) => {
            const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cx(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-panel-2 text-text shadow-[inset_2px_0_0] shadow-signal"
                    : "text-dim hover:bg-panel hover:text-text",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden px-5 py-5 md:absolute md:bottom-0 md:block md:w-full">
          <p className="truncate font-mono text-[11px] text-dim" title={email}>
            {email}
          </p>
          <Button tone="ghost" size="sm" className="-ml-2.5 mt-1" onClick={onSignOut}>
            <LogOut className="size-3.5" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-4 flex justify-end md:hidden">
          <Button tone="ghost" size="sm" onClick={onSignOut}>
            <LogOut className="size-3.5" /> Sign out
          </Button>
        </div>
        {page}
      </main>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const me = await signIn(email, password);
      queryClient.setQueryData(["me"], me);
      setPassword("");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-line bg-panel/90 p-7 shadow-2xl shadow-black/40 backdrop-blur"
      >
        <Radar className="size-7 text-signal" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Control Room</h1>
        <p className="mt-1 text-sm text-dim">Restricted. Platform owner only.</p>
        <div className="mt-6 space-y-4">
          <label className="block">
            <Label>Email</Label>
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="block">
            <Label>Password</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <Button tone="signal" type="submit" className="w-full" disabled={busy}>
            {busy ? "Verifying…" : "Enter"}
          </Button>
        </div>
      </form>
    </div>
  );
}
