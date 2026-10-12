/**
 * Which part fits that car.
 *
 * The expensive mistake in a spare parts shop is selling the wrong part: it
 * comes back, the customer is cross, and the shelf is short until it does. The
 * counter already asks "what car?" before anything else, so this page asks it
 * in the same order — make, then model, then year — and answers with what is
 * on the shelf, at what price, on which rack.
 *
 * The pickers are built from the shop's own fitments rather than a list of
 * every car ever sold, so they only ever offer something that returns parts.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Car, MapPin, PackageSearch, Search } from "lucide-react";
import { useProducts, useVehicleFits, type Product, type VehicleFit } from "@/lib/data";
import { useIndustry } from "@/hooks/useIndustry";
import { ugx, num } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** A part that fits the chosen vehicle, with every fitment that said so. */
type Match = { product: Product; fits: VehicleFit[] };

export const Route = createFileRoute("/_authenticated/fitment")({
  head: () => ({
    meta: [
      { title: "Find parts by vehicle — SalesPos" },
      {
        name: "description",
        content:
          "Pick a make, model and year and see every part in stock that fits it, with price and shelf location.",
      },
    ],
  }),
  component: Fitment,
});

function Fitment() {
  const industry = useIndustry();
  const { data: products = [] } = useProducts();
  const { data: fits = [] } = useVehicleFits();

  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [query, setQuery] = useState("");

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  /** Makes this shop actually stocks for, and the models under each. */
  const catalogue = useMemo(() => {
    const byMake = new Map<string, Set<string>>();
    for (const fit of fits) {
      if (!fit.make) continue;
      const models = byMake.get(fit.make) ?? new Set<string>();
      if (fit.model) models.add(fit.model);
      byMake.set(fit.make, models);
    }
    return [...byMake.entries()]
      .map(([m, models]) => ({ make: m, models: [...models].sort() }))
      .sort((a, b) => a.make.localeCompare(b.make));
  }, [fits]);

  const models = catalogue.find((c) => c.make === make)?.models ?? [];

  const matches = useMemo(() => {
    if (!make) return [];
    const wantedYear = /^\d{4}$/.test(year) ? Number(year) : null;
    const q = query.trim().toLowerCase();

    // Written as a loop rather than a chain of filters: every step drops a
    // candidate for its own reason, and a product that is gone has to be
    // dropped before the rest of the conditions can look at it.
    const byProduct = new Map<string, Match>();

    for (const fit of fits) {
      if (fit.make !== make) continue;
      if (model && fit.model !== model) continue;

      if (wantedYear !== null) {
        // An open end means open: a part listed from 2002 with no end date
        // fits everything since, which is how catalogues are written.
        if (fit.year_from && wantedYear < fit.year_from) continue;
        if (fit.year_to && wantedYear > fit.year_to) continue;
      }

      const product = productById.get(fit.product_id);
      if (!product) continue;

      if (
        q &&
        !product.name.toLowerCase().includes(q) &&
        !(product.part_number ?? "").toLowerCase().includes(q) &&
        !(product.brand ?? "").toLowerCase().includes(q)
      ) {
        continue;
      }

      // One part can match twice — listed for the saloon and the estate — and
      // the counter wants the part once, with every reason it matched.
      const entry = byProduct.get(product.id) ?? { product, fits: [] };
      entry.fits.push(fit);
      byProduct.set(product.id, entry);
    }

    return [...byProduct.values()].sort((a, b) => {
      // In stock first: a part that is here is the answer, whatever else fits.
      const stocked = Number(b.product.stock_quantity > 0) - Number(a.product.stock_quantity > 0);
      return stocked || a.product.category.localeCompare(b.product.category);
    });
  }, [fits, make, model, year, query, productById]);

  const inStock = matches.filter((m) => Number(m.product.stock_quantity) > 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Find parts by vehicle</h1>
        <p className="text-sm text-muted-foreground">
          Ask the customer what they drive, pick it here, and sell the part that actually fits.
        </p>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Car className="size-4" /> What are they driving?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Make
            </p>
            {catalogue.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No fitments recorded yet. Add which vehicles a part fits from the{" "}
                {industry.terms.inventory.toLowerCase()}, and they appear here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {catalogue.map((c) => (
                  <Button
                    key={c.make}
                    size="sm"
                    variant={make === c.make ? "default" : "outline"}
                    onClick={() => {
                      setMake(make === c.make ? "" : c.make);
                      setModel("");
                    }}
                  >
                    {c.make}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {make && models.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Model
              </p>
              <div className="flex flex-wrap gap-1.5">
                {models.map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={model === m ? "default" : "outline"}
                    onClick={() => setModel(model === m ? "" : m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {make && (
            <div className="flex flex-wrap gap-3">
              <div className="w-[130px]">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Year
                </p>
                <Input
                  inputMode="numeric"
                  placeholder="e.g. 2008"
                  maxLength={4}
                  value={year}
                  onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="relative min-w-[200px] flex-1">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Narrow it down
                </p>
                <Search className="absolute left-3 top-[34px] size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Part name, part number or brand"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {make && (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <PackageSearch className="size-4" />
              {num(matches.length)} part{matches.length === 1 ? "" : "s"} fit {make}
              {model ? ` ${model}` : ""}
              {year ? ` (${year})` : ""}
              {matches.length > 0 && (
                <Badge
                  className={cn(
                    "border-0",
                    inStock.length
                      ? "bg-success text-success-foreground"
                      : "bg-destructive text-destructive-foreground",
                  )}
                >
                  {num(inStock.length)} in stock
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead>Fits</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.map(({ product, fits: reasons }) => {
                  const out = Number(product.stock_quantity) <= 0;
                  return (
                    <TableRow key={product.id} className={cn(out && "opacity-60")}>
                      <TableCell>
                        <p className="font-medium">{product.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {[product.brand, product.part_number, product.category]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <div className="flex flex-wrap gap-1">
                          {reasons.slice(0, 3).map((f) => (
                            <Badge key={f.id} variant="outline" className="text-[10px]">
                              {[
                                f.model,
                                f.year_from || f.year_to
                                  ? `${f.year_from ?? ""}–${f.year_to ?? "on"}`
                                  : "",
                                f.engine,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            </Badge>
                          ))}
                          {reasons.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{reasons.length - 3}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {product.shelf_location ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3" /> {product.shelf_location}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right font-semibold",
                          out && "text-destructive",
                        )}
                      >
                        {out ? "Out" : num(product.stock_quantity)}
                      </TableCell>
                      <TableCell className="tabular text-right font-semibold">
                        {ugx(product.unit_selling_price)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {matches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Nothing on file fits that one. Try without the year, or check the part
                      number with the customer.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
