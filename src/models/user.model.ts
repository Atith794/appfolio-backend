import mongoose, { Schema } from "mongoose";

const LinksSchema = new Schema(
  {
    github: String,
    linkedin: String,
    website: String,
  },
  { _id: false },
);

const UserSchema = new Schema(
  {
    clerkUserId: { type: String, unique: true, sparse: true, index: true },
    email: { type: String, unique: true, index: true, required: true },
    username: { type: String, unique: true, index: true, required: true },
    displayName: { type: String, default: "" },
    headline: { type: String, default: "" },
    bio: { type: String, default: "" },
    links: { type: LinksSchema, default: {} },

    // Plan
    plan: {
      type: String,
      enum: ["FREE", "PRO"],
      default: "FREE",
    },
    planStatus: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "CANCELED", "PAST_DUE", "TRIALING"],
      default: "INACTIVE",
    },

    billingInterval: {
      type: String,
      enum: ["MONTHLY", "YEARLY"],
      default: null,
    },
    provider: { type: String, enum: ["razorpay", "stripe"], default: null },

    // Razorpay identifiers
    razorpaySubscriptionId: { type: String, default: null },

    // Stripe identifiers
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    planValidUntil: { type: Date, default: null },
    planPurchasedAt: {
      type: Date,
    },
    billingCountry: { type: String, default: null }, // "IN", "US", "GB", "DE"
    billingCurrency: { type: String, default: null }, // "INR", "USD", "GBP", "EUR"
    billingRegion: { type: String, default: null }, // "IN", "UK", "EU", "ROW"
    providerCustomerId: { type: String, default: null }, // optional common field
    cancelAtPeriodEnd: { type: Boolean, default: false },
    lastPaymentAt: { type: Date, default: null },
    lastWebhookEventId: { type: String, default: null },
    currentPeriodStart: { type: Date, default: null},
    subscriptionEndedAt: { type: Date, default: null},
    lastPaymentFailedAt: { type:Date, default: null },
    lastPaymentFailureReason: { type: String, default: null }
  },
  { timestamps: true },
);

export const UserModel =
  mongoose.models.User || mongoose.model("User", UserSchema);
