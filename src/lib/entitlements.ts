export function isProEntitled(user: any) {
  if (!user) return false;

  // Must be PRO
  if (user.plan !== "PRO") return false;

  // Active/trialing counts
  if (user.planStatus === "ACTIVE" || user.planStatus === "TRIALING") return true;

  // Allow access until end of paid period
  if (user.planValidUntil) {
    const t = new Date(user.planValidUntil).getTime();
    if (!Number.isNaN(t) && t > Date.now()) return true;
  }

  return false;
}

export function effectivePlan(user: any): "FREE" | "PRO" {
  return isProEntitled(user) ? "PRO" : "FREE";
}