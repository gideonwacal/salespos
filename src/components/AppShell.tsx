import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  ScanBarcode,
  Receipt,
  LineChart,
  Users,
  LogOut,
  Store,
  MapPin,
  HandCoins,
  ClipboardList,
  PlayCircle,
  Settings,
  CreditCard,
  FileText,
  FileSpreadsheet,
} from "lucide-react";
import { isDemo, stopDemo, subscribeStore, planById, planHasModule, type ModuleId } from "@/lib/demo";
import { startTour } from "@/lib/tour";
import { EodSummaryDialog } from "@/components/EodSummary";
import { useDebts, debtStatus, outstanding } from "@/lib/data";
import { useAuth } from "@/hooks/useAuth";
import { useBusiness } from "@/hooks/useBusiness";
import { useIndustry } from "@/hooks/useIndustry";
import { APP, money } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  owner: boolean;
  manager: boolean;
  module?: ModuleId;
}[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, owner: true, manager: false },
  { to: "/pos", label: "POS Terminal", icon: ScanBarcode, owner: false, manager: true, module: "pos" },
  { to: "/inventory", label: "Inventory", icon: Package, owner: false, manager: true, module: "inventory" },
  { to: "/quotations", label: "Quotations", icon: FileText, owner: true, manager: true, module: "quotations" },
  { to: "/debtors", label: "Credit & Debtors", icon: HandCoins, owner: true, manager: true, module: "debtors" },
  { to: "/expenses", label: "Expenses", icon: Receipt, owner: false, manager: true, module: "expenses" },
  { to: "/reports", label: "Financial Reports", icon: LineChart, owner: true, manager: false, module: "reports" },
  { to: "/staff", label: "Users & Roles", icon: Users, owner: true, manager: false, module: "staff" },
  { to: "/billing", label: "Plan & Billing", icon: CreditCard, owner: true, manager: false },
  { to: "/data", label: "Import & Export", icon: FileSpreadsheet, owner: true, manager: true },
  { to: "/settings", label: "Business Settings", icon: Settings, owner: true, manager: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { isOwner, role, fullName, user, demo, signOut: localSignOut } = useAuth();
  const business = useBusiness();
  const { data: debts = [] } = useDebts();
  const overdueTotal = debts
    .filter((d) => debtStatus(d) === "overdue")
    .reduce((a, d) => a + outstanding(d), 0);
  const overdueCount = debts.filter((d) => debtStatus(d) === "overdue").length;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Local store changes are the "realtime" channel until a backend is wired in.
  useEffect(() => {
    const unsub = subscribeStore(() => queryClient.invalidateQueries());
    return () => {
      unsub();
    };
  }, [queryClient]);

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    if (isDemo()) {
      stopDemo();
      window.location.href = "/auth";
      return;
    }
    localSignOut();
    navigate({ to: "/auth", replace: true });
  };

  const industry = useIndustry();
  const inPlan = (m?: ModuleId) => !m || planHasModule(business.plan, m);
  const items = (demo ? NAV : NAV.filter((n) => (isOwner ? n.owner : n.manager)))
    .filter((n) => inPlan(n.module))
    // A pharmacy calls it the Dispensary, a hardware store just Stock.
    .map((n) => (n.to === "/inventory" ? { ...n, label: industry.terms.inventory } : n));

  useEffect(() => {
    if (demo) setTimeout(() => startTour(), 700);
  }, [demo]);

  useEffect(() => {
    if (demo || !role || !items.length) return;
    const allowed = items.some((n) => pathname.startsWith(n.to)) || pathname.startsWith("/setup");
    if (!allowed) navigate({ to: items[0].to, replace: true });
  }, [pathname, isOwner, role]);

  const location = [business.city, business.country].filter(Boolean).join(", ");

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            {business.logo_url ? (
              <img src={business.logo_url} alt={`${business.name} logo`} className="size-full object-cover" />
            ) : (
              <Store className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-sidebar-accent-foreground">
              {business.name || APP.name}
            </p>
            <p className="truncate text-[11px] text-sidebar-foreground/70">
              {business.tagline || APP.tagline}
            </p>
          </div>
        </div>

        <nav id="tour-nav" className="flex-1 space-y-1 p-3">
          {items.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="size-4" />
                <span className="flex-1">{item.label}</span>
                {item.to === "/debtors" && overdueCount > 0 && (
                  <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                    {overdueCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-sidebar-border p-4 text-[11px] leading-relaxed text-sidebar-foreground/60">
          <p className="font-semibold text-sidebar-foreground/80">
            {planById(business.plan).name} plan · powered by {APP.name}
          </p>
          {(business.address || location) && (
            <p>
              <MapPin className="mb-0.5 mr-1 inline size-3" />
              {[business.address, location].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-border bg-brand text-brand-foreground">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-6">
            <div className="md:hidden">
              <p className="text-sm font-bold">{business.name || APP.name}</p>
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-semibold">
                {isOwner ? "Owner console" : "Sales terminal"}
              </p>
              <p className="text-[11px] text-brand-foreground/70">
                {business.name || APP.name}
                {location ? ` — ${location}` : ""}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <EodSummaryDialog />
              {demo && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => startTour(true)}
                  className="hidden text-brand-foreground hover:bg-brand-muted hover:text-brand-foreground sm:inline-flex"
                >
                  <PlayCircle className="size-4" /> Tour
                </Button>
              )}
              <Badge
                className={cn(
                  "border-0 font-semibold",
                  isOwner
                    ? "bg-success text-success-foreground"
                    : "bg-warning text-warning-foreground",
                )}
              >
                {demo ? "Demo mode" : isOwner ? "Owner / Admin" : "Sales staff"}
              </Badge>
              <div className="hidden text-right sm:block">
                <p className="text-xs font-semibold">{fullName || user?.email}</p>
                <p className="text-[11px] text-brand-foreground/60">{user?.email}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={signOut}
                className="text-brand-foreground hover:bg-brand-muted hover:text-brand-foreground"
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:hidden">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium",
                  pathname.startsWith(item.to)
                    ? "bg-brand-muted text-brand-foreground"
                    : "text-brand-foreground/70",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        {overdueTotal > 0 && (
          <div className="no-print flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive md:px-6">
            <ClipboardList className="size-3.5" />
            {overdueCount} overdue debtor account(s) — {money(overdueTotal)} past due.
          </div>
        )}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
