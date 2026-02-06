import crypto from "crypto";
import { z } from "zod";
// console.log("process.env.CLOUDINARY_API_KEY:",process.env.CLOUDINARY_API_KEY)
export default async function uploadsRoutes(app: any) {
  app.post(
    "/cloudinary-signature",
    { preHandler: app.requireAuth },
    async (req: any) => {
      const timestamp = Math.floor(Date.now() / 1000);
      const folder = "appfolio/screenshots";

      const payload = `folder=${folder}&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`;
      const signature = crypto.createHash("sha1").update(payload).digest("hex");

      return {
        timestamp,
        folder,
        signature,
        apiKey: process.env.CLOUDINARY_API_KEY
      };
    }
  );
}