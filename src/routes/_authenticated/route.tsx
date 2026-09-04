import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  isDemo,
  getSessionUser,
  getBusiness,
  planHasModule,
  trialStatus,
  type ModuleId,
} from "@/lib/demo";
import { AppShell } from "@/components/AppShell";

const ROUTE_MODULES: [string, ModuleId][] = [
  ["/pos", "pos"],
  ["/inventory", "inventory"],
  ["/quotations", "quotations"],
  ["/debtors", "debtors"],
  ["/expenses", "expenses"],
  ["/reports", "reports"],
  ["/staff", "staff"],
];

const ALWAYS_ALLOWED = ["/billing", "/settings", "/setup"];

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
    const open = ALWAYS_ALLOWED.some((p) => location.pathname.startsWith(p));
    if (!open && trialStatus(business).locked) {
      throw redirect({ to: "/billing" });
    }
    const hit = ROUTE_MODULES.find(([p]) => location.pathname.startsWith(p));
    if (hit && !planHasModule(business.plan, hit[1])) {
      throw redirect({ to: "/billing" });
    }
  },

  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
