import fp from "fastify-plugin";
import mongoose from "mongoose";

export default fp(async (app) => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is missing");

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    autoIndex: true,
    family: 4
  });

  app.log.info("MongoDB connected");

  app.addHook("onClose", async () => {
    await mongoose.disconnect();
    app.log.info("MongoDB disconnected");
  });
});
