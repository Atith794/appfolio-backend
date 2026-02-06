import { z } from "zod";
import { onboardUser, getUserByClerkId } from "../services/users.service.js";
import { normalizeUsername } from "../utils/username.js";

const onboardSchema = z.object({
  username: z.string().min(3).max(20),
  displayName: z.string().optional(),
  headline: z.string().optional()
});

export default async function usersRoutes(app: any) {
  // GET /users/me
  app.get(
    "/me",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const clerkUserId = req.auth.clerkUserId;

      const user = await getUserByClerkId(clerkUserId);
      if (!user) {
        return reply.code(404).send({ onboarded: false });
      }

      return { onboarded: true, user };
    }
  );

  // POST /users/onboard
  app.post(
    "/onboard",
    { preHandler: app.requireAuth },
    async (req: any, reply: any) => {
      const parsed = onboardSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(parsed.error.flatten());
      }
      console.log("Request:",req.body)
      const clerkUserId = req.auth.clerkUserId;
      // const email =
      //   req.headers["x-user-email"]?.toString() || "";
      const email = req.body.email;

      const username = normalizeUsername(parsed.data.username);

      try {
        const user = await onboardUser({
          clerkUserId,
          email,
          username,
          displayName: parsed.data.displayName,
          headline: parsed.data.headline
        });

        return reply.code(201).send({ user });
      } catch (err: any) {
        if (err.message === "USERNAME_TAKEN") {
          return reply.code(409).send({ message: "Username already taken" });
        }
        if (err.message === "USER_ALREADY_ONBOARDED") {
          return reply.code(409).send({ message: "User already onboarded" });
        }

        throw err;
      }
    }
  );
}
