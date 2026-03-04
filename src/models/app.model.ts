import mongoose, { Schema, Types } from "mongoose";
import { z } from 'zod';

const iconRefSchema = z.object({
  key: z.string().min(1),
  name: z.string().optional().default(""),
  category: z.string().optional().default(""),
});

const stepSchema = z.object({
  kind: z.enum(["NODE", "ARROW"]),
  order: z.number().int().min(0),
  color: z.string().min(1).default("blue"),

  // NODE
  label: z.string().optional(),
  desc: z.string().optional().default(""),
  iconType: z.enum(["EMOJI", "TECH", "IMAGE"]).optional().default("EMOJI"),
  icon: z.string().optional().default(""),
  iconRef: iconRefSchema.optional(),

  // ARROW
  text: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.kind === "NODE") {
    if (!v.label?.trim()) ctx.addIssue({ code: "custom", message: "NODE requires label" });

    if (v.iconType === "TECH" && !v.iconRef?.key) {
      ctx.addIssue({ code: "custom", message: "TECH icon requires iconRef.key" });
    }
    if (v.iconType === "EMOJI" && !v.icon?.trim()) {
      // optional: you can allow empty emoji; but UX is nicer if required
    }
    if (v.iconType === "IMAGE" && v.icon && !/^https?:\/\//.test(v.icon)) {
      ctx.addIssue({ code: "custom", message: "IMAGE icon must be a URL" });
    }
  }

  if (v.kind === "ARROW") {
    if (!v.text?.trim()) ctx.addIssue({ code: "custom", message: "ARROW requires text" });
  }
});

const flowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  emoji: z.string().optional().default(""),
  order: z.number().int().min(0),
  steps: z.array(stepSchema).default([]),
});

export const userFlowWalkthroughsSchema = z.object({
  intro: z.string().optional().default(""),
  flows: z.array(flowSchema).max(12).default([]),
});

const ScreenshotSchema = new Schema(
  {
    url: { type: String, required: true },
    width: Number,
    height: Number,
    order: { type: Number, required: true },
    caption: String,
    groupKey: { type: String, default: "" },
  },
  { _id: true }
);

const ScreenshotGroupSchema = new Schema(
  {
    key: { type: String, required: true },     // e.g. "onboarding", "home"
    title: { type: String, required: true },   // e.g. "Onboarding"
    description: { type: String, default: "" } // small text under title
  },
  { _id: false }
);

const WalkthroughStepSchema = new Schema(
  {
    order: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    imageUrl: String,
    tags: { type: [String], default: [] }
  },
  { _id: true }
);

const LinksSchema = new Schema(
  {
    github: String,
    liveDemo: String,
    expo: String,
    playStore: String,
    appStore: String
  },
  { _id: false }
);

const IntegrationKVSchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: String, required: true },
  },
  { _id: false }
);

const AppSchema = new Schema(
  {
    userId: { type: Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    shortDescription: { type: String, default: "" },
    longDescription: { type: String, default: "" },
    overviewBullets: { type: [String], default: [] },
    challengesIntro: { type: String, default: "" },
    challengesBullets: { type: [String], default: [] },
    platform: { type: [String], default: ["ANDROID"] },
    status: { type: String, default: "MVP" },
    category: { type: String, default: "" },
    coverImageUrl: { type: String, default: "" },
    appIconUrl: { type: String, default: "" },
    highlightTags: { type: [String], default: [] },
    links: { type: LinksSchema, default: {} },
    screenshots: { type: [ScreenshotSchema], default: [] },
    screenshotGroups: { type: [ScreenshotGroupSchema], default: [] },
    walkthrough: { type: [WalkthroughStepSchema], default: [] },
    visibility: { type: String, enum: ["PUBLIC", "UNLISTED", "PRIVATE"], default: "PUBLIC" },
    architectureDiagram: {
      version: { type: Number, default: 1 },
      nodes: { type: Array, default: [] },
      edges: { type: Array, default: [] },
      viewport: {
        x: Number,
        y: Number,
        zoom: Number
      }
    },
    architectureDiagramImageUrl: { 
      type: String, default: "" 
    },
    userFlowDiagram: {
      version: { type: Number, default: 1 },
      nodes: { type: Array, default: [] },
      edges: { type: Array, default: [] },
      viewport: {
        x: Number,
        y: Number,
        zoom: Number
      }
    },
    userFlowText: {
      mode: { type: String, enum: ["TEXT", "DIAGRAM", "BOTH"], default: "BOTH" },
      bullets: { type: [String], default: [] }
    },
    techStack: {
      frontend: { type: [String], default: [] },
      backend: { type: [String], default: [] },
      database: { type: [String], default: [] },
      infra: { type: [String], default: [] },
    },
    integrations: {
      intro: { type: String, default: "" }, // optional short line
      items: { type: [IntegrationKVSchema], default: [] },
    },
    userFlowWalkthroughs: {
      intro: { type: String, default: "" },
      flows: {
        type: [
          {
            id: { type: String, required: true },
            title: { type: String, required: true },
            emoji: { type: String, default: "" },
            order: { type: Number, required: true },

            steps: {
              type: [
                {
                  kind: { type: String, enum: ["NODE", "ARROW"], required: true },
                  order: { type: Number, required: true },

                  label: { type: String, default: "" },
                  desc: { type: String, default: "" },

                  iconType: {
                    type: String,
                    enum: ["EMOJI", "TECH", "IMAGE"],
                    default: "EMOJI",
                  },

                  icon: { type: String, default: "" }, // emoji or image url

                  iconRef: {
                    id: { type: String, default: "" },       // tech id
                    name: { type: String, default: "" },     // snapshot
                    category: { type: String, default: "" }, // snapshot
                  },

                  text: { type: String, default: "" }, // arrow text
                  color: { type: String, default: "blue" },
                },
              ],
              default: [],
            },
          },
        ],
        default: [],
      },
    },
  },
  { timestamps: true }
);

AppSchema.index({ userId: 1, slug: 1 }, { unique: true });

export const AppModel =
  mongoose.models.App || mongoose.model("App", AppSchema);
