import Razorpay from "razorpay";
import crypto from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Stripe from "stripe";

import { UserModel } from "../models/user.model.js";
import { resolvePricingFromRequest } from "../lib/resolvePricingFromRequest.js";
import {
  BILLING_CATALOG,
  type Billing,
  type BillingRegion,
} from "../lib/billingConfig.js";

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
  razorpay_signature?: string;
};

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
        status?: string;
        error_description?: string;
      };
    };
  };
  created_at?: number;
  account_id?: string;
};

function hmacSHA256Hex(payload: string | Buffer, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string) {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isValidBilling(value: unknown): value is Billing {
  return value === "MONTHLY" || value === "YEARLY";
}

function isBillingRegion(value: unknown): value is BillingRegion {
  return value === "IN" || value === "UK" || value === "EU" || value === "ROW";
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
      user?.provider
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
    Boolean(user?.razorpaySubscriptionId) || Boolean(user?.stripeSubscriptionId);

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

function setPlanFromRazorpayStatus(user: any, status: string | null | undefined) {
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

export async function billingRoutes(app: FastifyInstance) {
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });

  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  // Parse Stripe webhook as raw Buffer while keeping JSON parsing for the other billing routes.
  // app.addContentTypeParser(
  //   "application/json",
  //   { parseAs: "buffer" },
  //   (req, body, done) => {
  //     const url = req.url || (req.raw as any)?.url || "";
  //     const isStripeWebhook =
  //       url === "/stripe/webhook" || String(url).endsWith("/billing/stripe/webhook");

  //     if (isStripeWebhook) {
  //       return done(null, body);
  //     }

  //     try {
  //       const parsed = JSON.parse(body.toString("utf8"));
  //       done(null, parsed);
  //     } catch (err) {
  //       done(err as Error, undefined);
  //     }
  //   }
  // );

  app.get("/pricing-context", async (req, reply) => {
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
  });

  app.post<{ Body: CheckoutBody }>(
    "/checkout",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const clerkUserId = getClerkUserId(req);
      if (!clerkUserId) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const user = await UserModel.findOne({ clerkUserId });
      if (!user) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const billing = req.body?.billing;
      if (!isValidBilling(billing)) {
        return reply.code(400).send({ message: "Invalid billing" });
      }

      if (hasOpenSubscriptionState(user)) {
        return reply.code(409).send({
          message: "Subscription already exists or is still active for this user",
        });
      }

      const pricing = resolvePricingForUser(req, user);

      try {
        if (pricing.provider === "razorpay") {
          if (!("razorpayPlanIds" in pricing.config)) {
            return reply.code(500).send({
              message: "Invalid Razorpay billing configuration",
            });
          }

          const planId = pricing.config.razorpayPlanIds[billing];
          if (!planId) {
            return reply.code(500).send({ message: "Missing Razorpay plan ID" });
          }

          const subscription = await razorpay.subscriptions.create({
            plan_id: planId,
            total_count: 120,
            quantity: 1,
            notes: {
              userId: String(user._id),
              clerkUserId,
              billing,
              billingCountry: pricing.country,
              billingCurrency: pricing.currency,
              billingRegion: pricing.region,
            },
          });

          applyBillingProfile({
            user,
            provider: "razorpay",
            billing,
            pricing,
          });

          user.razorpaySubscriptionId = subscription.id;
          user.planStatus = "INACTIVE";
          user.cancelAtPeriodEnd = false;
          await user.save();

          return reply.send({
            provider: "razorpay",
            keyId: process.env.RAZORPAY_KEY_ID,
            subscriptionId: subscription.id,
          });
        }

        // if (!("stripePriceIds" in pricing.config)) {
        //   return reply.code(500).send({
        //     message: "Invalid Stripe billing configuration",
        //   });
        // }

        // if (!process.env.APP_URL) {
        //   return reply.code(500).send({ message: "Missing APP_URL" });
        // }

        // const priceId = pricing.config.stripePriceIds[billing];
        // if (!priceId) {
        //   return reply.code(500).send({ message: "Missing Stripe price ID" });
        // }

        // let customerId = user.stripeCustomerId;
        // if (!customerId) {
        //   const customer = await stripe.customers.create({
        //     email: user.email,
        //     metadata: {
        //       clerkUserId: user.clerkUserId,
        //       userId: String(user._id),
        //     },
        //   });

        //   customerId = customer.id;
        //   user.stripeCustomerId = customer.id;
        //   user.providerCustomerId = customer.id;
        // }

        // const session = await stripe.checkout.sessions.create({
        //   mode: "subscription",
        //   customer: customerId,
        //   line_items: [{ price: priceId, quantity: 1 }],
        //   success_url: `${process.env.APP_URL}/dashboard?upgraded=1`,
        //   cancel_url: `${process.env.APP_URL}/pricing?canceled=1`,
        //   client_reference_id: String(user._id),
        //   metadata: {
        //     clerkUserId: user.clerkUserId,
        //     userId: String(user._id),
        //     billing,
        //     billingCountry: pricing.country,
        //     billingCurrency: pricing.currency,
        //     billingRegion: pricing.region,
        //   },
        // });

        // if (!session.url) {
        //   return reply
        //     .code(500)
        //     .send({ message: "Stripe checkout session URL missing" });
        // }

        // applyBillingProfile({
        //   user,
        //   provider: "stripe",
        //   billing,
        //   pricing,
        // });

        // user.cancelAtPeriodEnd = false;
        // await user.save();

        // return reply.send({
        //   provider: "stripe",
        //   url: session.url,
        // });
      } catch (error: any) {
        req.log.error({ error }, "Billing checkout failed");
        return reply
          .code(500)
          .send({ message: error?.message || "Unable to create checkout" });
      }
    }
  );

  app.post<{ Body: RazorpayVerifyBody }>(
    "/razorpay/verify-subscription",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const clerkUserId = getClerkUserId(req);
      if (!clerkUserId) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const user = await UserModel.findOne({ clerkUserId });
      if (!user) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const { razorpay_payment_id, razorpay_signature } = req.body || {};
      if (!razorpay_payment_id || !razorpay_signature) {
        return reply.code(400).send({ message: "Missing payment fields" });
      }

      const subId = user.razorpaySubscriptionId;
      if (!subId) {
        return reply.code(400).send({ message: "No Razorpay subscription found" });
      }

      const expected = hmacSHA256Hex(
        `${razorpay_payment_id}|${subId}`,
        process.env.RAZORPAY_KEY_SECRET!
      );

      if (!safeEqualHex(expected, razorpay_signature)) {
        return reply.code(400).send({ message: "Invalid Razorpay signature" });
      }

      user.plan = "PRO";
      user.planStatus = "ACTIVE";
      user.planPurchasedAt = new Date();
      user.lastPaymentAt = new Date();
      user.cancelAtPeriodEnd = false;
      await user.save();

      return reply.send({
        success: true,
        provider: "razorpay",
        plan: user.plan,
        planStatus: user.planStatus,
      });
    }
  );
  // Razor pay webhook
  // app.post("/razorpay/webhook", async (req, reply) => {
  //   try {
  //     const signature = req.headers["x-razorpay-signature"];
  //     const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  //     if (!signature || !secret) {
  //       return reply.code(400).send({ message: "Missing Razorpay webhook signature" });
  //     }

  //     const rawBody =
  //       Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));

  //     const expected = hmacSHA256Hex(rawBody, secret);
  //     if (!safeEqualHex(expected, String(signature))) {
  //       return reply.code(400).send({ message: "Invalid Razorpay webhook signature" });
  //     }

  //     const event = (Buffer.isBuffer(req.body)
  //       ? JSON.parse(req.body.toString("utf8"))
  //       : req.body) as RazorpayWebhookBody;

  //     const eventName = String(event?.event || "");
  //     const subscriptionEntity = event?.payload?.subscription?.entity;
  //     const paymentEntity = event?.payload?.payment?.entity;
  //     const subscriptionId = subscriptionEntity?.id;

  //     if (!subscriptionId) {
  //       return reply.send({ received: true });
  //     }

  //     const user = await UserModel.findOne({ razorpaySubscriptionId: subscriptionId });
  //     if (!user) {
  //       return reply.send({ received: true });
  //     }

  //     const eventId = [
  //       String(event?.account_id || ""),
  //       eventName,
  //       subscriptionId,
  //       String(event?.created_at || ""),
  //     ].join(":");

  //     if (user.lastWebhookEventId === eventId) {
  //       return reply.send({ received: true, deduped: true });
  //     }

  //     user.lastWebhookEventId = eventId;
  //     user.provider = "razorpay";

  //     const subscriptionStatus = subscriptionEntity?.status;
  //     setPlanFromRazorpayStatus(user, subscriptionStatus);

  //     const currentEnd = toDateFromUnix(subscriptionEntity?.current_end);
  //     if (currentEnd) {
  //       user.planValidUntil = currentEnd;
  //     }

  //     if (eventName === "subscription.authenticated") {
  //       user.planPurchasedAt = user.planPurchasedAt || new Date();
  //     }

  //     if (
  //       eventName === "subscription.activated" ||
  //       eventName === "subscription.charged" ||
  //       eventName === "subscription.resumed" ||
  //       subscriptionStatus === "active"
  //     ) {
  //       user.plan = "PRO";
  //       user.planStatus = "ACTIVE";
  //       user.planPurchasedAt = user.planPurchasedAt || new Date();
  //       user.lastPaymentAt = new Date();
  //       user.cancelAtPeriodEnd = false;
  //     }

  //     if (eventName === "subscription.pending" || eventName === "subscription.halted") {
  //       user.plan = "PRO";
  //       user.planStatus = "PAST_DUE";
  //     }

  //     if (eventName === "subscription.cancelled" || eventName === "subscription.completed") {
  //       user.cancelAtPeriodEnd = true;

  //       if (!isStillWithinPaidPeriod(user)) {
  //         user.plan = "FREE";
  //         user.planStatus = "CANCELED";
  //       }
  //     }

  //     if (paymentEntity?.status === "captured") {
  //       user.lastPaymentAt = new Date();
  //     }

  //     await user.save();

  //     return reply.send({ received: true });
  //   } catch (error: any) {
  //     req.log.error({ error }, "Razorpay webhook failed");
  //     return reply.code(500).send({ message: "Razorpay webhook processing failed" });
  //   }
  // });

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