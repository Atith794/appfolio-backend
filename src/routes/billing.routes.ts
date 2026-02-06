import Razorpay from "razorpay";
import crypto from "crypto";
import { FastifyInstance } from "fastify";
import { UserModel } from "../models/user.model.js";

const PRICE_PAISE = Number(process.env.PRO_PRICE_PAISE || 39900);

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  throw new Error("Missing Razorpay env vars");
}

export async function billingRoutes(app: FastifyInstance) {
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!
  });

  // Create order
  app.post("/create-order", { preHandler: app.requireAuth }, async (req: any, reply) => {
    const clerkUserId = req.auth.clerkUserId;
    const user = await UserModel.findOne({ clerkUserId });
    if (!user) return reply.code(401).send({ message: "Unauthorized" });

    if (user.plan === "PRO") {
      return reply.send({ alreadyPro: true });
    }

    const userIdShort = String(user._id).slice(-6);
    const timeShort = String(Date.now()).slice(-6);
    const receipt = `PRO_${userIdShort}_${timeShort}`; 

    const order = await razorpay.orders.create({
        amount: PRICE_PAISE,
        currency: "INR",
        receipt,
        notes: { userId: String(user._id), clerkUserId }
    });

    // const order = await razorpay.orders.create({
    //   amount: PRICE_PAISE,
    //   currency: "INR",
    //   receipt: `appfolio_pro_${user._id}_${Date.now()}`,
    //   notes: { userId: String(user._id), clerkUserId }
    // });

    return reply.send({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  });

  // Verify payment
  app.post("/verify-payment", { preHandler: app.requireAuth }, async (req: any, reply) => {
    const clerkUserId = req.auth.clerkUserId;
    const user = await UserModel.findOne({ clerkUserId });
    if (!user) return reply.code(401).send({ message: "Unauthorized" });

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return reply.code(400).send({ message: "Missing payment fields" });
    }

    // Signature verification
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return reply.code(400).send({ message: "Invalid signature" });
    }

    // Upgrade user
    user.plan = "PRO";
    user.planPurchasedAt = new Date();
    await user.save();

    return reply.send({ success: true, plan: user.plan });
  });
}