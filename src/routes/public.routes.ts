import { UserModel } from "../models/user.model.js";
import { AppModel } from "../models/app.model.js";
import { effectivePlan } from "../lib/entitlements.js";
import { Types } from "mongoose";

type LeanPublicUser = {
  _id: Types.ObjectId;
  username: string;
  displayName?: string;
  bio?: string;
  plan: "FREE" | "PRO";
  planStatus?: string;
};

function sanitizePublicApp(appDoc: any, plan: string) {
  const isPro = plan === "PRO";

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
    screenshotGroups: appDoc.screenshotGroups || [],
    techStack: appDoc.techStack || {},
    overviewBullets: appDoc.overviewBullets || [],
    challengesIntro: appDoc.challengesIntro || "",
    challengesBullets: appDoc.challengesBullets || [],

    // Visibility
    visibility: appDoc.visibility,
    createdAt: appDoc.createdAt,
    updatedAt: appDoc.updatedAt,
  };

  // FREE: hide public grouping
  if (!isPro) {
    safeApp.screenshotGroups = [];
    safeApp.screenshots = (safeApp.screenshots || []).map((s: any) => ({ ...s, groupKey: "" }));
  }

  // PRO: include premium sections
  if (isPro) {
    safeApp.architectureDiagramImageUrl = appDoc.architectureDiagramImageUrl || "";
    safeApp.integrations = appDoc.integrations || { intro: "", items: [] };
    safeApp.userFlowWalkthroughs = appDoc.userFlowWalkthroughs || null;

    safeApp.userFlowDiagram = appDoc.userFlowDiagram || null;
    safeApp.userFlowText = appDoc.userFlowText || null;
    safeApp.architectureDiagram = appDoc.architectureDiagram || null;
  } else {
    // FREE: send "preview stubs" (no sensitive content)

    // 1) Architecture preview — only indicate locked + optionally provide a blurred thumbnail URL if you have one
    safeApp.architectureDiagramPreview = {
      locked: true,
      // If you can generate/store a blurred thumbnail in future, put it here:
      // imageUrl: appDoc.architectureDiagramImageUrl ? makeBlurUrl(appDoc.architectureDiagramImageUrl) : null
      imageUrl: null,
      hint: "Unlock Pro to view architecture diagram",
    };

    // 2) Integrations preview — keep intro length tiny + mask items
    const items = (appDoc.integrations?.items || []) as any[];
    safeApp.integrationsPreview = {
      locked: true,
      intro: appDoc.integrations?.intro ? String(appDoc.integrations.intro).slice(0, 90) + "…" : "",
      items: items.slice(0, 2).map((it) => ({
        key: it?.key ? String(it.key) : "Integration",
        value: "Locked (Pro)",
      })),
      hint: "Unlock Pro to view integrations & key decisions",
    };

    // 3) Userflow preview — only show flow names/titles (no steps)
    const flows = appDoc.userFlowWalkthroughs?.flows || [];
    safeApp.userFlowWalkthroughsPreview = {
      locked: true,
      flows: Array.isArray(flows)
        ? flows.slice(0, 2).map((f: any) => ({
            id: f?.id || null,
            title: f?.title ? String(f.title) : "User flow",
            // no steps here
          }))
        : [],
      hint: "Unlock Pro to view user flows",
    };
  }

  // Flags for the frontend to decide whether to show locked cards
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

    // const user = await UserModel.findOne({ username }).lean();
    const user = (await UserModel.findOne({ username }).lean()) as LeanPublicUser | null;
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

    // const user = await UserModel.findOne({ username }).lean();
    const user = (await UserModel.findOne({ username }).lean()) as LeanPublicUser | null;
    
    if (!user) return reply.code(404).send({ message: "User not found" });

    const plan = effectivePlan(user); // "FREE" | "PRO"

    const appDoc = await AppModel.findOne({
      userId: user._id,
      slug,
      visibility: { $in: ["PUBLIC", "UNLISTED"] },
    }).lean();

    if (!appDoc) return reply.code(404).send({ message: "App not found" });

    const safeApp = sanitizePublicApp(appDoc, plan);

    return {
      user: {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
      },
      app: safeApp,
      meta: { effectivePlan: plan },
    };
  });
}
