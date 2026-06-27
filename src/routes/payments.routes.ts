import Razorpay from "razorpay";
import crypto from "crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { resolvePricingFromRequest } from "../lib/resolvePricingFromRequest.js";
import type { Billing, BillingCurrency } from "../lib/billingConfig.js";
import { UserModel } from "../models/user.model.js";

type CreateOrderBody = {
  amount?: number;
  currency?: BillingCurrency;
  receipt?: string;
  billing?: Billing;
};

type VerifyPaymentBody = {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
};

const MIN_AMOUNT_PAISE = 100;

function hmacSHA256Hex(payload: string, secret: string) {
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

function getClerkUserId(req: FastifyRequest) {
  return req.auth?.clerkUserId ? String(req.auth.clerkUserId) : null;
}

function isBilling(value: unknown): value is Billing {
  return value === "MONTHLY" || value === "YEARLY";
}

function isBillingCurrency(value: unknown): value is BillingCurrency {
  return (
    value === "INR" ||
    value === "USD" ||
    value === "GBP" ||
    value === "EUR"
  );
}

function addBillingPeriod(start: Date, billing?: Billing) {
  const end = new Date(start);

  if (billing === "YEARLY") {
    end.setFullYear(end.getFullYear() + 1);
    return end;
  }

  end.setMonth(end.getMonth() + 1);
  return end;
}

export async function paymentsRoutes(app: FastifyInstance) {
  if (!process.env.RAZORPAY_KEY_ID) {
    throw new Error("RAZORPAY_KEY_ID is missing");
  }

  if (!process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("RAZORPAY_KEY_SECRET is missing");
  }

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  app.post<{ Body: CreateOrderBody }>(
    "/create-order",
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
          required: ["amount", "currency"],
          properties: {
            amount: { type: "integer", minimum: MIN_AMOUNT_PAISE },
            currency: {
              type: "string",
              enum: ["INR", "USD", "GBP", "EUR"],
            },
            receipt: { type: "string", minLength: 1, maxLength: 40 },
            billing: { type: "string", enum: ["MONTHLY", "YEARLY"] },
          },
        },
      },
    },
    async (req, reply) => {
      const clerkUserId = getClerkUserId(req);
      if (!clerkUserId) {
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const amount = Number(req.body?.amount);
      const currency = req.body?.currency;
      const billing = req.body?.billing;

      if (!Number.isInteger(amount) || amount < MIN_AMOUNT_PAISE) {
        return reply
          .code(400)
          .send({ message: "Amount must be at least 100 paise" });
      }

      if (!isBillingCurrency(currency)) {
        return reply.code(400).send({ message: "Invalid currency" });
      }

      const pricing = resolvePricingFromRequest(req);
      if (isBilling(billing)) {
        const expectedAmount = pricing.prices[billing] * 100;

        if (amount !== expectedAmount || currency !== pricing.currency) {
          return reply.code(400).send({ message: "Invalid order amount" });
        }
      }

      try {
        const order = (await razorpay.orders.create({
          amount,
          currency,
          receipt:
            req.body?.receipt ||
            `appfolio_${Date.now().toString(36).slice(-10)}`,
          notes: {
            clerkUserId,
            billing: billing || "",
            source: "standard_checkout",
          },
        })) as any;

        return reply.send({
          order_id: order.id,
          amount: order.amount,
          currency: order.currency,
        });
      } catch (error: any) {
        req.log.error({ error }, "Razorpay order creation failed");

        if (error?.statusCode === 401 || error?.statusCode === 403) {
          return reply
            .code(401)
            .send({ message: "Razorpay authentication failed" });
        }

        return reply.code(500).send({ message: "Unable to create order" });
      }
    },
  );

  app.post<{ Body: VerifyPaymentBody }>(
    "/verify-payment",
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

      const {
        razorpay_payment_id,
        razorpay_order_id,
        razorpay_signature,
      } = req.body || {};

      if (
        !razorpay_payment_id ||
        !razorpay_order_id ||
        !razorpay_signature
      ) {
        return reply.code(400).send({ message: "Missing payment fields" });
      }

      const expected = hmacSHA256Hex(
        `${razorpay_order_id}|${razorpay_payment_id}`,
        process.env.RAZORPAY_KEY_SECRET!,
      );

      if (!safeEqualHex(expected, razorpay_signature)) {
        return reply.code(400).send({ message: "Invalid payment signature" });
      }

      const order = await razorpay.orders.fetch(razorpay_order_id);
      const orderNotes = (order as any)?.notes || {};

      if (
        orderNotes.clerkUserId &&
        String(orderNotes.clerkUserId) !== clerkUserId
      ) {
        return reply.code(400).send({ message: "Order user mismatch" });
      }

      const user = await UserModel.findOne({ clerkUserId });
      if (user) {
        const now = new Date();
        const billing = isBilling(orderNotes.billing)
          ? orderNotes.billing
          : undefined;

        user.provider = "razorpay";
        user.plan = "PRO";
        user.planStatus = "ACTIVE";
        user.billingInterval = billing || user.billingInterval;
        user.planPurchasedAt = user.planPurchasedAt || now;
        user.lastPaymentAt = now;
        user.currentPeriodStart = now;
        user.planValidUntil = addBillingPeriod(now, billing);
        user.cancelAtPeriodEnd = false;

        await user.save();
      }

      return reply.send({
        success: true,
        payment_id: razorpay_payment_id,
        order_id: razorpay_order_id,
      });
    },
  );
}
