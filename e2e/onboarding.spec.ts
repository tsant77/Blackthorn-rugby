import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const shots = "docs/screenshots/phase-2";

test("invite, magic link, and onboarding", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Offseason" })).toBeVisible();
  await page.screenshot({ path: `${shots}/login-mobile.png` });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${shots}/login-desktop.png` });

  await page.getByLabel("Email").fill("coach@blackthorn.test");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(await latestLink(page, "coach@blackthorn.test"));
  await expect(page.getByRole("link", { name: "Invite a player" })).toBeVisible();
  await page.screenshot({ path: `${shots}/home-desktop.png` });

  await page.getByRole("link", { name: "Invite a player" }).click();
  await page.getByLabel("Email").fill("player@blackthorn.test");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toContainText("player@blackthorn.test");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(await latestLink(page, "player@blackthorn.test"));
  await expect(page.getByRole("heading", { name: "Join the roster" })).toBeVisible();
  await page.screenshot({ path: `${shots}/onboarding-mobile.png` });
  await page.getByLabel("Roster name").fill("Test Player");
  await page.getByLabel("Position").selectOption({ label: "Scrum-half" });
  await expect(page.getByText("Backs")).toBeVisible();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "Test Player" })).toBeVisible();
  await page.screenshot({ path: `${shots}/player-home-mobile.png` });
});

async function latestLink(page: Page, email: string): Promise<string> {
  const response = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { messages: { text_body: string }[] };
  const match = body.messages[0]?.text_body.match(/https?:\/\/\S+/);
  if (!match?.[0]) throw new Error(`No magic link for ${email}`);
  return match[0];
}
