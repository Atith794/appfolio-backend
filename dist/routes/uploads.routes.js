import { z } from "zod";
import { v2 as cloudinary } from "cloudinary";
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
const SignatureBodySchema = z.object({
    appId: z.string().min(1).max(100),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export default async function uploadsRoutes(app) {
    app.post("/cloudinary-signature", {
        preHandler: app.requireAuth,
        config: {
            rateLimit: {
                max: 20,
                timeWindow: "1 minute",
            },
        },
    }, async (req, reply) => {
        const parsed = SignatureBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid upload request",
                errors: parsed.error.flatten(),
            });
        }
        const { appId, fileHash } = parsed.data;
        const userId = req.auth?.clerkUserId || null;
        if (!userId) {
            return reply.code(401).send({
                message: "Unauthorized",
            });
        }
        const timestamp = Math.floor(Date.now() / 1000);
        const folder = `appfolio/screenshots/${userId}/${appId}`;
        /**
         * Same file = same hash = same public_id.
         * This helps prevent duplicate uploads.
         */
        const public_id = fileHash;
        /**
         * Optional but useful:
         * This limits the original stored image size.
         * For portfolio screenshots, you probably do not need huge 4K/8K originals.
         */
        const transformation = "c_limit,w_1600,h_1600";
        const uploadParams = {
            timestamp,
            folder,
            public_id,
            overwrite: false,
            transformation,
        };
        const signature = cloudinary.utils.api_sign_request(uploadParams, process.env.CLOUDINARY_API_SECRET);
        return {
            shouldUpload: true,
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            apiKey: process.env.CLOUDINARY_API_KEY,
            timestamp,
            folder,
            public_id,
            overwrite: false,
            transformation,
            signature,
        };
    });
}
