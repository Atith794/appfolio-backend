// import { UserModel } from "../models/user.model.ts";
// import { AppModel } from "../models/app.model.ts";

// export default async function publicRoutes(app: any) {
//   // GET /public/u/:username
//   app.get("/u/:username", async (req: any, reply: any) => {
//     const { username } = req.params;

//     const user = await UserModel.findOne({ username }).lean();
//     if (!user) return reply.code(404).send({ message: "User not found" });

//     const apps = await AppModel.find({
//       userId: user._id,
//       visibility: { $in: ["PUBLIC", "UNLISTED"] }
//     })
//       .sort({ createdAt: -1 })
//       .lean();

//     return { user, apps };
//   });

//   // GET /public/u/:username/:slug
//   app.get("/u/:username/:slug", async (req: any, reply: any) => {
//     const { username, slug } = req.params;
//     console.log("Params received:", req.params);
//     const user = await UserModel.findOne({ username }).lean();
//     if (!user) return reply.code(404).send({ message: "User not found" });

//     const appDoc = await AppModel.findOne({
//       userId: user._id,
//       slug,
//       visibility: { $in: ["PUBLIC", "UNLISTED"] }
//     }).lean();

//     if (!appDoc) return reply.code(404).send({ message: "App not found" });

//     return { user, app: appDoc };
//   });
// }


import { UserModel } from "../models/user.model.ts";
import { AppModel } from "../models/app.model.ts";

function sanitizePublicApp(appDoc: any, plan: string) {
  // Always safe / always public fields (keep what you want visible for FREE)
  const safeApp: any = {
    _id: appDoc._id,
    userId: appDoc.userId,
    name: appDoc.name,
    slug: appDoc.slug,
    shortDescription: appDoc.shortDescription,
    platform: appDoc.platform,
    category: appDoc.category,
    status: appDoc.status,
    links: appDoc.links,
    appIconUrl: appDoc.appIconUrl,
    coverImageUrl: appDoc.coverImageUrl,

    // Free-visible sections
    screenshots: appDoc.screenshots || [],
    screenshotGroups: appDoc.screenshotGroups || [], // (optional; public grouping maybe PRO later)
    techStack: appDoc.techStack || {},
    overviewBullets: appDoc.overviewBullets || [],
    challengesIntro: appDoc.challengesIntro || "",
    challengesBullets: appDoc.challengesBullets || [],

    // Visibility
    visibility: appDoc.visibility,
    createdAt: appDoc.createdAt,
    updatedAt: appDoc.updatedAt,
  };

  // If you want screenshot grouping on public only for PRO, do this:
  if (plan !== "PRO") {
    safeApp.screenshotGroups = [];
    safeApp.screenshots = (safeApp.screenshots || []).map((s: any) => ({ ...s, groupKey: "" }));
  }

  // Premium-only: include ONLY for PRO
  if (plan === "PRO") {
    safeApp.architectureDiagramImageUrl = appDoc.architectureDiagramImageUrl || "";
    safeApp.integrations = appDoc.integrations || { intro: "", items: [] };
    safeApp.userFlowWalkthroughs = appDoc.userFlowWalkthroughs || null;

    // if you also consider these premium in public:
    safeApp.userFlowDiagram = appDoc.userFlowDiagram || null;
    safeApp.userFlowText = appDoc.userFlowText || null;
    safeApp.architectureDiagram = appDoc.architectureDiagram || null;
  }

  // Optional: flags (lets you show “locked preview” CTA without sending the content)
  safeApp.lockedFlags = {
    hasArchitecture: !!appDoc.architectureDiagramImageUrl,
    hasIntegrations: !!(appDoc.integrations?.intro || (appDoc.integrations?.items || []).length),
    hasUserFlow: !!(appDoc.userFlowWalkthroughs?.flows?.length),
  };

  return safeApp;
}

export default async function publicRoutes(app: any) {
  // GET /public/u/:username
  app.get("/u/:username", async (req: any, reply: any) => {
    const { username } = req.params;

    const user = await UserModel.findOne({ username }).lean();
    if (!user) return reply.code(404).send({ message: "User not found" });

    const apps = await AppModel.find({
      userId: user._id,
      visibility: { $in: ["PUBLIC", "UNLISTED"] }
    })
      .sort({ createdAt: -1 })
      .lean();

    // Optional: You might also want to sanitize apps list (don’t send huge objects)
    const safeApps = apps.map((a: any) => ({
      _id: a._id,
      name: a.name,
      slug: a.slug,
      shortDescription: a.shortDescription,
      platform: a.platform,
      coverImageUrl: a.coverImageUrl,
      appIconUrl: a.appIconUrl,
      visibility: a.visibility,
      createdAt: a.createdAt,
    }));

    return {
      user: {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        // add anything else you want public here
      },
      apps: safeApps,
      meta: { plan: user.plan }, // ✅ useful if you ever want to show badge on profile list
    };
  });

  // GET /public/u/:username/:slug
  app.get("/u/:username/:slug", async (req: any, reply: any) => {
    const { username, slug } = req.params;

    const user = await UserModel.findOne({ username }).lean();
    if (!user) return reply.code(404).send({ message: "User not found" });

    const appDoc = await AppModel.findOne({
      userId: user._id,
      slug,
      visibility: { $in: ["PUBLIC", "UNLISTED"] }
    }).lean();

    if (!appDoc) return reply.code(404).send({ message: "App not found" });

    const safeApp = sanitizePublicApp(appDoc, user.plan);

    return {
      user: {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
      },
      app: safeApp,
      meta: { plan: user.plan }, // ✅ critical for public page gating
    };
  });
}
