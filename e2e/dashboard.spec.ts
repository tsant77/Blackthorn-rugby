import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const shots = "docs/screenshots/phase-4";

test("coach logs and opens the dashboard", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("coach@blackthorn.test");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await page.goto(await latestLink(page, "coach@blackthorn.test"));
  await page.getByRole("link", { name: "Set up a training profile" }).click();
  await page.getByLabel("Roster name").fill("Coach Kim");
  await page.getByLabel("Position").selectOption({ label: "No position" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "Coach Kim" })).toBeVisible();

  await page.getByRole("link", { name: "Log" }).click();
  await expect(page.getByLabel("Date")).toBeVisible();
  await page.screenshot({ path: `${shots}/log-date-mobile.png` });
  await page.getByLabel("Minutes").fill("40");
  await page.getByRole("button", { name: "Save workout" }).click();
  await expect(page.getByRole("status")).toContainText("6.0 points");

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByText("Streak:")).toBeVisible();
  await page.screenshot({ path: `${shots}/dashboard-mobile.png`, fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  await expect(page.getByText("100%")).toBeVisible();
  await page.screenshot({ path: `${shots}/team-desktop.png` });

  await page.getByRole("link", { name: "Board" }).click();
  await page.getByLabel("Group or position").selectOption({ label: "Coaches" });
  await expect(page.getByText("Coach Kim")).toBeVisible();
  await page.screenshot({ path: `${shots}/coaches-board-desktop.png` });
});

async function latestLink(page: Page, email: string): Promise<string> {
  const response = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  const body = await response.json() as { messages: { text_body: string }[] };
  const match = body.messages[0]?.text_body.match(/https?:\/\/\S+/);
  if (!match?.[0]) throw new Error(`No link for ${email}`);
  return match[0];
}
