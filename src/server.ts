import "dotenv/config";
import { buildApp } from "./app";

const port = Number(process.env.API_PORT || 4000);

const app = await buildApp();

try {
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API running on http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// MONGODB_URI=mongodb+srv://atith:12345@cluster0.6hengam.mongodb.net/appfolio?retryWrites=true&w=majority
