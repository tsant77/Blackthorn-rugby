import { describe, expect, it } from "vitest";
import app from "./index";

describe("API shell", () => {
  it("answers a health check without touching the database", async () => {
    const response = await app.request("http://localhost/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "blackthorn-rugby",
    });
  });

  it("does not expose product routes yet", async () => {
    const response = await app.request("http://localhost/api/workouts");
    expect(response.status).toBe(404);
  });
});
