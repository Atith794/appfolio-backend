export type Billing = "MONTHLY" | "YEARLY";
export type BillingCurrency = "INR" | "USD" | "GBP" | "EUR";
export type BillingProvider = "razorpay" | "stripe";
export type BillingRegion = "IN" | "UK" | "EU" | "ROW";

export type RazorpayBillingConfig = {
  region: "IN";
  currency: "INR";
  provider: "razorpay";
  prices: Record<Billing, number>;
  razorpayPlanIds: Record<Billing, string>;
};

export type StripeBillingConfig = {
  region: "UK" | "EU" | "ROW";
  currency: "GBP" | "EUR" | "USD";
  provider: "stripe";
  prices: Record<Billing, number>;
  stripePriceIds: Record<Billing, string>;
};

export type BillingConfig = RazorpayBillingConfig | StripeBillingConfig;

export const REGION_COUNTRY_MAP: Record<string, BillingRegion> = {
  IN: "IN",
  GB: "UK",
  DE: "EU",
  FR: "EU",
  ES: "EU",
  IT: "EU",
  NL: "EU",
  BE: "EU",
  IE: "EU",
  PT: "EU",
  AT: "EU",
  FI: "EU",
  SE: "EU",
  DK: "EU",
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
  UK: {
    region: "UK",
    currency: "GBP",
    provider: "stripe",
    prices: {
      MONTHLY: 12,
      YEARLY: 48,
    },
    stripePriceIds: {
      MONTHLY: process.env.STRIPE_PRICE_GBP_MONTHLY!,
      YEARLY: process.env.STRIPE_PRICE_GBP_YEARLY!,
    },
  },
  EU: {
    region: "EU",
    currency: "EUR",
    provider: "stripe",
    prices: {
      MONTHLY: 14,
      YEARLY: 56,
    },
    stripePriceIds: {
      MONTHLY: process.env.STRIPE_PRICE_EUR_MONTHLY!,
      YEARLY: process.env.STRIPE_PRICE_EUR_YEARLY!,
    },
  },
  ROW: {
    region: "ROW",
    currency: "USD",
    provider: "stripe",
    prices: {
      MONTHLY: 15,
      YEARLY: 60,
    },
    stripePriceIds: {
      MONTHLY: process.env.STRIPE_PRICE_USD_MONTHLY!,
      YEARLY: process.env.STRIPE_PRICE_USD_YEARLY!,
    },
  },
};