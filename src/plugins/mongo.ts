import fp from "fastify-plugin";
import mongoose from "mongoose";

export default fp(
  async function mongo(app) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI is missing");
    }

    mongoose.set("strictQuery", true);

    try {
      app.log.info("Connecting to MongoDB...");

      await mongoose.connect(uri, {
        autoIndex: true,
        family: 4,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });

      app.log.info("MongoDB connected");

      app.addHook("onClose", async () => {
        await mongoose.disconnect();
        app.log.info("MongoDB disconnected");
      });
    } catch (err) {
      app.log.error({ err }, "MongoDB connection failed");
      throw err;
    }
  },
  {
    name: "mongo",
  }
);