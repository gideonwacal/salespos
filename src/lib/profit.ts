/**
 * Gross profit, commodity by commodity.
 *
 * The shop asks the same question in two tenses, and they must never be added
 * together:
 *
 *   - earned — what a product has actually sold for, less what those units
 *     cost to buy. This is the gross profit in the profit & loss statement,
 *     split per item.
 *   - in stock — what the units still on the shelf would make if they sold at
 *     the list price, less what they cost to buy. Nothing has been earned yet;
 *     it is the profit the store is holding.
 *
 * Both are revenue less buying price. Only the revenue differs: money taken,
 * against money the stock is priced at.
 */

import { saleLinesBySale } from "@/lib/db";
import type { Product, Sale } from "@/lib/data";

export type CommodityProfit = {
  productId: string;
  name: string;
  category: string;
  /** The product row, when the item still exists on the system. */
  product: Product | null;

  /* What has sold. */
  soldQty: number;
  revenue: number;
  /** What the units sold cost to buy. */
  buyingPrice: number;
  earned: number;

  /* What is still on the shelf. */
  onHand: number;
  stockRetail: number;
  stockCost: number;
  stockProfit: number;
};

export type CommodityProfitReport = {
  rows: CommodityProfit[];
  earned: number;
  revenue: number;
  buyingPrice: number;
  stockProfit: number;
  stockRetail: number;
  stockCost: number;
  /**
   * Gross profit on the sales that carry no line items, so it cannot be put
   * against a commodity. Adding this to `earned` gives the figure on the
   * statement; showing it is what stops the table quietly under-reporting.
   */
  unattributed: number;
};

/**
 * Every commodity that is in stock or has sold, with both profits against it.
 *
 * `sales` is whatever window the caller cares about — a period, a month, or the
 * whole book. Stock figures are always the position now: a shelf has no history.
 */
export function profitByCommodity(products: Product[], sales: Sale[]): CommodityProfitReport {
  const byId = new Map<string, CommodityProfit>();

  const blank = (productId: string, name: string, product: Product | null): CommodityProfit => ({
    productId,
    name,
    category: product?.category ?? "—",
    product,
    soldQty: 0,
    revenue: 0,
    buyingPrice: 0,
    earned: 0,
    onHand: 0,
    stockRetail: 0,
    stockCost: 0,
    stockProfit: 0,
  });

  for (const p of products) {
    const row = blank(p.id, p.name, p);
    const onHand = Number(p.stock_quantity);
    row.onHand = onHand;
    row.stockRetail = onHand * Number(p.unit_selling_price);
    row.stockCost = onHand * Number(p.unit_buying_price);
    row.stockProfit = row.stockRetail - row.stockCost;
    byId.set(p.id, row);
  }

  const lines = saleLinesBySale(sales);
  let attributedCost = 0;
  let attributedRevenue = 0;

  for (const sale of sales) {
    for (const line of lines.get(sale.id) ?? []) {
      // A line can outlive the product it sold — the item was deleted, or the
      // list is stale. The sale still made money, so it keeps its own name.
      const row =
        byId.get(line.product_id) ??
        blank(line.product_id || line.product_name, line.product_name || "Removed item", null);
      const qty = Number(line.quantity);
      const revenue = qty * Number(line.unit_price);
      const cost = qty * Number(line.unit_cost);
      row.soldQty += qty;
      row.revenue += revenue;
      row.buyingPrice += cost;
      row.earned = row.revenue - row.buyingPrice;
      byId.set(row.productId, row);
      attributedRevenue += revenue;
      attributedCost += cost;
    }
  }

  const rows = [...byId.values()];
  const totalRevenue = sales.reduce((a, s) => a + Number(s.total_amount), 0);
  const totalCost = sales.reduce((a, s) => a + Number(s.total_cost), 0);

  return {
    rows,
    revenue: attributedRevenue,
    buyingPrice: attributedCost,
    earned: attributedRevenue - attributedCost,
    stockRetail: rows.reduce((a, r) => a + r.stockRetail, 0),
    stockCost: rows.reduce((a, r) => a + r.stockCost, 0),
    stockProfit: rows.reduce((a, r) => a + r.stockProfit, 0),
    unattributed: totalRevenue - totalCost - (attributedRevenue - attributedCost),
  };
}
