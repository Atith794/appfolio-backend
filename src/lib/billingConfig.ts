export type Billing = "MONTHLY" | "YEARLY";
export type BillingCurrency = "INR" | "USD" | "GBP" | "EUR";
export type BillingProvider = "razorpay" | "stripe";
export type BillingRegion = "IN" | "UK" | "GBP" | "US";

export type RazorpayBillingConfig = {
  region: "IN" | "UK" | "GBP" | "US";
  currency: "INR" | "GBP" | "EUR" | "USD";
  provider: "razorpay";
  prices: Record<Billing, number>;
  razorpayPlanIds: Record<Billing, string>;
};

export type BillingConfig = RazorpayBillingConfig ;

export const REGION_COUNTRY_MAP: Record<string, BillingRegion> = {
  IN: "IN",
  GB: "UK",
  DE: "GBP",
  FR: "GBP",
  ES: "GBP",
  IT: "GBP",
  NL: "GBP",
  BE: "GBP",
  IE: "GBP",
  PT: "GBP",
  AT: "GBP",
  FI: "GBP",
  SE: "GBP",
  DK: "GBP",
};

export const BILLING_CATALOG: Record<BillingRegion, BillingConfig> = {
  IN: {
    region: "IN",
    currency: "INR",
    provider: "razorpay",
    prices: {
      MONTHLY: 499,
      YEARLY: 1999,
    },
    razorpayPlanIds: {
      MONTHLY: process.env.RAZORPAY_PLAN_ID_MONTHLY!,
      YEARLY: process.env.RAZORPAY_PLAN_ID_YEARLY!,
    },
  },
  // UK: {
  //   region: "UK",
  //   currency: "GBP",
  //   provider: "stripe",
  //   prices: {
  //     MONTHLY: 12,
  //     YEARLY: 48,
  //   },
  //   stripePriceIds: {
  //     MONTHLY: process.env.STRIPE_PRICE_GBP_MONTHLY!,
  //     YEARLY: process.env.STRIPE_PRICE_GBP_YEARLY!,
  //   },
  // },
  // EU: {
  //   region: "EU",
  //   currency: "EUR",
  //   provider: "stripe",
  //   prices: {
  //     MONTHLY: 14,
  //     YEARLY: 56,
  //   },
  //   stripePriceIds: {
  //     MONTHLY: process.env.STRIPE_PRICE_EUR_MONTHLY!,
  //     YEARLY: process.env.STRIPE_PRICE_EUR_YEARLY!,
  //   },
  // },
  // ROW: {
  //   region: "ROW",
  //   currency: "USD",
  //   provider: "stripe",
  //   prices: {
  //     MONTHLY: 15,
  //     YEARLY: 60,
  //   },
  //   stripePriceIds: {
  //     MONTHLY: process.env.STRIPE_PRICE_USD_MONTHLY!,
  //     YEARLY: process.env.STRIPE_PRICE_USD_YEARLY!,
  //   },
  // },
  UK: {
    region: "UK",
    currency: "GBP",
    provider: "razorpay",
    prices: {
      MONTHLY: 12,
      YEARLY: 48,
    },
    razorpayPlanIds: {
      MONTHLY: process.env.RAZORPAY_PLAN_ID_MONTHLY!,
      YEARLY: process.env.RAZORPAY_PLAN_ID_YEARLY!,
    },
  },
  GBP: {
    region: "GBP",
    currency: "EUR",
    provider: "razorpay",
    prices: {
      MONTHLY: 14,
      YEARLY: 56,
    },
    razorpayPlanIds: {
      MONTHLY: process.env.RAZORPAY_PLAN_ID_MONTHLY!,
      YEARLY: process.env.RAZORPAY_PLAN_ID_YEARLY!,
    },
  },
  US: {
    region: "US",
    currency: "USD",
    provider: "razorpay",
    prices: {
      MONTHLY: 15,
      YEARLY: 60,
    },
    razorpayPlanIds: {
      MONTHLY: process.env.RAZORPAY_PLAN_ID_MONTHLY!,
      YEARLY: process.env.RAZORPAY_PLAN_ID_YEARLY!,
    },
  }
};