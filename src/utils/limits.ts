export function getScreenshotLimit(plan: "FREE" | "PRO" | string | undefined) {
  if (plan === "PRO") return 12;
  return 6;
}
