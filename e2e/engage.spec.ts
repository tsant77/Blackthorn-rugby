import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { invitePlayer, useAdmin } from "./account";

const shots = "docs/screenshots/phase-6";

test("a badge, a challenge, and a void notice", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await useAdmin(page);
  const link = await invitePlayer(page, "Test Player");
  await page.goto(link);
  await page.getByLabel("Roster name").fill("Test Player");
  await page.getByLabel("Position").selectOption({ label: "Fullback" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("link", { name: "Log" }).click();
  await page.getByLabel("Minutes").fill("40");
  await page.getByRole("button", { name: "Save workout" }).click();
  await expect(page.getByRole("status")).toContainText("6.0 points");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "You" }).click();
  await expect(page.getByText("First session")).toBeVisible();
  await expect(page.getByText("Earned · Log the first workout that counts.")).toBeVisible();
  await page.screenshot({ path: `${shots}/badges-mobile.png` });

  await useAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("link", { name: "Challenges", exact: true }).click();
  await expect(page.getByLabel("Starts")).not.toHaveValue("");
  await page.getByLabel("Title").fill("November sessions");
  await page.getByLabel("Description").fill("Log one session");
  await page.getByLabel("Target").fill("1");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Test Player reached the target.")).toBeVisible();
  await page.screenshot({ path: `${shots}/challenges-desktop.png`, fullPage: true });

  await page.getByRole("link", { name: "Moderate", exact: true }).click();
  await page.getByLabel("Reason").fill("Logged twice");
  await page.locator("li").filter({ hasText: "Test Player" }).filter({ hasText: "submitted" }).first().getByRole("button", { name: "Void" }).click();
  await expect(page.getByText("voided")).toBeVisible();

  const roster = await page.request.get("/api/members");
  const members = (await roster.json()) as { members: { user_id: string; roster_name: string | null }[] };
  const player = members.members.find((member) => member.roster_name === "Test Player");
  const playerLink = await page.request.post("/api/signin-links", { data: { userId: player?.user_id } });
  const playerUrl = ((await playerLink.json()) as { url: string }).url;
  await page.context().clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(playerUrl);
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("logged by mistake")).toBeVisible();
  await expect(page.getByText("Logged twice")).toBeVisible();
  await page.screenshot({ path: `${shots}/inbox-mobile.png`, fullPage: true });
});

