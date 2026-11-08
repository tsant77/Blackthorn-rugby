import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const shots = "docs/screenshots/phase-3";

test("log a workout and see it on the leaderboard", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  const admin = await signIn(page, "coach@blackthorn.test");
  expect(admin).toBeTruthy();
  await page.getByRole("link", { name: "Invite a player" }).click();
  await page.getByLabel("Email").fill("logger@blackthorn.test");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toContainText("logger@blackthorn.test");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(await latestLink(page, "logger@blackthorn.test"));
  await page.getByLabel("Roster name").fill("Test Player");
  await page.getByLabel("Position").selectOption({ label: "Fullback" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "Test Player" })).toBeVisible();

  await page.getByRole("link", { name: "Log" }).click();
  await expect(page.getByRole("heading", { name: "Log a workout" })).toBeVisible();
  await page.screenshot({ path: `${shots}/log-mobile.png` });
  await page.getByRole("button", { name: "Running" }).click();
  await page.getByLabel("Minutes").fill("40");
  await page.getByLabel("Miles, optional").fill("5");
  await page.getByRole("button", { name: "Save workout" }).click();
  await expect(page.getByRole("status")).toContainText("6.0 points");
  await page.screenshot({ path: `${shots}/points-mobile.png` });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("link", { name: "Board" }).click();
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
  await expect(page.getByText("Test Player").first()).toBeVisible();
  await expect(page.getByText("6.0").first()).toBeVisible();
  await page.screenshot({ path: `${shots}/leaderboard-desktop.png` });
});

async function signIn(page: Page, email: string): Promise<string> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await page.goto(await latestLink(page, email));
  return email;
}

async function latestLink(page: Page, email: string): Promise<string> {
  const response = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  const body = await response.json() as { messages: { text_body: string }[] };
  const match = body.messages[0]?.text_body.match(/https?:\/\/\S+/);
  if (!match?.[0]) throw new Error(`No link for ${email}`);
  return match[0];
}
