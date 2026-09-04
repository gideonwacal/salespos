import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Store, ShieldCheck, ScanBarcode, LineChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { APP } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SalesPos — POS, Inventory & Financial Control" },
      {
        name: "description",
        content:
          "SalesPos gives any wholesale or retail business real-time POS, stock control, credit tracking and profit reporting.",
      },
      { property: "og:title", content: "SalesPos — POS, Inventory & Financial Control" },
      {
        property: "og:description",
        content:
          "SalesPos gives any wholesale or retail business real-time POS, stock control, credit tracking and profit reporting.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, navigate]);

  return (
    <div className="min-h-screen bg-brand text-brand-foreground">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-success text-success-foreground">
            <Store className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold">{APP.name}</h1>
            <p className="text-sm text-brand-foreground/70">{APP.tagline}</p>
          </div>
        </div>

        <h2 className="mt-12 max-w-3xl text-4xl font-extrabold leading-tight md:text-5xl">
          One live ledger for your shop floor and your back office.
        </h2>
        <p className="mt-4 max-w-2xl text-brand-foreground/75">
          Record wholesale and retail sales, log stock arrivals and overheads, and watch
          profit, stock value and reorder alerts update in real time — from any location.
        </p>


        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-success text-success-foreground hover:bg-success/90">
            <Link to="/auth">Sign in to the system</Link>
          </Button>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            { icon: ScanBarcode, title: "Fast POS", body: "Wholesale/retail pricing toggle, cash, MoMo, bank or credit." },
            { icon: LineChart, title: "Live P&L", body: "Revenue minus COGS minus overheads, updated per sale." },
            { icon: ShieldCheck, title: "Role control", body: "Owner sets prices and approves expenses; staff sell and log." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl bg-brand-muted/60 p-5">
              <f.icon className="size-5 text-success" />
              <p className="mt-3 font-semibold">{f.title}</p>
              <p className="mt-1 text-sm text-brand-foreground/70">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
