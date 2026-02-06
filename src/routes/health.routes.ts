export default async function healthRoutes(app: any) {
  app.get("/", async () => ({ ok: true }));
}
