import { describe, expect, it } from "vitest";
import { renderMagicLink } from "./email";
import { secretsEqual } from "./tokens";

describe("magic-link email", () => {
  it("includes a one-time link and no password", () => {
    const message = renderMagicLink({
      origin: "https://rugby.example",
      path: "/auth/verify",
      token: "abc_def-123",
      kind: "login",
    });
    expect(message.text).toContain("https://rugby.example/auth/verify?token=abc_def-123");
    expect(message.html).toContain("https://rugby.example/auth/verify?token=abc_def-123");
    expect(message.text.toLowerCase()).not.toContain("password");
    expect(message.subject).toContain("Blackthorn");
  });

  it("compares the bootstrap address without a direct string check", async () => {
    expect(await secretsEqual("coach@blackthorn.test", "coach@blackthorn.test")).toBe(true);
    expect(await secretsEqual("coach@blackthorn.test", "other@blackthorn.test")).toBe(false);
  });
});
