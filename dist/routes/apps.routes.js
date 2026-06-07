import { z } from "zod";
import { UserModel } from "../models/user.model.js";
import { AppModel } from "../models/app.model.js";
import { Types } from "mongoose";
import axios from "axios";
import { generateCover } from "../utils/generateCover.js";
import { v2 as cloudinary } from "cloudinary";
import { getScreenshotLimit } from "../utils/limits.js";
function isValidObjectId(id) {
    return Types.ObjectId.isValid(id);
}
function requirePro(user, reply) {
    if (user.plan !== "PRO") {
        reply.code(403).send({
            code: "PRO_REQUIRED",
            message: "Upgrade to Pro to group screenshots and add descriptions.",
        });
        return false;
    }
    return true;
}
const screenshotGroupCreateSchema = z
    .object({
    key: z
        .string()
        .min(2)
        .max(32)
        .regex(/^[a-z0-9-]+$/), // simple slug
    title: z.string().min(2).max(60),
    description: z.string().max(140).optional().default(""),
})
    .strict();
const screenshotGroupUpdateSchema = z
    .object({
    title: z.string().min(2).max(60).optional(),
    description: z.string().max(140).optional(),
})
    .strict();
const screenshotAssignGroupSchema = z
    .object({
    groupKey: z.string().max(32).optional().default(""), // "" => ungroup
})
    .strict();
const createAppSchema = z
    .object({
    name: z.string().min(2),
    // slug: z.string().min(2), // for now user provides; later you auto-slugify
    shortDescription: z.string().optional(),
    platform: z.array(z.enum(["ANDROID", "IOS"])).optional(),
})
    .strict();
function isAllowedCloudinaryUrl(url) {
    try {
        const parsed = new URL(url);
        return (parsed.protocol === "https:" &&
            parsed.hostname === "res.cloudinary.com" &&
            parsed.pathname.includes("/image/upload/"));
    }
    catch {
        return false;
    }
}
const screenshotSchema = z
    .object({
    url: z.string().url(),
    publicId: z.string().min(1).max(300),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive().max(5000),
    height: z.number().int().positive().max(5000),
})
    .strict();
const reorderSchema = z
    .object({
    screenshotIds: z.array(z.string().min(1)).min(1),
})
    .strict();
const stepCreateSchema = z
    .object({
    title: z.string().min(2).max(80),
    description: z.string().max(500).optional(),
    imageUrl: z.string().url().optional(),
    tags: z.array(z.string().min(1).max(20)).optional(),
})
    .strict();
const stepUpdateSchema = stepCreateSchema.partial();
const reorderStepsSchema = z
    .object({
    stepIds: z.array(z.string().min(1)).min(1),
})
    .strict();
const updateScreenshotSchema = z
    .object({
    url: z.string().url().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    groupKey: z.string().max(32).optional(),
})
    .strict();
const appHeroSchema = z
    .object({
    name: z.string().trim().min(2).max(80).optional(),
    platform: z
        .array(z.enum(["ANDROID", "IOS", "WINDOWS"]))
        .min(1)
        .max(3)
        .optional(),
    appIconUrl: z.string().url().optional().or(z.literal("")),
})
    .strict();
const appOverviewSchema = z
    .object({
    bullets: z
        .array(z.string().trim().min(2).max(120))
        .min(3, "Add at least 3 bullet points")
        .max(5, "Maximum 5 bullet points"),
})
    .strict();
const challengesSchema = z
    .object({
    intro: z.string().trim().max(600).optional().or(z.literal("")),
    bullets: z
        .array(z.string().trim().min(2).max(160))
        .min(2, "Add at least 2 bullet points")
        .max(8, "Maximum 8 bullet points"),
})
    .strict();
const architectureDiagramSchema = z
    .object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    viewport: z
        .object({
        x: z.number(),
        y: z.number(),
        zoom: z.number(),
    })
        .optional(),
})
    .strict();
const architectureDiagramImageSchema = z
    .object({
    imageUrl: z.string().url(),
})
    .strict();
const userFlowDiagramSchema = z
    .object({
    version: z.number().optional(),
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([]),
    viewport: z
        .object({
        x: z.number(),
        y: z.number(),
        zoom: z.number(),
    })
        .optional(),
})
    .strict();
const userFlowTextSchema = z
    .object({
    mode: z.enum(["TEXT", "DIAGRAM", "BOTH"]).default("BOTH"),
    bullets: z.array(z.string().min(1)).max(20).default([]),
})
    .strict();
const techStackSchema = z
    .object({
    frontend: z.array(z.string()).default([]),
    backend: z.array(z.string()).default([]),
    database: z.array(z.string()).default([]),
    infra: z.array(z.string()).default([]),
})
    .strict();
const integrationsSchema = z
    .object({
    intro: z.string().max(300).optional().default(""),
    items: z
        .array(z.object({
        key: z.string().min(1).max(40),
        value: z.string().min(1).max(80),
    }))
        .max(12)
        .default([]),
})
    .strict();
// const iconRefSchema = z.object({
//   id: z.string().min(1),
//   name: z.string().optional().default(""),
//   category: z.string().optional().default(""),
// });
const iconRefSchema = z.preprocess((val) => {
    if (!val || typeof val !== "object")
        return undefined;
    const v = val;
    if (!v.id || !String(v.id).trim())
        return undefined;
    return val;
}, z
    .object({
    id: z.string().min(1),
    name: z.string().optional().default(""),
    category: z.string().optional().default(""),
})
    .optional());
const stepSchema = z
    .object({
    kind: z.enum(["NODE", "ARROW"]),
    order: z.number().int().min(0),
    color: z.string().min(1),
    // NODE fields
    label: z.string().optional(),
    desc: z.string().optional(),
    icon: z.string().optional(),
    iconType: z.enum(["EMOJI", "IMAGE", "TECH"]).optional(),
    // iconRef: iconRefSchema.optional(),
    iconRef: iconRefSchema,
    // ARROW fields
    text: z.string().optional(),
})
    .superRefine((v, ctx) => {
    if (v.kind === "NODE" && !v.label)
        ctx.addIssue({ code: "custom", message: "NODE requires label" });
    if (v.kind === "ARROW" && !v.text)
        ctx.addIssue({ code: "custom", message: "ARROW requires text" });
});
const flowSchema = z
    .object({
    id: z.string().min(1),
    title: z.string().min(1),
    icon: z.string().optional(),
    order: z.number().int().min(0),
    steps: z.array(stepSchema).default([]),
})
    .strict();
function slugify(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}
function uniqueKey(base, existing) {
    if (!existing.has(base))
        return base;
    for (let i = 2; i <= 50; i++) {
        const k = `${base}-${i}`;
        if (!existing.has(k))
            return k;
    }
    return `${base}-${Date.now()}`;
}
export const userFlowWalkthroughsSchema = z
    .object({
    intro: z.string().optional(),
    flows: z.array(flowSchema).max(12).default([]),
})
    .strict();
export default async function appsRoutes(app) {
    // List my apps
    app.get("/", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 60,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const clerkUserId = req.auth.clerkUserId;
        // const user = await UserModel.findOne({ clerkUserId }).lean();
        const user = (await UserModel.findOne({
            clerkUserId,
        }).lean());
        if (!user) {
            return reply.code(404).send({ message: "User not found" });
        }
        const apps = await AppModel.findOne({ userId: user?._id })
            .sort({ createdAt: -1 })
            .lean();
        return { user, apps };
        // return {
        //   user:{
        //     id: user._id,
        //     username: user.username,
        //     displayName: user.displayName,
        //     plan: user.plan,
        //     planStatus: user.planStatus
        //   },
        //   apps
        // }
    });
    // Create app (auto-creates user if missing)
    app.post("/", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 10,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const clerkUserId = req.auth.clerkUserId;
        const parsed = createAppSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const { name, shortDescription, platform } = parsed.data;
        const baseSlug = slugify(name);
        let slug = baseSlug || "app";
        let user = await UserModel.findOne({ clerkUserId });
        if (!user) {
            // Minimal user bootstrap (you’ll set username during onboarding)
            return reply.code(400).send({
                message: "User profile not created. Set username first.",
            });
        }
        // ensure unique per user: try slug, slug-2, slug-3...
        for (let i = 0; i < 20; i++) {
            const exists = await AppModel.exists({ userId: user._id, slug });
            if (!exists)
                break;
            slug = `${baseSlug}-${i + 2}`;
        }
        const created = await AppModel.create({
            userId: user._id,
            name,
            slug,
            shortDescription: shortDescription || "",
            platform: platform || ["ANDROID"],
        });
        return reply.code(201).send({ app: created });
    });
    //Screenshot upload route
    app.post("/:appId/screenshots", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = screenshotSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        if (!isAllowedCloudinaryUrl(parsed.data.url)) {
            return reply.code(400).send({
                message: "Only Cloudinary image URLs are allowed",
            });
        }
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const limit = getScreenshotLimit(user.plan);
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        if (appDoc.screenshots.length >= limit) {
            return reply.code(403).send({
                code: "SCREENSHOT_LIMIT_REACHED",
                message: user.plan === "FREE"
                    ? `Screenshot limit reached (${limit}). Upgrade to Pro to add more.`
                    : `Screenshot limit reached. More screenshots would be overwhelming for the person who visits your profile`,
            });
        }
        const order = appDoc.screenshots.length + 1;
        appDoc.screenshots.push({
            url: parsed.data.url,
            publicId: parsed.data.publicId,
            fileHash: parsed.data.fileHash,
            width: parsed.data.width,
            height: parsed.data.height,
            order,
        });
        await appDoc.save();
        return { screenshots: appDoc.screenshots };
    });
    //Get the screenshots list
    app.get("/:appId", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 60,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const clerkUserId = req.auth.clerkUserId;
        // const user = await UserModel.findOne({ clerkUserId }).lean();
        const user = (await UserModel.findOne({
            clerkUserId,
        }).lean());
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        // const appDoc = await AppModel.findOne({
        //   _id: new Types.ObjectId(req.params.appId),
        //   userId: user._id,
        // }).lean();
        const appDoc = (await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        }).lean());
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        const screenshotLimit = getScreenshotLimit(user.plan);
        const screenshotsUsed = appDoc?.screenshots?.length || 0;
        return {
            app: appDoc,
            meta: {
                plan: user.plan,
                screenshotLimit,
                screenshotsUsed,
            },
        };
    });
    //Reorder the screenshots
    app.patch("/:appId/screenshots/reorder", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 35,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = reorderSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        const currentIds = new Set(appDoc.screenshots.map((s) => String(s._id)));
        for (const id of parsed.data.screenshotIds) {
            if (!currentIds.has(id)) {
                return reply
                    .code(400)
                    .send({ message: "Invalid screenshot id in reorder list" });
            }
        }
        const orderMap = new Map(parsed.data.screenshotIds.map((id, idx) => [id, idx + 1]));
        appDoc.screenshots.forEach((s) => {
            const newOrder = orderMap.get(String(s._id));
            if (newOrder)
                s.order = newOrder;
        });
        // Sort array in document order too (nice for consistent reads)
        appDoc.screenshots.sort((a, b) => a.order - b.order);
        await appDoc.save();
        return { screenshots: appDoc.screenshots };
    });
    // helper to load user + app
    async function getOwnedApp(req, reply) {
        const { appId } = req.params;
        if (!isValidObjectId(appId)) {
            reply.code(400).send({ message: "Invalid app ID" });
            return null;
        }
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user) {
            reply.code(401).send({ message: "Unauthorized" });
            return null;
        }
        // const appDoc = await AppModel.findOne({
        //   _id: new Types.ObjectId(req.params.appId),
        //   userId: user._id,
        // });
        const appDoc = await AppModel.findOne({
            _id: appId,
            userId: user._id,
        });
        if (!appDoc) {
            reply.code(404).send({ message: "App not found" });
            return null;
        }
        return { user, appDoc };
    }
    // POST add step
    app.post("/:appId/walkthrough", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = stepCreateSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const owned = await getOwnedApp(req, reply);
        if (!owned)
            return;
        const { user, appDoc } = owned;
        const order = appDoc.walkthrough.length + 1;
        appDoc.walkthrough.push({
            order,
            title: parsed.data.title,
            description: parsed.data.description || "",
            imageUrl: parsed.data.imageUrl,
            tags: parsed.data.tags || [],
        });
        appDoc.walkthrough.sort((a, b) => a.order - b.order);
        await appDoc.save();
        return { walkthrough: appDoc.walkthrough };
    });
    // PATCH update step
    app.patch("/:appId/walkthrough/:stepId", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 35,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = stepUpdateSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const owned = await getOwnedApp(req, reply);
        if (!owned)
            return;
        const { user, appDoc } = owned;
        const step = appDoc.walkthrough.id(req.params.stepId);
        if (!step)
            return reply.code(404).send({ message: "Step not found" });
        if (parsed.data.title !== undefined)
            step.title = parsed.data.title;
        if (parsed.data.description !== undefined)
            step.description = parsed.data.description;
        if (parsed.data.imageUrl !== undefined)
            step.imageUrl = parsed.data.imageUrl;
        if (parsed.data.tags !== undefined)
            step.tags = parsed.data.tags;
        await appDoc.save();
        return { walkthrough: appDoc.walkthrough };
    });
    // DELETE step
    app.delete("/:appId/walkthrough/:stepId", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const owned = await getOwnedApp(req, reply);
        if (!owned)
            return;
        const { user, appDoc } = owned;
        const step = appDoc.walkthrough.id(req.params.stepId);
        if (!step)
            return reply.code(404).send({ message: "Step not found" });
        step.deleteOne();
        // re-number orders
        appDoc.walkthrough
            .sort((a, b) => a.order - b.order)
            .forEach((s, idx) => (s.order = idx + 1));
        await appDoc.save();
        return { walkthrough: appDoc.walkthrough };
    });
    // PATCH reorder steps
    app.patch("/:appId/walkthrough/reorder", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = reorderStepsSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const owned = await getOwnedApp(req, reply);
        if (!owned)
            return;
        const { user, appDoc } = owned;
        const currentIds = new Set(appDoc.walkthrough.map((s) => String(s._id)));
        for (const id of parsed.data.stepIds) {
            if (!currentIds.has(id)) {
                return reply
                    .code(400)
                    .send({ message: "Invalid step id in reorder list" });
            }
        }
        const orderMap = new Map(parsed.data.stepIds.map((id, idx) => [id, idx + 1]));
        appDoc.walkthrough.forEach((s) => {
            const newOrder = orderMap.get(String(s._id));
            if (newOrder)
                s.order = newOrder;
        });
        appDoc.walkthrough.sort((a, b) => a.order - b.order);
        await appDoc.save();
        return { walkthrough: appDoc.walkthrough };
    });
    //Generate cover image
    app.post("/:appId/generate-cover", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const owned = await getOwnedApp(req, reply);
        if (!owned)
            return;
        const { appDoc } = owned;
        const user = await UserModel.findById(appDoc.userId);
        if (!user)
            return reply.code(404).send({ message: "User not found" });
        let screenshotBuffer;
        if (appDoc.screenshots.length) {
            const first = appDoc.screenshots.sort((a, b) => a.order - b.order)[0];
            const img = await axios.get(first.url, { responseType: "arraybuffer" });
            screenshotBuffer = Buffer.from(img.data);
        }
        const buffer = await generateCover({
            title: appDoc.name,
            subtitle: `by ${user.username}`,
            screenshotBuffer,
        });
        const upload = await cloudinary.uploader.upload_stream({ folder: "appfolio/covers" }, async (err, result) => {
            if (err || !result)
                throw err;
            appDoc.coverImageUrl = result.secure_url;
            await appDoc.save();
            reply.send({ coverImageUrl: result.secure_url });
        });
        upload.end(buffer);
    });
    //Screenshot crop
    app.patch("/:appId/screenshots/:screenshotId", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 30,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = updateScreenshotSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        const shot = appDoc.screenshots.id(req.params.screenshotId);
        if (!shot)
            return reply.code(404).send({ message: "Screenshot not found" });
        //Check if the user is a pro-user
        if (parsed.data.groupKey !== undefined) {
            if (!requirePro(user, reply))
                return;
            // if (user.plan !== "PRO") {
            //   return reply.code(403).send({
            //     code: "PRO_REQUIRED",
            //     message: "Upgrade to Pro to group screenshots.",
            //   });
            // }
            // validate group exists when assigning (unless ungroup "")
            const key = parsed.data.groupKey.trim();
            if (key !== "") {
                const exists = appDoc.screenshotGroups.some((g) => g.key === key);
                if (!exists)
                    return reply.code(400).send({ message: "Invalid groupKey" });
            }
            shot.groupKey = key;
        }
        if (parsed.data.url !== undefined)
            shot.url = parsed.data.url;
        if (parsed.data.width !== undefined)
            shot.width = parsed.data.width;
        if (parsed.data.height !== undefined)
            shot.height = parsed.data.height;
        await appDoc.save();
        return { screenshots: appDoc.screenshots };
    });
    //Delete screenshots
    app.delete("/:appId/screenshots/:screenshotId", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        const shot = appDoc.screenshots.id(req.params.screenshotId);
        if (!shot)
            return reply.code(404).send({ message: "Screenshot not found" });
        const publicId = shot.publicId;
        // remove
        shot.deleteOne();
        // re-number order after delete
        appDoc.screenshots
            .sort((a, b) => a.order - b.order)
            .forEach((s, idx) => (s.order = idx + 1));
        await appDoc.save();
        if (publicId) {
            try {
                await cloudinary.uploader.destroy(publicId);
            }
            catch (err) {
                req.log.error({ err, publicId }, "Failed to delete Cloudinary screenshot");
            }
            return { screenshots: appDoc.screenshots };
        }
    });
    //Add app hero section
    app.patch("/:appId/hero", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = appHeroSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        const { name, platform, appIconUrl } = parsed.data;
        if (name !== undefined)
            appDoc.name = name;
        if (platform !== undefined)
            appDoc.platform = platform;
        if (appIconUrl !== undefined)
            appDoc.appIconUrl = appIconUrl;
        await appDoc.save();
        return { app: appDoc };
    });
    //Add app overview section
    app.patch("/:appId/overview", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = appOverviewSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        // sanitize: remove empty + trim (extra safe)
        const cleaned = parsed.data.bullets.map((b) => b.trim()).filter(Boolean);
        appDoc.overviewBullets = cleaned;
        await appDoc.save();
        return { app: appDoc };
    });
    //Add challenges and tradeoffs
    app.patch("/:appId/challenges", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = challengesSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        const intro = (parsed.data.intro ?? "").trim();
        const bullets = parsed.data.bullets
            .map((b) => b.trim())
            .filter(Boolean)
            .slice(0, 8);
        appDoc.challengesIntro = intro;
        appDoc.challengesBullets = bullets;
        await appDoc.save();
        return { app: appDoc };
    });
    // Architecture diagram
    app.patch("/:appId/architecture-diagram", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = architectureDiagramSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        appDoc.architectureDiagram = {
            version: 1,
            nodes: parsed.data.nodes,
            edges: parsed.data.edges,
            viewport: parsed.data.viewport,
        };
        await appDoc.save();
        return { success: true };
    });
    // Export architecture diagram
    app.patch("/:appId/architecture-diagram/image", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = architectureDiagramImageSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        appDoc.architectureDiagramImageUrl = parsed.data.imageUrl;
        await appDoc.save();
        return { success: true, imageUrl: appDoc.architectureDiagramImageUrl };
    });
    app.patch("/:appId/user-flow-diagram", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = userFlowDiagramSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        appDoc.userFlowDiagram = {
            version: parsed.data.version ?? 1,
            nodes: parsed.data.nodes ?? [],
            edges: parsed.data.edges ?? [],
            viewport: parsed.data.viewport,
        };
        await appDoc.save();
        return { ok: true };
    });
    // Save Userflow diagram url
    app.patch("/:appId/user-flow-diagram/image", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = z
            .object({ imageUrl: z.string().url() })
            .safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        appDoc.userFlowDiagram = {
            ...appDoc.userFlowDiagram,
            imageUrl: parsed.data.imageUrl,
        };
        await appDoc.save();
        return { ok: true };
    });
    // Save Userflow text
    app.patch("/:appId/user-flow-text", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = userFlowTextSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        appDoc.userFlowText = {
            mode: parsed.data.mode,
            bullets: parsed.data.bullets,
        };
        await appDoc.save();
        return { ok: true, userFlowText: appDoc.userFlowText };
    });
    //Teck's
    app.patch("/:appId/tech-stack", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = techStackSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        appDoc.techStack = {
            frontend: parsed.data.frontend,
            backend: parsed.data.backend,
            database: parsed.data.database,
            infra: parsed.data.infra,
        };
        await appDoc.save();
        return { ok: true, techStack: appDoc.techStack };
    });
    //Integrations
    app.patch("/:appId/integrations", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = integrationsSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        // Normalize: trim, drop empty, de-dupe by key (keep last)
        const intro = (parsed.data.intro || "").trim();
        const map = new Map();
        for (const it of parsed.data.items) {
            const k = it.key.trim();
            const v = it.value.trim();
            if (!k || !v)
                continue;
            map.set(k, v);
        }
        const items = Array.from(map.entries()).map(([key, value]) => ({
            key,
            value,
        }));
        appDoc.integrations = { intro, items };
        await appDoc.save();
        return { ok: true, integrations: appDoc.integrations };
    });
    //Userflow Walkthrough
    app.patch("/:appId/user-flow-walkthroughs", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = userFlowWalkthroughsSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const clerkUserId = req.auth.clerkUserId;
        const user = await UserModel.findOne({ clerkUserId });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        const appDoc = await AppModel.findOne({
            _id: new Types.ObjectId(req.params.appId),
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        appDoc.userFlowWalkthroughs = parsed.data;
        await appDoc.save();
        return {
            ok: true,
            userFlowWalkthroughs: appDoc.userFlowWalkthroughs,
        };
    });
    app.post("/:appId/screenshot-groups", {
        preHandler: app.requireAuth,
        bodyLimit: 500 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = screenshotGroupCreateSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const user = await UserModel.findOne({
            clerkUserId: req.auth.clerkUserId,
        });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        if (!requirePro(user, reply))
            return;
        const appDoc = await AppModel.findOne({
            _id: req.params.appId,
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        const exists = appDoc.screenshotGroups.some((g) => g.key === parsed.data.key);
        if (exists)
            return reply.code(409).send({ message: "Group key already exists" });
        appDoc.screenshotGroups.push(parsed.data);
        await appDoc.save();
        return { screenshotGroups: appDoc.screenshotGroups };
    });
    app.patch("/:appId/screenshot-groups/:groupKey", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = screenshotGroupUpdateSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send(parsed.error.flatten());
        const user = await UserModel.findOne({
            clerkUserId: req.auth.clerkUserId,
        });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        if (!requirePro(user, reply))
            return;
        const appDoc = await AppModel.findOne({
            _id: req.params.appId,
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        const g = appDoc.screenshotGroups.find((x) => x.key === req.params.groupKey);
        if (!g)
            return reply.code(404).send({ message: "Group not found" });
        if (parsed.data.title !== undefined)
            g.title = parsed.data.title;
        if (parsed.data.description !== undefined)
            g.description = parsed.data.description;
        await appDoc.save();
        return { screenshotGroups: appDoc.screenshotGroups };
    });
    app.delete("/:appId/screenshot-groups/:groupKey", {
        preHandler: app.requireAuth,
        bodyLimit: 100 * 1024,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const user = await UserModel.findOne({
            clerkUserId: req.auth.clerkUserId,
        });
        if (!user)
            return reply.code(401).send({ message: "Unauthorized" });
        if (!requirePro(user, reply))
            return;
        const appDoc = await AppModel.findOne({
            _id: req.params.appId,
            userId: user._id,
        });
        if (!appDoc)
            return reply.code(404).send({ message: "App not found" });
        const key = req.params.groupKey;
        appDoc.screenshotGroups = appDoc.screenshotGroups.filter((g) => g.key !== key);
        // unassign screenshots
        appDoc.screenshots.forEach((s) => {
            if (s.groupKey === key)
                s.groupKey = "";
        });
        await appDoc.save();
        return {
            screenshotGroups: appDoc.screenshotGroups,
            screenshots: appDoc.screenshots,
        };
    });
}
