import { UserModel } from "../models/user.model.js";

interface OnboardInput {
  clerkUserId: string;
  email: string;
  username: string;
  displayName?: string;
  headline?: string;
}

export async function onboardUser(input: OnboardInput) {
  const existing = await UserModel.findOne({
    $or: [
      { clerkUserId: input.clerkUserId },
      { username: input.username }
    ]
  });

  if (existing) {
    if (existing.username === input.username) {
      throw new Error("USERNAME_TAKEN");
    }
    throw new Error("USER_ALREADY_ONBOARDED");
  }

  const user = await UserModel.create({
    clerkUserId: input.clerkUserId,
    email: input.email,
    username: input.username,
    displayName: input.displayName || "",
    headline: input.headline || ""
  });

  return user;
}

export async function getUserByClerkId(clerkUserId: string) {
  return UserModel.findOne({ clerkUserId }).lean();
}
