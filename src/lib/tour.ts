import { driver } from "driver.js";
import "driver.js/dist/driver.css";

const SEEN = "pamoja-tour-seen";

const steps = [
  {
    element: "#tour-nav",
    popover: {
      title: "Your workspace",
      description:
        "Switch between the POS terminal, inventory, debtors, expenses and reports from here.",
    },
  },
  {
    element: "#tour-saletype",
    popover: {
      title: "Retail or wholesale",
      description: "Flip the price list instantly. Bulk discounts apply automatically on volume.",
    },
  },
  {
    element: "#tour-cart",
    popover: {
      title: "Cart & checkout",
      description:
        "Pick a saved customer to sell on credit, log empties returned, and choose a payment method.",
    },
  },
  {
    element: "#tour-calculator",
    popover: {
      title: "Utility calculator",
      description: "Do quick maths or percentages, then apply the result straight to the total.",
    },
  },
  {
    element: "#tour-eod",
    popover: {
      title: "End-of-day summary",
      description: "One click gives you cash, credit, debts collected and bottle balances.",
    },
  },
];

export function startTour(force = false) {
  if (typeof window === "undefined") return;
  if (!force && sessionStorage.getItem(SEEN) === "1") return;
  sessionStorage.setItem(SEEN, "1");
  const available = steps.filter((s) => document.querySelector(s.element));
  if (!available.length) return;
  driver({
    showProgress: true,
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Start selling",
    steps: available,
  }).drive();
}
