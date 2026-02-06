import mongoose, { Schema } from "mongoose";

const LinksSchema = new Schema(
  {
    github: String,
    linkedin: String,
    website: String
  },
  { _id: false }
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
    plan: { type: String, enum: ["FREE", "PRO"], default: "FREE" },
    planStatus: { type: String, default: "ACTIVE" },
    planValidUntil: { type: Date },
    planPurchasedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

export const UserModel =
  mongoose.models.User || mongoose.model("User", UserSchema);
