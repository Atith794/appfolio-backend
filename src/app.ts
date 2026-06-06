// import Fastify from "fastify";
// import mongoPlugin from "./plugins/mongo";
// import authPlugin from "./plugins/auth";
// import cloudinaryPlugin from "./plugins/cloudinary";
// import healthRoutes from "./routes/health.routes";
// import publicRoutes from "./routes/public.routes";
// import appsRoutes from "./routes/apps.routes";
// import usersRoutes from "./routes/users.routes";
// import uploadsRoutes from "./routes/uploads.routes";
// import { billingRoutes } from "./routes/billing.routes";
// import cors from '@fastify/cors';
// import fastifyRawBody from "fastify-raw-body";
// import helmet from "@fastify/helmet";
// import rateLimit from "@fastify/rate-limit";
// import sensible from "@fastify/sensible";

// function getAllowedOrigins() {
//   if (process.env.NODE_ENV === "production") {
//     return [
//       process.env.FRONTEND_URL,
//       process.env.WWW_FRONTEND_URL,
//     ].filter(Boolean) as string[];
//   }

//   return [
//     "http://localhost:3000",
//     "https://rg8xle3mbdnb.shares.zrok.io",
//   ];
// }

// export async function buildApp() {
  
//   const app = Fastify({ logger: true });

//   //CORS to allow every origin
//   await app.register(cors, {
//     origin: ['http://localhost:3000','https://rg8xle3mbdnb.shares.zrok.io'],
//     methods: ['GET', 'POST', 'PUT','PATCH', 'DELETE', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization', 'skip_zrok_interstitial'],
//     credentials: true, // Required for Clerk session cookies if used
//   });

//   await app.register(mongoPlugin);
//   await app.register(authPlugin); 
//   await app.register(cloudinaryPlugin);

//   await app.register(healthRoutes, { prefix: "/health" });
//   await app.register(usersRoutes, { prefix: "/users" });
//   await app.register(publicRoutes, { prefix: "/public" });
//   await app.register(appsRoutes, { prefix: "/apps" });
//   await app.register(uploadsRoutes, { prefix: "/uploads" });
//   await app.register(fastifyRawBody, { 
//     field:"rawBody",
//     global: false,
//     encoding: false,
//     runFirst: true,
//    });
//   await app.register(billingRoutes, { prefix: "/billing" });
//   return app;
// }


// V2 secure server
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fastifyRawBody from "fastify-raw-body";

import mongoPlugin from "./plugins/mongo";
import authPlugin from "./plugins/auth";
import cloudinaryPlugin from "./plugins/cloudinary";

import healthRoutes from "./routes/health.routes";
import publicRoutes from "./routes/public.routes";
import appsRoutes from "./routes/apps.routes";
import usersRoutes from "./routes/users.routes";
import uploadsRoutes from "./routes/uploads.routes";
import { billingRoutes } from "./routes/billing.routes";

function getAllowedOrigins() {
  if (process.env.NODE_ENV === "production") {
    return [
      process.env.FRONTEND_URL,
      process.env.WWW_FRONTEND_URL,
    ].filter(Boolean) as string[];
  }

  return [
    "http://localhost:3000",
    "https://rg8xle3mbdnb.shares.zrok.io",
  ];
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "apiKey",
        "token",
        "secret",
        "password",
        "signature",
      ],
    },

    // Prevent very large JSON/body payloads
    bodyLimit: 2 * 1024 * 1024,

    // Useful when hosted behind Render/Vercel/Nginx/etc.
    trustProxy: true,
  });

  /**
   * Security headers
   */
  await app.register(helmet, {
    global: true,
  });

  /**
   * CORS
   */
  await app.register(cors, {
    origin: (origin, cb) => {
      const allowedOrigins = getAllowedOrigins();

      // Allow server-to-server requests or tools with no origin
      if (!origin) {
        return cb(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      return cb(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders:
      process.env.NODE_ENV === "production"
        ? ["Content-Type", "Authorization"]
        : ["Content-Type", "Authorization", "skip_zrok_interstitial"],
    credentials: true,
  });

  /**
   * Rate limiting
   */
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    errorResponseBuilder: () => {
      return {
        message: "Too many requests. Please try again later.",
      };
    },
  });

  await app.register(sensible);

  /**
   * Plugins
   */
  await app.register(mongoPlugin);
  await app.register(authPlugin);
  await app.register(cloudinaryPlugin);

  /**
   * Raw body is needed for payment webhooks.
   * Keep this before billingRoutes.
   */
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
  });

  /**
   * Routes
   */
  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(usersRoutes, { prefix: "/users" });
  await app.register(publicRoutes, { prefix: "/public" });
  await app.register(appsRoutes, { prefix: "/apps" });
  await app.register(uploadsRoutes, { prefix: "/uploads" });
  await app.register(billingRoutes, { prefix: "/billing" });

  /**
   * 404 handler
   */
  app.setNotFoundHandler((req, reply) => {
    return reply.code(404).send({
      message: "Route not found",
    });
  });

  /**
   * Central error handler
   */
  app.setErrorHandler((error, req, reply) => {
    req.log.error(error);

    const statusCode = error.statusCode || 500;

    if (process.env.NODE_ENV === "production") {
      return reply.code(statusCode).send({
        message:
          statusCode >= 500
            ? "Something went wrong"
            : error.message || "Request failed",
      });
    }

    return reply.code(statusCode).send({
      message: error.message,
      stack: error.stack,
    });
  });

  return app;
}