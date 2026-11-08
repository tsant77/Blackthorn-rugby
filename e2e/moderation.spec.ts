import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { invitePlayer, useAdmin } from "./account";

const shots = "docs/screenshots/phase-5";

test("coach voids a workout and the board drops", async ({ page }) => {
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

  await useAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("link", { name: "Moderate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Moderation" })).toBeVisible();
  await page.screenshot({ path: `${shots}/moderate-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/moderate-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await page.screenshot({ path: `${shots}/members-desktop.png`, fullPage: true });
  await page.getByRole("link", { name: "Rules", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Scoring" })).toBeVisible();
  await page.screenshot({ path: `${shots}/rules-desktop.png`, fullPage: true });
  await page.getByRole("link", { name: "Moderate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Moderation" })).toBeVisible();
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
  await page.getByRole("link", { name: "Log" }).click();
  await expect(page.getByText("voided")).toBeVisible();
  await expect(page.getByText("Logged twice")).toBeVisible();
  await page.getByText("Logged twice").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/player-status-mobile.png`, fullPage: true });
  await page.getByRole("link", { name: "Board" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Test Player" }).filter({ hasText: "0 sessions" }).first();
  await expect(row.getByText("0.0")).toBeVisible();
});

