import { expect, it } from "vitest";
import app from "./app";
import { openTestDatabase } from "./test-db";

it("cannot enable email collection, sign-in, or notifications through legacy configuration", async () => {
  const env = { DB: openTestDatabase(), EMAIL_PROVIDER: "console", BOOTSTRAP_ADMIN_EMAIL: "never@example.com" };
  const response = await app.request("https://club.test/api/auth/request", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "never@example.com" }),
  }, env);
  expect(response.status).toBe(410);
  expect((await app.request("https://club.test/api/dev/mailbox?to=never@example.com", {}, env)).status).toBe(404);
  expect(await (await app.request("https://club.test/api/auth/options", {}, env)).json()).toEqual({ emailEnabled: false });
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").bind().first<{ n: number }>())?.n).toBe(0);
});
