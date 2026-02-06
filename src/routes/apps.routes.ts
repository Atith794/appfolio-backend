import { z } from "zod";
import { UserModel } from "../models/user.model";
import { AppModel } from "../models/app.model";
import { slugify } from "../utils/slug.js";
import { Types } from "mongoose";
import axios from "axios";
import { generateCover } from "../utils/generateCover.js";
import { v2 as cloudinary } from "cloudinary";
import { getScreenshotLimit } from "../utils/limits.js";

const createAppSchema = z.object({
  name: z.string().min(2),
  // slug: z.string().min(2), // for now user provides; later you auto-slugify
  shortDescription: z.string().optional(),
  platform: z.array(z.enum(["ANDROID", "IOS"])).optional()
});

const screenshotSchema = z.object({
  url: z.string().url(),
  width: z.number(),
  height: z.number()
});

const reorderSchema = z.object({
  screenshotIds: z.array(z.string().min(1)).min(1)
});

const stepCreateSchema = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  imageUrl: z.string().url().optional(),
  tags: z.array(z.string().min(1).max(20)).optional()
});

const stepUpdateSchema = stepCreateSchema.partial();

const reorderStepsSchema = z.object({
  stepIds: z.array(z.string().min(1)).min(1)
});

const updateScreenshotSchema = z.object({
  url: z.string().url().optional(),
  width: z.number().optional(),
  height: z.number().optional()
});

const appHeroSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  platform: z.array(z.enum(["ANDROID", "IOS", "WINDOWS"])).min(1).max(3).optional(),
  appIconUrl: z.string().url().optional().or(z.literal("")),
});

const appOverviewSchema = z.object({
  bullets: z
    .array(z.string().trim().min(2).max(120))
    .min(3, "Add at least 3 bullet points")
    .max(5, "Maximum 5 bullet points"),
});

const challengesSchema = z.object({
  intro: z.string().trim().max(600).optional().or(z.literal("")),
  bullets: z
    .array(z.string().trim().min(2).max(160))
    .min(2, "Add at least 2 bullet points")
    .max(8, "Maximum 8 bullet points"),
});

const architectureDiagramSchema = z.object({
  nodes: z.array(z.any()),
  edges: z.array(z.any()),
  viewport: z
    .object({
      x: z.number(),
      y: z.number(),
      zoom: z.number(),
    })
    .optional(),
});

const architectureDiagramImageSchema = z.object({
  imageUrl: z.string().url(),
});

export default async function appsRoutes(app: any) {
  // List my apps
  app.get("/", { preHandler: app.requireAuth }, async (req: any) => {
    const clerkUserId = req.auth.clerkUserId;

    const user = await UserModel.findOne({ clerkUserId }).lean();
    if (!user) return { apps: [] };

    const apps = await AppModel.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .lean();

    return { user, apps };
  });

  // Create app (auto-creates user if missing)
  app.post("/", { preHandler: app.requireAuth }, async (req: any, reply: any) => {
    const clerkUserId = req.auth.clerkUserId;
    const parsed = createAppSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    const { name, shortDescription, platform } = parsed.data;

    const baseSlug = slugify(name);
    let slug = baseSlug || "app";
    let user = await UserModel.findOne({ clerkUserId });
    if (!user) {
      // Minimal user bootstrap (you’ll set username during onboarding)
      return reply.code(400).send({
        message: "User profile not created. Set username first."
      });
    }

    // ensure unique per user: try slug, slug-2, slug-3...
    for (let i = 0; i < 20; i++) {
      const exists = await AppModel.exists({ userId: user._id, slug });
      if (!exists) break;
      slug = `${baseSlug}-${i + 2}`;
    }

    const created = await AppModel.create({
      userId: user._id,
      name,
      slug,
      shortDescription: shortDescription || "",
      platform: platform || ["ANDROID"]
    });

    return reply.code(201).send({ app: created });
  });

  //Screenshot upload route
  app.post(
    "/:appId/screenshots",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = screenshotSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const clerkUserId = req.auth.clerkUserId;
      const user = await UserModel.findOne({ clerkUserId });
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const limit = getScreenshotLimit(user.plan);
      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id
      });

      if (!appDoc) return reply.code(404).send({ message: "App not found" });
      // ✅ LIMIT ENFORCEMENT
      if (appDoc.screenshots.length >= limit) {
        console.log("Limit reached",limit,user.plan)
        return reply.code(403).send({
          code: "SCREENSHOT_LIMIT_REACHED",
          message: user.plan === 'FREE'?`Screenshot limit reached (${limit}). Upgrade to Pro to add more.`:`Screenshot limit reached. More screenshots would be overwhelming for the person who visits your profile`
        });
      }

      const order = appDoc.screenshots.length + 1;

      appDoc.screenshots.push({
        url: parsed.data.url,
        width: parsed.data.width,
        height: parsed.data.height,
        order
      });

      await appDoc.save();

      return { screenshots: appDoc.screenshots };
    }
  );

  //Get the screenshots list
  app.get(
    "/:appId",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const clerkUserId = req.auth.clerkUserId;
      
      const user = await UserModel.findOne({ clerkUserId }).lean();
      if (!user) return reply.code(401).send({ message: "Unauthorized" });

      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id
      }).lean();

      const screenshotLimit = getScreenshotLimit(user.plan);
      const screenshotsUsed = appDoc?.screenshots?.length || 0;

      if (!appDoc) return reply.code(404).send({ message: "App not found" });

      return { 
        app: appDoc,
        meta: {
          plan: user.plan,
          screenshotLimit,
          screenshotsUsed
        } 
      };
    }
  );

  //Reorder the screenshots
  app.patch(
    "/:appId/screenshots/reorder",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = reorderSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const clerkUserId = req.auth.clerkUserId;
      const user = await UserModel.findOne({ clerkUserId });
      if (!user) return reply.code(401).send({ message: "Unauthorized" });

      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id
      });

      if (!appDoc) return reply.code(404).send({ message: "App not found" });

      const currentIds = new Set(appDoc.screenshots.map((s: any) => String(s._id)));
      for (const id of parsed.data.screenshotIds) {
        if (!currentIds.has(id)) {
          return reply.code(400).send({ message: "Invalid screenshot id in reorder list" });
        }
      }

      const orderMap = new Map(parsed.data.screenshotIds.map((id, idx) => [id, idx + 1]));
      appDoc.screenshots.forEach((s: any) => {
        const newOrder = orderMap.get(String(s._id));
        if (newOrder) s.order = newOrder;
      });

      // Sort array in document order too (nice for consistent reads)
      appDoc.screenshots.sort((a: any, b: any) => a.order - b.order);

      await appDoc.save();

      return { screenshots: appDoc.screenshots };
    }
  );

  // helper to load user + app
  async function getOwnedApp(req: any, reply: any) {
    const clerkUserId = req.auth.clerkUserId;
    const user = await UserModel.findOne({ clerkUserId });
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return null;
    }

    const appDoc = await AppModel.findOne({
      _id: new Types.ObjectId(req.params.appId),
      userId: user._id
    });

    if (!appDoc) {
      reply.code(404).send({ message: "App not found" });
      return null;
    }

    return appDoc;
  }

  // POST add step
  app.post(
    "/:appId/walkthrough",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = stepCreateSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const appDoc = await getOwnedApp(req, reply);
      if (!appDoc) return;

      const order = appDoc.walkthrough.length + 1;

      appDoc.walkthrough.push({
        order,
        title: parsed.data.title,
        description: parsed.data.description || "",
        imageUrl: parsed.data.imageUrl,
        tags: parsed.data.tags || []
      });

      appDoc.walkthrough.sort((a: any, b: any) => a.order - b.order);
      await appDoc.save();

      return { walkthrough: appDoc.walkthrough };
    }
  );

  // PATCH update step
  app.patch(
    "/:appId/walkthrough/:stepId",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = stepUpdateSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const appDoc = await getOwnedApp(req, reply);
      if (!appDoc) return;

      const step = appDoc.walkthrough.id(req.params.stepId);
      if (!step) return reply.code(404).send({ message: "Step not found" });

      if (parsed.data.title !== undefined) step.title = parsed.data.title;
      if (parsed.data.description !== undefined) step.description = parsed.data.description;
      if (parsed.data.imageUrl !== undefined) step.imageUrl = parsed.data.imageUrl;
      if (parsed.data.tags !== undefined) step.tags = parsed.data.tags;

      await appDoc.save();
      return { walkthrough: appDoc.walkthrough };
    }
  );

  // DELETE step
  app.delete(
    "/:appId/walkthrough/:stepId",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const appDoc = await getOwnedApp(req, reply);
      if (!appDoc) return;

      const step = appDoc.walkthrough.id(req.params.stepId);
      if (!step) return reply.code(404).send({ message: "Step not found" });

      step.deleteOne();

      // re-number orders
      appDoc.walkthrough
        .sort((a: any, b: any) => a.order - b.order)
        .forEach((s: any, idx: number) => (s.order = idx + 1));

      await appDoc.save();
      return { walkthrough: appDoc.walkthrough };
    }
  );

  // PATCH reorder steps
  app.patch(
    "/:appId/walkthrough/reorder",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = reorderStepsSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const appDoc = await getOwnedApp(req, reply);
      if (!appDoc) return;

      const currentIds = new Set(appDoc.walkthrough.map((s: any) => String(s._id)));
      for (const id of parsed.data.stepIds) {
        if (!currentIds.has(id)) {
          return reply.code(400).send({ message: "Invalid step id in reorder list" });
        }
      }

      const orderMap = new Map(parsed.data.stepIds.map((id, idx) => [id, idx + 1]));
      appDoc.walkthrough.forEach((s: any) => {
        const newOrder = orderMap.get(String(s._id));
        if (newOrder) s.order = newOrder;
      });

      appDoc.walkthrough.sort((a: any, b: any) => a.order - b.order);
      await appDoc.save();

      return { walkthrough: appDoc.walkthrough };
    }
  );

  //Generate cover image
  app.post(
    "/:appId/generate-cover",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const appDoc = await getOwnedApp(req, reply);
      if (!appDoc) return;

      const user = await UserModel.findById(appDoc.userId);
      if (!user) return reply.code(404).send({ message: "User not found" });

      let screenshotBuffer: Buffer | undefined;

      if (appDoc.screenshots.length) {
        const first = appDoc.screenshots.sort((a: any, b: any) => a.order - b.order)[0];
        const img = await axios.get(first.url, { responseType: "arraybuffer" });
        screenshotBuffer = Buffer.from(img.data);
      }

      const buffer = await generateCover({
        title: appDoc.name,
        subtitle: `by ${user.username}`,
        screenshotBuffer
      });

      const upload = await cloudinary.uploader.upload_stream(
        { folder: "appfolio/covers" },
        async (err, result) => {
          if (err || !result) throw err;
          appDoc.coverImageUrl = result.secure_url;
          await appDoc.save();
          reply.send({ coverImageUrl: result.secure_url });
        }
      );

      upload.end(buffer);
    }
  );

  //Screenshot crop
  app.patch(
    "/:appId/screenshots/:screenshotId",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = updateScreenshotSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const clerkUserId = req.auth.clerkUserId;
      const user = await UserModel.findOne({ clerkUserId });
      if (!user) return reply.code(401).send({ message: "Unauthorized" });

      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id
      });

      if (!appDoc) return reply.code(404).send({ message: "App not found" });

      const shot = appDoc.screenshots.id(req.params.screenshotId);
      if (!shot) return reply.code(404).send({ message: "Screenshot not found" });

      if (parsed.data.url !== undefined) shot.url = parsed.data.url;
      if (parsed.data.width !== undefined) shot.width = parsed.data.width;
      if (parsed.data.height !== undefined) shot.height = parsed.data.height;

      await appDoc.save();
      return { screenshots: appDoc.screenshots };
    }
  );

  //Delete screenshots
  app.delete(
    "/:appId/screenshots/:screenshotId",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const clerkUserId = req.auth.clerkUserId;
      const user = await UserModel.findOne({ clerkUserId });
      if (!user) return reply.code(401).send({ message: "Unauthorized" });

      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id
      });

      if (!appDoc) return reply.code(404).send({ message: "App not found" });

      const shot = appDoc.screenshots.id(req.params.screenshotId);
      if (!shot) return reply.code(404).send({ message: "Screenshot not found" });

      // remove
      shot.deleteOne();

      // re-number order after delete
      appDoc.screenshots
        .sort((a: any, b: any) => a.order - b.order)
        .forEach((s: any, idx: number) => (s.order = idx + 1));

      await appDoc.save();
      return { screenshots: appDoc.screenshots };
    }
  );

  //Add app hero section
  app.patch(
    "/:appId/hero",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = appHeroSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const clerkUserId = req.auth.clerkUserId;
      const user = await UserModel.findOne({ clerkUserId });
      if (!user) return reply.code(401).send({ message: "Unauthorized" });

      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id,
      });

      if (!appDoc) return reply.code(404).send({ message: "App not found" });

      const { name, platform, appIconUrl } = parsed.data;

      if (name !== undefined) appDoc.name = name;
      if (platform !== undefined) appDoc.platform = platform;
      if (appIconUrl !== undefined) appDoc.appIconUrl = appIconUrl;

      await appDoc.save();

      return { app: appDoc };
    }
  );

  //Add app overview section
  app.patch(
    "/:appId/overview",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = appOverviewSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const clerkUserId = req.auth.clerkUserId;
      const user = await UserModel.findOne({ clerkUserId });
      if (!user) return reply.code(401).send({ message: "Unauthorized" });

      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id,
      });

      if (!appDoc) return reply.code(404).send({ message: "App not found" });

      // sanitize: remove empty + trim (extra safe)
      const cleaned = parsed.data.bullets
        .map((b) => b.trim())
        .filter(Boolean);

      appDoc.overviewBullets = cleaned;

      await appDoc.save();
      return { app: appDoc };
    }
  );

  //Add challenges and tradeoffs
  app.patch(
    "/:appId/challenges",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = challengesSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const clerkUserId = req.auth.clerkUserId;
      const user = await UserModel.findOne({ clerkUserId });
      if (!user) return reply.code(401).send({ message: "Unauthorized" });

      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id,
      });

      if (!appDoc) return reply.code(404).send({ message: "App not found" });

      const intro = (parsed.data.intro ?? "").trim();

      const bullets = parsed.data.bullets
        .map((b) => b.trim())
        .filter(Boolean)
        .slice(0, 8);

      appDoc.challengesIntro = intro;
      appDoc.challengesBullets = bullets;

      await appDoc.save();
      return { app: appDoc };
    }
  );

  // Architecture diagram
  app.patch(
    "/:appId/architecture-diagram",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = architectureDiagramSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const clerkUserId = req.auth.clerkUserId;
      const user = await UserModel.findOne({ clerkUserId });
      if (!user) return reply.code(401).send({ message: "Unauthorized" });

      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id,
      });

      if (!appDoc) return reply.code(404).send({ message: "App not found" });

      appDoc.architectureDiagram = {
        version: 1,
        nodes: parsed.data.nodes,
        edges: parsed.data.edges,
        viewport: parsed.data.viewport,
      };

      await appDoc.save();
      return { success: true };
    }
  );

  // Export architecture diagram
  app.patch(
    "/:appId/architecture-diagram/image",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = architectureDiagramImageSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

      const clerkUserId = req.auth.clerkUserId;
      const user = await UserModel.findOne({ clerkUserId });
      if (!user) return reply.code(401).send({ message: "Unauthorized" });

      const appDoc = await AppModel.findOne({
        _id: new Types.ObjectId(req.params.appId),
        userId: user._id,
      });

      if (!appDoc) return reply.code(404).send({ message: "App not found" });

      appDoc.architectureDiagramImageUrl = parsed.data.imageUrl;
      await appDoc.save();

      return { success: true, imageUrl: appDoc.architectureDiagramImageUrl };
    }
  );
}