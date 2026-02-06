import fp from "fastify-plugin";
import { createClerkClient, verifyToken } from "@clerk/backend";

declare module "fastify" {
  interface FastifyRequest {
    auth?: { clerkUserId: string };
  }
  interface FastifyInstance {
    requireAuth: (
      req: any,
      reply: any
    ) => Promise<void>;
  }
}

export default fp(async (app) => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is missing");

  const clerk = createClerkClient({ secretKey });

  app.decorate("requireAuth", async (req, reply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ message: "Missing Bearer token" });
    }

    const token = header.slice("Bearer ".length);

    try {
      const { sub } = await verifyToken(token,{
        secretKey
      });
      req.auth = { clerkUserId: sub };
    } catch(e) {
      console.error("Error on Auth.ts:",e);
      return reply.code(401).send({ message: "Invalid token" });
    }
  });
});
