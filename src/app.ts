import Fastify from "fastify";
import mongoPlugin from "./plugins/mongo";
import authPlugin from "./plugins/auth";
import cloudinaryPlugin from "./plugins/cloudinary";
import healthRoutes from "./routes/health.routes";
import publicRoutes from "./routes/public.routes";
import appsRoutes from "./routes/apps.routes";
import usersRoutes from "./routes/users.routes";
import uploadsRoutes from "./routes/uploads.routes";
import { billingRoutes } from "./routes/billing.routes";
import cors from '@fastify/cors';

export async function buildApp() {
  
  const app = Fastify({ logger: true });

  //CORS to allow every origin
  await app.register(cors, {
    origin: 'http://localhost:3000', // Your Next.js frontend
    methods: ['GET', 'POST', 'PUT','PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // Required for Clerk session cookies if used
  });

  await app.register(mongoPlugin);
  await app.register(authPlugin);
  await app.register(cloudinaryPlugin);

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(usersRoutes, { prefix: "/users" });
  await app.register(publicRoutes, { prefix: "/public" });
  await app.register(appsRoutes, { prefix: "/apps" });
  await app.register(uploadsRoutes, { prefix: "/uploads" });
  await app.register(billingRoutes, { prefix: "/billing" });
  return app;
}
