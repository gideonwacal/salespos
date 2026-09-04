/**
 * Which plan this shop actually needs, and why.
 *
 * The billing page used to list three packages and leave the owner to guess.
 * This works the recommendation out from what the shop is really doing — seats
 * in use, whether they sell on credit, whether they track empties — and from
 * the trade they chose at sign-up, so a wholesaler is told plainly that credit
 * and deposits live on Growth.
 */

import { PLANS, planById, type PlanId } from "@/lib/demo";
import type { IndustryProfile } from "@/lib/industry";

export type PlanAdvice = {
  /** The plan we think they should be on. */
  recommended: PlanId;
  /** True when that is above what they currently pay for. */
  isUpgrade: boolean;
  /** Why, in the shop's own terms. Most compelling reason first. */
  reasons: string[];
};

export type ShopUsage = {
  staffCount: number;
  customerCount: number;
  debtCount: number;
  bottlesOutstanding: number;
  quotationCount: number;
};

const RANK: PlanId[] = ["starter", "growth", "enterprise"];

function higher(a: PlanId, b: PlanId): PlanId {
  return RANK.indexOf(a) >= RANK.indexOf(b) ? a : b;
}

/**
 * Every trade has a plan below which the app stops matching how it works.
 * Wholesale is the clearest case: credit customers and bottle deposits are the
 * job, and both sit on Growth.
 */
function floorForIndustry(industry: IndustryProfile): { plan: PlanId; reason?: string } {
  switch (industry.id) {
    case "wholesale":
      return {
        plan: "growth",
        reason:
          "Wholesale runs on credit customers and bottle deposits — both are Growth features.",
      };
    case "restaurant":
      return {
        plan: "growth",
        reason: "Bar tabs and bottle deposits need the credit and deposit tracking in Growth.",
      };
    case "pharmacy":
      return {
        plan: "growth",
        reason:
          "Batch and expiry control matter most when several people dispense — Growth covers the team.",
      };
    case "hardware":
      return {
        plan: "growth",
        reason: "Trade customers on account and quotations for site work both need Growth.",
      };
    default:
      return { plan: "starter" };
  }
}

export function recommendPlan(
  currentPlan: PlanId,
  industry: IndustryProfile,
  usage: ShopUsage,
): PlanAdvice {
  const reasons: string[] = [];
  const floor = floorForIndustry(industry);
  let target: PlanId = floor.plan;

  // Seats are the hardest constraint: run out and someone cannot sign in.
  const starterSeats = planById("starter").seats;
  const growthSeats = planById("growth").seats;
  if (usage.staffCount > growthSeats) {
    target = higher(target, "enterprise");
    reasons.push(
      `You have ${usage.staffCount} people with logins — past the ${growthSeats} seats on Growth.`,
    );
  } else if (usage.staffCount > starterSeats) {
    target = higher(target, "growth");
    reasons.push(
      `You have ${usage.staffCount} people with logins — Starter only covers ${starterSeats}.`,
    );
  }

  if (usage.debtCount > 0) {
    target = higher(target, "growth");
    reasons.push(
      `You are carrying ${usage.debtCount} credit ${usage.debtCount === 1 ? "account" : "accounts"}, which only Growth keeps track of.`,
    );
  }

  if (usage.bottlesOutstanding > 0) {
    target = higher(target, "growth");
    reasons.push(
      `${usage.bottlesOutstanding} empties are out with customers — deposit tracking is a Growth feature.`,
    );
  }

  if (usage.quotationCount > 0) {
    target = higher(target, "growth");
    reasons.push("You are issuing quotations, which are part of Growth.");
  }

  // Only mention the trade when nothing they have actually done says it louder.
  if (!reasons.length && floor.reason) reasons.push(floor.reason);

  if (target === "enterprise" && reasons.length < 2) {
    reasons.push("Enterprise adds profit & loss reporting and CSV import/export.");
  }

  const isUpgrade = RANK.indexOf(target) > RANK.indexOf(currentPlan);
  if (!isUpgrade && !reasons.length) {
    reasons.push(`${planById(currentPlan).name} covers everything this shop is doing today.`);
  }

  return { recommended: target, isUpgrade, reasons };
}

export { PLANS };
