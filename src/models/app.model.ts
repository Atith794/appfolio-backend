import mongoose, { Schema, Types } from "mongoose";

const ScreenshotSchema = new Schema(
  {
    url: { type: String, required: true },
    width: Number,
    height: Number,
    order: { type: Number, required: true },
    caption: String
  },
  { _id: true }
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
    // userFlowDiagram: {
    //   nodes: { type: Array, default: [] },
    //   edges: { type: Array, default: [] },
    //   viewport: { type: Object, default: null },
    //   imageUrl: { type: String, default: "" },
    // },
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
  },
  { timestamps: true }
);

AppSchema.index({ userId: 1, slug: 1 }, { unique: true });

export const AppModel =
  mongoose.models.App || mongoose.model("App", AppSchema);
