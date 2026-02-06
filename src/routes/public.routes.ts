import { UserModel } from "../models/user.model.ts";
import { AppModel } from "../models/app.model.ts";

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

    return { user, apps };
  });

  // GET /public/u/:username/:slug
  app.get("/u/:username/:slug", async (req: any, reply: any) => {
    const { username, slug } = req.params;
    console.log("Params received:", req.params);
    const user = await UserModel.findOne({ username }).lean();
    if (!user) return reply.code(404).send({ message: "User not found" });

    const appDoc = await AppModel.findOne({
      userId: user._id,
      slug,
      visibility: { $in: ["PUBLIC", "UNLISTED"] }
    }).lean();

    if (!appDoc) return reply.code(404).send({ message: "App not found" });

    return { user, app: appDoc };
  });
}
