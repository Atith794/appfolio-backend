import type { FastifyRequest } from "fastify";
import {
  BILLING_CATALOG,
  REGION_COUNTRY_MAP,
  type BillingRegion,
  type RazorpayBillingConfig,
  type BillingConfig,
} from "./billingConfig.js";

export type ResolvedPricing = {
  country: string;
  region: BillingConfig["region"];
  currency: BillingConfig["currency"];
  provider: BillingConfig["provider"];
  prices: BillingConfig["prices"];
  config: BillingConfig;
};


function normalizeCountry(code?: string | string[] | null) {
  if (Array.isArray(code)) return String(code[0] || "").trim().toUpperCase();
  return String(code || "").trim().toUpperCase();
}

function getRegionFromCountry(country: string): BillingRegion {
  return REGION_COUNTRY_MAP[country] || "ROW";
}


export function resolvePricingFromRequest(req: FastifyRequest): ResolvedPricing {
  const headers = req.headers as Record<string, string | string[] | undefined>;

  const forcedCountry = normalizeCountry(process.env.FORCE_BILLING_COUNTRY);
  if (forcedCountry) {
    const region = getRegionFromCountry(forcedCountry);
    const config = BILLING_CATALOG[region];

    return {
      country: forcedCountry,
      region: config.region,
      currency: config.currency,
      provider: config.provider,
      prices: config.prices,
      config,
    };
  }

  const trustedCountry =
    normalizeCountry(headers["x-vercel-ip-country"]) ||
    normalizeCountry(headers["cf-ipcountry"]) ||
    normalizeCountry(headers["x-country-code"]);

  const country = trustedCountry || "US";
  const region = getRegionFromCountry(country);
  const config = BILLING_CATALOG[region];

  return {
    country,
    region: config.region,
    currency: config.currency,
    provider: config.provider,
    prices: config.prices,
    config,
  };
}