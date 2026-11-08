import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { invitePlayer, useAdmin } from "./account";

const shots = "docs/screenshots/phase-3";

test("log a workout and see it on the leaderboard", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await useAdmin(page);
  const link = await invitePlayer(page, "Test Player");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(link);
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

