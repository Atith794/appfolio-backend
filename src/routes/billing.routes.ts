import Razorpay from "razorpay";
import crypto from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Stripe from "stripe";
import rateLimit from "@fastify/rate-limit";

import { UserModel } from "../models/user.model.js";
import { resolvePricingFromRequest } from "../lib/resolvePricingFromRequest.js";
import {
  BILLING_CATALOG,
  type Billing,
  type BillingRegion,
} from "../lib/billingConfig.js";
import fs from "fs";

type AuthedRequest = FastifyRequest & {
  auth?: {
    clerkUserId?: string;
  };
};

type CheckoutBody = {
  billing?: Billing;
};

type RazorpayVerifyBody = {
  razorpay_payment_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature?: string;
};

// Recurring payments type
// type RazorpayWebhookBody = {
//   event?: string;
//   payload?: {
//     subscription?: {
//       entity?: {
//         id?: string;
//         status?: string;
//         current_start?: number | null;
//         current_end?: number | null;
//         ended_at?: number | null;
//         notes?: Record<string, string>;
//       };
//     };
//     payment?: {
//       entity?: {
//         id?: string;
//         status?: string;
//         error_description?: string;
//       };
//     };
//   };
//   created_at?: number;
//   account_id?: string;
// };

type RazorpayWebhookBody = {
  event?: string;
  payload?: {
    subscription?: {
      entity?: {
        id?: string;
        status?: string;
        current_start?: number | null;
        current_end?: number | null;
        ended_at?: number | null;
        notes?: Record<string, string>;
      };
    };
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
        amount?: number;
        currency?: string;
        error_description?: string;
      };
    };
  };
  created_at?: number;
  account_id?: string;
};

type RawBodyRequest = FastifyRequest & {
  rawBody?: Buffer;
};

type RazorpayOrderVerifyBody = {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
};

function hmacSHA256Hex(payload: string | Buffer, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string) {
  if (!/^[a-fA-F0-9]+$/.test(a)) return false;
  if (!/^[a-fA-F0-9]+$/.test(b)) return false;

  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isValidBilling(value: unknown): value is Billing {
  return value === "MONTHLY" || value === "YEARLY";
}

function isBillingRegion(value: unknown): value is BillingRegion {
  return value === "IN" || value === "UK" || value === "GBP" || value === "US";
}

function getClerkUserId(req: FastifyRequest): string | null {
  const clerkUserId = (req as AuthedRequest).auth?.clerkUserId;
  return clerkUserId ? String(clerkUserId) : null;
}

function hasLockedBillingProfile(user: any) {
  return Boolean(
    user?.billingCountry &&
    user?.billingCurrency &&
    user?.billingRegion &&
    user?.provider,
  );
}

function resolvePricingForUser(req: FastifyRequest, user: any) {
  if (hasLockedBillingProfile(user) && isBillingRegion(user.billingRegion)) {
    const region = user.billingRegion as BillingRegion;
    const config = BILLING_CATALOG[region];

    if (config && config.provider === user.provider) {
      return {
        country: String(user.billingCountry),
        region,
        currency: String(user.billingCurrency),
        provider: config.provider,
        prices: config.prices,
        config,
      };
    }
  }

  return resolvePricingFromRequest(req);
}

function applyBillingProfile(params: {
  user: any;
  provider: "razorpay" | "stripe";
  billing: Billing;
  pricing: ReturnType<typeof resolvePricingForUser>;
}) {
  const { user, provider, billing, pricing } = params;

  user.provider = provider;
  user.billingInterval = billing;
  user.billingCountry = pricing.country;
  user.billingCurrency = pricing.currency;
  user.billingRegion = pricing.region;
}

function hasOpenSubscriptionState(user: any) {
  const activeLike = ["ACTIVE", "TRIALING", "PAST_DUE"];
  if (user?.plan === "PRO" && activeLike.includes(String(user?.planStatus))) {
    return true;
  }

  const hasProviderSubscription =
    Boolean(user?.razorpaySubscriptionId) ||
    Boolean(user?.stripeSubscriptionId);

  if (hasProviderSubscription && String(user?.planStatus) !== "CANCELED") {
    return true;
  }

  return false;
}

function toDateFromUnix(value?: number | null) {
  if (!value || Number.isNaN(value)) return null;
  return new Date(value * 1000);
}

function setPlanFromStripeStatus(user: any, status: string | null | undefined) {
  const s = String(status || "").toLowerCase();

  if (s === "active") {
    user.plan = "PRO";
    user.planStatus = "ACTIVE";
    return;
  }

  if (s === "trialing") {
    user.plan = "PRO";
    user.planStatus = "TRIALING";
    return;
  }

  if (s === "past_due" || s === "unpaid" || s === "incomplete") {
    user.plan = "PRO";
    user.planStatus = "PAST_DUE";
    return;
  }

  user.plan = "FREE";
  user.planStatus = "CANCELED";
}

function setPlanFromRazorpayStatus(
  user: any,
  status: string | null | undefined,
) {
  const s = String(status || "").toLowerCase();

  if (s === "active") {
    user.plan = "PRO";
    user.planStatus = "ACTIVE";
    return;
  }

  if (s === "authenticated") {
    user.planStatus = "INACTIVE";
    return;
  }

  if (s === "pending" || s === "halted") {
    user.plan = "PRO";
    user.planStatus = "PAST_DUE";
    return;
  }

  if (s === "completed" || s === "cancelled" || s === "expired") {
    user.plan = "FREE";
    user.planStatus = "CANCELED";
    return;
  }

  user.planStatus = "INACTIVE";
}

function isStillWithinPaidPeriod(user: any) {
  if (!user?.planValidUntil) return false;
  return new Date(user.planValidUntil).getTime() > Date.now();
}

function getRazorpayTotalCount(billing: Billing) {
  if (billing === "MONTHLY") {
    return 120;
  }

  if (billing === "YEARLY") {
    return 10;
  }

  return 1;
}

function getRazorpayPlanId(params: { region: string; billing: Billing }) {
  const { region, billing } = params;

  const planMap: Record<string, Record<Billing, string | undefined>> = {
    IN: {
      MONTHLY: process.env.RAZORPAY_PLAN_IN_MONTHLY,
      YEARLY: process.env.RAZORPAY_PLAN_IN_YEARLY,
    },
    GBP: {
      MONTHLY: process.env.RAZORPAY_PLAN_GBP_MONTHLY,
      YEARLY: process.env.RAZORPAY_PLAN_GBP_YEARLY,
    },
    UK: {
      MONTHLY: process.env.RAZORPAY_PLAN_UK_MONTHLY,
      YEARLY: process.env.RAZORPAY_PLAN_UK_YEARLY,
    },
    US: {
      MONTHLY: process.env.RAZORPAY_PLAN_ROW_MONTHLY,
      YEARLY: process.env.RAZORPAY_PLAN_ROW_YEARLY,
    },
  };

  return planMap[region]?.[billing];
}

// One time payment helpers
function getOneTimePlanPeriod(billing: Billing) {
  const start = new Date();
  const end = new Date(start);

  if (billing === "MONTHLY") {
    end.setMonth(end.getMonth() + 1);
  } else if (billing === "YEARLY") {
    end.setFullYear(end.getFullYear() + 1);
  }

  return { start, end };
}

function toRazorpayAmountInSubunits(amount: number, currency: string) {
  const normalizedCurrency = String(currency).toUpperCase();

  /**
   * Your current catalog looks like it mainly uses INR / GBP / USD.
   * These are 2-decimal currencies, so multiply by 100.
   *
   * Example:
   * INR 999  => 99900
   * USD 20  => 2000
   * GBP 10  => 1000
   */
  const twoDecimalCurrencies = new Set(["INR", "USD", "GBP", "EUR"]);

  if (!twoDecimalCurrencies.has(normalizedCurrency)) {
    throw new Error(`Unsupported Razorpay currency: ${currency}`);
  }

  return Math.round(Number(amount) * 100);
}

function hasActivePaidAccess(user: any) {
  const activeLike = ["ACTIVE", "TRIALING", "PAST_DUE"];

  return Boolean(
    user?.plan === "PRO" &&
    activeLike.includes(String(user?.planStatus)) &&
    isStillWithinPaidPeriod(user),
  );
}

export async function billingRoutes(app: FastifyInstance) {
  if (!process.env.RAZORPAY_KEY_ID) {
    throw new Error("RAZORPAY_KEY_ID is missing");
  }

  if (!process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("RAZORPAY_KEY_SECRET is missing");
  }

  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET is missing");
  }
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });

  app.get(
    "/pricing-context",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (req, reply) => {
      const pricing = resolvePricingFromRequest(req);
      return reply.send({
        country: pricing.country,
        region: pricing.region,
        currency: pricing.currency,
        provider: pricing.provider,
        prices: {
          monthly: pricing.prices.MONTHLY,
          yearly: pricing.prices.YEARLY,
          yearlyAnchor: pricing.prices.MONTHLY * 12,
        },
      });
    },
  );

  app.post<{ Body: CheckoutBody }>(
    "/checkout",
    // { preHandler: app.requireAuth },
    {
      preHandler: app.requireAuth,
      bodyLimit: 10 * 1024,
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["billing"],
          properties: {
            billing: {
              type: "string",
              enum: ["MONTHLY", "YEARLY"],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const clerkUserId = getClerkUserId(req);
      if (!clerkUserId) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const user = await UserModel.findOne({ clerkUserId });
      if (!user) {
        return reply
          .code(401)
          .send({ message: "Unauthorized: User not found" });
      }

      const billing = req.body?.billing;
      if (!isValidBilling(billing)) {
        return reply.code(400).send({ message: "Invalid billing" });
      }

      if (hasOpenSubscriptionState(user)) {
        return reply.code(409).send({
          message:
            "Subscription already exists or is still active for this user",
        });
      }

      const pricing = resolvePricingForUser(req, user);
      // Code block with recurring payments
      // try {
      //   if (pricing.provider === "razorpay") {
      //     if (!("razorpayPlanIds" in pricing.config)) {
      //       return reply.code(500).send({
      //         message: "Invalid Razorpay billing configuration",
      //       });
      //     }

      //     const planId = getRazorpayPlanId({
      //       region: pricing.region,
      //       billing,
      //     });

      //     if (!planId) {
      //       return reply.code(500).send({
      //         message: `Missing Razorpay plan ID for ${pricing.region} ${billing}`,
      //       });
      //     }

      //     if (!planId) {
      //       return reply
      //         .code(500)
      //         .send({ message: "Missing Razorpay plan ID" });
      //     }

      //     req.log.info(
      //       {
      //         provider: pricing.provider,
      //         region: pricing.region,
      //         billing,
      //         currency: pricing.currency,
      //         planId,
      //         keyMode: process.env.RAZORPAY_KEY_ID?.startsWith("rzp_test_")
      //           ? "TEST"
      //           : "LIVE",
      //       },
      //       "Creating Razorpay subscription",
      //     );

      //     const subscription = await razorpay.subscriptions.create({
      //       plan_id: planId,
      //       total_count: getRazorpayTotalCount(billing),
      //       quantity: 1,
      //       notes: {
      //         userId: String(user._id),
      //         clerkUserId,
      //         billing,
      //         billingCountry: pricing.country,
      //         billingCurrency: pricing.currency,
      //         billingRegion: pricing.region,
      //       },
      //     });

      //     applyBillingProfile({
      //       user,
      //       provider: "razorpay",
      //       billing,
      //       pricing,
      //     });

      //     user.razorpaySubscriptionId = subscription.id;
      //     user.planStatus = "INACTIVE";
      //     user.cancelAtPeriodEnd = false;
      //     await user.save();

      //     // return reply.send({
      //     //   provider: "razorpay",
      //     //   keyId: process.env.RAZORPAY_KEY_ID,
      //     //   subscriptionId: subscription.id,
      //     // });
      //     return reply.send({
      //       provider: "razorpay",
      //       keyId: process.env.RAZORPAY_KEY_ID,
      //       subscriptionId: subscription.id,
      //       billing,
      //       region: pricing.region,
      //       currency: pricing.currency,
      //       amount: pricing.prices[billing],
      //     });
      //   }
      // }
      // catch (error: any) {
      //   req.log.error(
      //     {
      //       razorpayStatusCode: error?.statusCode,
      //       razorpayCode: error?.error?.code,
      //       razorpayDescription: error?.error?.description,
      //       razorpayField: error?.error?.field,
      //       razorpayStep: "subscriptions.create",
      //     },
      //     "Billing checkout failed",
      //   );
      //   req.log.error({ err:error }, "Billing checkout failed");
      //   return reply.code(500).send({ message: "Unable to create checkout" });
      // }
      try {
        if (pricing.provider === "razorpay") {
          if (hasActivePaidAccess(user)) {
            return reply.code(409).send({
              message: "You already have an active paid plan",
            });
          }

          const amount = pricing.prices[billing];
          const amountInSubunits = toRazorpayAmountInSubunits(
            amount,
            pricing.currency,
          );

          const receipt = `pro_${String(user._id).slice(-10)}_${Date.now()
            .toString()
            .slice(-8)}`;

          req.log.info(
            {
              provider: pricing.provider,
              region: pricing.region,
              billing,
              currency: pricing.currency,
              amount,
              amountInSubunits,
              keyMode: process.env.RAZORPAY_KEY_ID?.startsWith("rzp_test_")
                ? "TEST"
                : "LIVE",
            },
            "Creating Razorpay one-time order",
          );

          const order = await razorpay.orders.create({
            amount: amountInSubunits,
            currency: pricing.currency,
            receipt,
            notes: {
              userId: String(user._id),
              clerkUserId,
              billing,
              billingCountry: pricing.country,
              billingCurrency: pricing.currency,
              billingRegion: pricing.region,
              paymentType: "one_time",
            },
          });

          applyBillingProfile({
            user,
            provider: "razorpay",
            billing,
            pricing,
          });

          /**
           * Add these fields in your User model if they don't already exist:
           * razorpayOrderId
           * razorpayPaymentId
           * billingType
           */
          user.razorpayOrderId = order.id;
          user.billingType = "one_time";
          // user.planStatus = "PENDING";
          user.plan = "FREE";
          user.planStatus = "INACTIVE";
          user.cancelAtPeriodEnd = false;

          /**
           * Since this is no longer a subscription checkout,
           * clear old pending subscription id if needed.
           */
          user.razorpaySubscriptionId = undefined;

          await user.save();

          return reply.send({
            provider: "razorpay",
            checkoutType: "order",
            keyId: process.env.RAZORPAY_KEY_ID,
            orderId: order.id,
            billing,
            region: pricing.region,
            currency: pricing.currency,

            /**
             * amount is sent in subunits for Razorpay Checkout.
             * displayAmount is only for your UI.
             */
            amount: order.amount,
            displayAmount: pricing.prices[billing],
          });
        }

        return reply.code(400).send({
          message: "Unsupported payment provider",
        });
      } catch (error: any) {
        req.log.error(
          {
            razorpayStatusCode: error?.statusCode,
            razorpayCode: error?.error?.code,
            razorpayDescription: error?.error?.description,
            razorpayField: error?.error?.field,
            razorpayStep: "orders.create",
          },
          "Billing checkout failed",
        );

        req.log.error({ err: error }, "Billing checkout failed");

        return reply.code(500).send({ message: "Unable to create checkout" });
      }
    },
  );

  app.post<{ Body: RazorpayVerifyBody }>(
    "/razorpay/verify-subscription",
    {
      preHandler: app.requireAuth,
      bodyLimit: 10 * 1024,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "razorpay_payment_id",
            "razorpay_subscription_id",
            "razorpay_signature",
          ],
          properties: {
            razorpay_payment_id: {
              type: "string",
              minLength: 1,
              maxLength: 100,
            },
            razorpay_subscription_id: {
              type: "string",
              minLength: 1,
              maxLength: 100,
            },
            razorpay_signature: {
              type: "string",
              pattern: "^[a-fA-F0-9]{64}$",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const clerkUserId = getClerkUserId(req);
      if (!clerkUserId) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const user = await UserModel.findOne({ clerkUserId });
      if (!user) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const {
        razorpay_payment_id,
        razorpay_subscription_id,
        razorpay_signature,
      } = req.body || {};
      if (
        !razorpay_payment_id ||
        !razorpay_subscription_id ||
        !razorpay_signature
      ) {
        return reply.code(400).send({ message: "Missing payment fields" });
      }

      const subId = user.razorpaySubscriptionId;
      if (!subId) {
        return reply
          .code(400)
          .send({ message: "No Razorpay subscription found" });
      }

      if (razorpay_subscription_id !== subId) {
        return reply.code(400).send({ message: "Subscription ID mismatch" });
      }

      const expected = hmacSHA256Hex(
        `${razorpay_payment_id}|${subId}`,
        process.env.RAZORPAY_KEY_SECRET!,
      );

      if (!safeEqualHex(expected, razorpay_signature)) {
        return reply.code(400).send({ message: "Invalid Razorpay signature" });
      }

      const razorpaySubscription = await razorpay.subscriptions.fetch(subId);

      const subscriptionStatus = (razorpaySubscription as any)?.status;
      const currentStart = toDateFromUnix(
        (razorpaySubscription as any)?.current_start,
      );

      const currentEnd = toDateFromUnix(
        (razorpaySubscription as any)?.current_end,
      );

      user.provider = "razorpay";
      user.razorpaySubscriptionId = subId;
      user.planPurchasedAt = user.planPurchasedAt || new Date();
      user.lastPaymentAt = new Date();
      user.cancelAtPeriodEnd = false;

      if (currentStart) {
        user.currentPeriodStart = currentStart;
      }

      if (currentEnd) {
        user.planValidUntil = currentEnd;
      }

      if (subscriptionStatus === "active" && currentEnd) {
        user.plan = "PRO";
        user.planStatus = "ACTIVE";
      } else if (
        subscriptionStatus === "authenticated" ||
        subscriptionStatus === "created"
      ) {
        user.plan = "FREE";
        user.planStatus = "INACTIVE";
      } else {
        setPlanFromRazorpayStatus(user, subscriptionStatus);
      }

      await user.save();

      return reply.send({
        success: true,
        provider: "razorpay",
        plan: user.plan,
        planStatus: user.planStatus,
        planValidUntil: user.planValidUntil,
        razorpayStatus: subscriptionStatus,
      });
    },
  );

  app.post<{ Body: RazorpayOrderVerifyBody }>(
    "/razorpay/verify-order",
    {
      preHandler: app.requireAuth,
      bodyLimit: 10 * 1024,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "razorpay_payment_id",
            "razorpay_order_id",
            "razorpay_signature",
          ],
          properties: {
            razorpay_payment_id: {
              type: "string",
              minLength: 1,
              maxLength: 100,
            },
            razorpay_order_id: {
              type: "string",
              minLength: 1,
              maxLength: 100,
            },
            razorpay_signature: {
              type: "string",
              pattern: "^[a-fA-F0-9]{64}$",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const clerkUserId = getClerkUserId(req);

      if (!clerkUserId) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const user = await UserModel.findOne({ clerkUserId });

      if (!user) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const { razorpay_payment_id, razorpay_order_id, razorpay_signature } =
        req.body || {};

      if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        return reply.code(400).send({ message: "Missing payment fields" });
      }

      if (!user.razorpayOrderId) {
        return reply.code(400).send({ message: "No Razorpay order found" });
      }

      if (razorpay_order_id !== user.razorpayOrderId) {
        return reply.code(400).send({ message: "Order ID mismatch" });
      }

      const expected = hmacSHA256Hex(
        `${razorpay_order_id}|${razorpay_payment_id}`,
        process.env.RAZORPAY_KEY_SECRET!,
      );

      if (!safeEqualHex(expected, razorpay_signature)) {
        return reply.code(400).send({ message: "Invalid Razorpay signature" });
      }

      const payment = await razorpay.payments.fetch(razorpay_payment_id);

      if ((payment as any)?.order_id !== razorpay_order_id) {
        return reply.code(400).send({ message: "Payment order mismatch" });
      }

      if ((payment as any)?.status !== "captured") {
        return reply.code(400).send({
          message: `Payment is not captured. Current status: ${(payment as any)?.status}`,
        });
      }

      const billing = isValidBilling(user.billingInterval)
        ? user.billingInterval
        : "MONTHLY";

      const { start, end } = getOneTimePlanPeriod(billing);

      user.provider = "razorpay";
      user.billingType = "one_time";
      user.razorpayOrderId = razorpay_order_id;
      user.razorpayPaymentId = razorpay_payment_id;

      user.plan = "PRO";
      user.planStatus = "ACTIVE";
      user.planPurchasedAt = user.planPurchasedAt || start;
      user.lastPaymentAt = new Date();
      user.currentPeriodStart = start;
      user.planValidUntil = end;
      user.cancelAtPeriodEnd = false;

      await user.save();

      return reply.send({
        success: true,
        provider: "razorpay",
        checkoutType: "order",
        plan: user.plan,
        planStatus: user.planStatus,
        planValidUntil: user.planValidUntil,
      });
    },
  );

  app.post(
    "/razorpay/webhook",
    {
      bodyLimit: 256 * 1024,
      config: {
        rawBody: true,
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
        },
      },
    },
    async (req, reply) => {
      try {
        const signature = req.headers["x-razorpay-signature"];
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

        if (!signature || !secret) {
          return reply
            .code(400)
            .send({ message: "Missing Razorpay webhook signature" });
        }

        const rawBody = (req as RawBodyRequest).rawBody;

        if (!rawBody) {
          return reply.code(400).send({ message: "Missing raw body" });
        }

        const expected = hmacSHA256Hex(rawBody, secret);

        if (!safeEqualHex(expected, String(signature))) {
          return reply
            .code(400)
            .send({ message: "Invalid Razorpay webhook signature" });
        }

        const event = req.body as RazorpayWebhookBody;

        const eventName = String(event?.event || "");
        const subscriptionEntity = event?.payload?.subscription?.entity;
        const paymentEntity = event?.payload?.payment?.entity;
        const subscriptionId = subscriptionEntity?.id;

        if (
          !subscriptionId &&
          paymentEntity?.order_id &&
          eventName === "payment.captured"
        ) {
          let user = await UserModel.findOne({
            razorpayOrderId: paymentEntity.order_id,
          });

          if (!user) {
            return reply.send({
              received: true,
              userFound: false,
              reason: "No user found for Razorpay order",
            });
          }

          const eventId = String(req.headers["x-razorpay-event-id"] || "");

          if (eventId && user.lastWebhookEventId === eventId) {
            return reply.send({ received: true, deduped: true });
          }

          if (eventId) {
            user.lastWebhookEventId = eventId;
          }

          const billing = isValidBilling(user.billingInterval)
            ? user.billingInterval
            : "MONTHLY";

          const { start, end } = getOneTimePlanPeriod(billing);

          user.provider = "razorpay";
          user.billingType = "one_time";
          user.razorpayPaymentId = paymentEntity.id;

          user.plan = "PRO";
          user.planStatus = "ACTIVE";
          user.planPurchasedAt = user.planPurchasedAt || start;
          user.lastPaymentAt = new Date();
          user.currentPeriodStart = user.currentPeriodStart || start;
          user.planValidUntil = user.planValidUntil || end;
          user.cancelAtPeriodEnd = false;

          await user.save();

          return reply.send({
            received: true,
            checkoutType: "order",
          });
        }

        if (!subscriptionId) {
          return reply.send({ received: true, reason: "No subscription id" });
        }

        let user = await UserModel.findOne({
          razorpaySubscriptionId: subscriptionId,
        });

        if (!user) {
          const notes = subscriptionEntity?.notes || {};

          user = await UserModel.findOne({
            $or: [{ _id: notes.userId }, { clerkUserId: notes.clerkUserId }],
          });
        }

        if (!user) {
          return reply.send({ received: true, userFound: false });
        }

        const eventId = String(req.headers["x-razorpay-event-id"] || "");

        if (eventId && user.lastWebhookEventId === eventId) {
          return reply.send({ received: true, deduped: true });
        }

        if (eventId) {
          user.lastWebhookEventId = eventId;
        }

        user.provider = "razorpay";
        user.razorpaySubscriptionId = subscriptionId;

        const subscriptionStatus = subscriptionEntity?.status;

        setPlanFromRazorpayStatus(user, subscriptionStatus);

        const currentStart = toDateFromUnix(subscriptionEntity?.current_start);
        const currentEnd = toDateFromUnix(subscriptionEntity?.current_end);
        const endedAt = toDateFromUnix(subscriptionEntity?.ended_at);

        if (currentStart) {
          user.currentPeriodStart = currentStart;
        }

        if (currentEnd) {
          user.planValidUntil = currentEnd;
        }

        if (endedAt) {
          user.subscriptionEndedAt = endedAt;
        }

        if (eventName === "subscription.authenticated") {
          user.planPurchasedAt = user.planPurchasedAt || new Date();
          user.planStatus = "INACTIVE";
        }

        if (
          eventName === "subscription.activated" ||
          eventName === "subscription.charged" ||
          eventName === "subscription.updated" ||
          eventName === "subscription.resumed" ||
          subscriptionStatus === "active"
        ) {
          user.plan = "PRO";
          user.planStatus = "ACTIVE";
          user.planPurchasedAt = user.planPurchasedAt || new Date();
          user.lastPaymentAt = new Date();
          user.cancelAtPeriodEnd = false;
        }

        if (
          eventName === "subscription.pending" ||
          eventName === "subscription.halted"
        ) {
          user.plan = "PRO";
          user.planStatus = "PAST_DUE";
        }

        if (
          eventName === "subscription.cancelled" ||
          eventName === "subscription.completed" ||
          eventName === "subscription.expired"
        ) {
          user.cancelAtPeriodEnd = true;

          if (!isStillWithinPaidPeriod(user)) {
            user.plan = "FREE";
            user.planStatus = "CANCELED";
          }
        }

        if (paymentEntity?.status === "captured") {
          user.lastPaymentAt = new Date();

          if (currentEnd) {
            user.planValidUntil = currentEnd;
          }

          user.plan = "PRO";
          user.planStatus = "ACTIVE";
        }

        if (paymentEntity?.status === "failed") {
          user.plan = "PRO";
          user.planStatus = "PAST_DUE";
          user.lastPaymentFailedAt = new Date();
          user.lastPaymentFailureReason = paymentEntity?.error_description;
        }

        await user.save();

        return reply.send({ received: true });
      } catch (error: any) {
        req.log.error({ error }, "Razorpay webhook failed");

        return reply
          .code(500)
          .send({ message: "Razorpay webhook processing failed" });
      }
    },
  );

  // Stripe webhook
  // app.post("/stripe/webhook", async (req, reply) => {
  //   try {
  //     const signature = req.headers["stripe-signature"];
  //     const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  //     if (!signature || !endpointSecret) {
  //       return reply.code(400).send({ message: "Missing Stripe webhook signature" });
  //     }

  //     if (!Buffer.isBuffer(req.body)) {
  //       return reply.code(400).send({ message: "Stripe webhook requires raw body buffer" });
  //     }

  //     let event: Stripe.Event;
  //     try {
  //       event = stripe.webhooks.constructEvent(
  //         req.body,
  //         String(signature),
  //         endpointSecret
  //       );
  //     } catch (err: any) {
  //       return reply.code(400).send({ message: `Webhook Error: ${err.message}` });
  //     }

  //     const eventId = event.id;

  //     switch (event.type) {
  //       case "checkout.session.completed": {
  //         const session = event.data.object as Stripe.Checkout.Session;
  //         const customerId = String(session.customer || "");
  //         const subscriptionId = String(session.subscription || "");

  //         if (!customerId) break;

  //         const user = await UserModel.findOne({ stripeCustomerId: customerId });
  //         if (!user) break;
  //         if (user.lastWebhookEventId === eventId) {
  //           return reply.send({ received: true, deduped: true });
  //         }

  //         user.lastWebhookEventId = eventId;
  //         user.provider = "stripe";
  //         user.providerCustomerId = customerId;
  //         user.cancelAtPeriodEnd = false;

  //         if (subscriptionId) {
  //           user.stripeSubscriptionId = subscriptionId;
  //         }

  //         user.plan = "PRO";
  //         user.planStatus = "ACTIVE";
  //         user.planPurchasedAt = user.planPurchasedAt || new Date();
  //         await user.save();
  //         break;
  //       }

  //       case "invoice.paid": {
  //         const invoice = event.data.object as Stripe.Invoice;
  //         const customerId = String(invoice.customer || "");
  //         if (!customerId) break;

  //         const user = await UserModel.findOne({ stripeCustomerId: customerId });
  //         if (!user) break;
  //         if (user.lastWebhookEventId === eventId) {
  //           return reply.send({ received: true, deduped: true });
  //         }

  //         user.lastWebhookEventId = eventId;
  //         user.provider = "stripe";
  //         user.plan = "PRO";
  //         user.planStatus = "ACTIVE";
  //         user.lastPaymentAt = new Date();
  //         await user.save();
  //         break;
  //       }

  //       case "invoice.payment_failed": {
  //         const invoice = event.data.object as Stripe.Invoice;
  //         const customerId = String(invoice.customer || "");
  //         if (!customerId) break;

  //         const user = await UserModel.findOne({ stripeCustomerId: customerId });
  //         if (!user) break;
  //         if (user.lastWebhookEventId === eventId) {
  //           return reply.send({ received: true, deduped: true });
  //         }

  //         user.lastWebhookEventId = eventId;
  //         user.provider = "stripe";
  //         user.plan = "PRO";
  //         user.planStatus = "PAST_DUE";
  //         await user.save();
  //         break;
  //       }

  //       case "customer.subscription.updated":
  //       case "customer.subscription.deleted": {
  //         const sub = event.data.object as Stripe.Subscription;
  //         const customerId = String(sub.customer || "");
  //         if (!customerId) break;

  //         const user = await UserModel.findOne({ stripeCustomerId: customerId });
  //         if (!user) break;
  //         if (user.lastWebhookEventId === eventId) {
  //           return reply.send({ received: true, deduped: true });
  //         }

  //         user.lastWebhookEventId = eventId;
  //         user.provider = "stripe";
  //         user.stripeSubscriptionId = String(sub.id || user.stripeSubscriptionId || "");
  //         user.cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);

  //         if (sub?.current_period_end) {
  //           user.planValidUntil = new Date(sub?.current_period_end * 1000);
  //         }

  //         setPlanFromStripeStatus(user, sub.status);

  //         if (
  //           event.type === "customer.subscription.deleted" &&
  //           isStillWithinPaidPeriod(user)
  //         ) {
  //           user.plan = "PRO";
  //           user.planStatus = "CANCELED";
  //         }

  //         await user.save();
  //         break;
  //       }

  //       default:
  //         break;
  //     }

  //     return reply.send({ received: true });
  //   } catch (error: any) {
  //     req.log.error({ error }, "Stripe webhook failed");
  //     return reply.code(500).send({ message: "Stripe webhook processing failed" });
  //   }
  // });
}
