import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  isDemo,
  getSessionUser,
  getBusiness,
  canUseModule,
  trialStatus,
  billingOff,
  type ModuleId,
} from "@/lib/demo";
import { AppShell } from "@/components/AppShell";

const ROUTE_MODULES: [string, ModuleId][] = [
  ["/pos", "pos"],
  ["/inventory", "inventory"],
  ["/stocktake", "inventory"],
  ["/expiry", "inventory"],
  ["/fitment", "inventory"],
  ["/patients", "inventory"],
  ["/visits", "inventory"],
  ["/sections", "reports"],
  ["/quotations", "quotations"],
  ["/debtors", "debtors"],
  ["/expenses", "expenses"],
  ["/reports", "reports"],
  ["/staff", "staff"],
];

// Reachable even when the shop is locked out of everything else. /referrals
// has to be here: it is the one page that can lift the lock without paying,
// and redirecting it to /billing would hide the alternative from exactly the
// people who need it.
const ALWAYS_ALLOWED = ["/billing", "/referrals", "/settings", "/setup"];

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (isDemo()) return;
    const user = getSessionUser();
    if (!user) throw redirect({ to: "/auth" });
    const business = getBusiness();
    if (!business.configured && !location.pathname.startsWith("/setup")) {
      throw redirect({ to: "/setup" });
    }
    // While the product is free there is no billing page to land on, so a
    // bookmark or an old link goes to the dashboard rather than a dead screen.
    if (billingOff(business) && location.pathname.startsWith("/billing")) {
      throw redirect({ to: "/dashboard" });
    }
    const open = ALWAYS_ALLOWED.some((p) => location.pathname.startsWith(p));
    if (!open && trialStatus(business).locked) {
      throw redirect({ to: "/billing" });
    }
    const hit = ROUTE_MODULES.find(([p]) => location.pathname.startsWith(p));
    if (hit && !canUseModule(business, hit[1])) {
      throw redirect({ to: "/billing" });
    }
  },

  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
