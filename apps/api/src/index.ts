import { Hono } from "hono";

export interface Env {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "blackthorn-rugby" }));

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
