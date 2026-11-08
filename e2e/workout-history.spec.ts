import { expect, test } from "@playwright/test";
import { invitePlayer, useAdmin } from "./account";

test("mobile workout history loads older sessions in bounded pages", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await useAdmin(page);
  const link = await invitePlayer(page, "History Pagination Player");
  await page.goto(link);
  await page.getByLabel("Roster name").fill("History Pagination Player");
  await page.getByLabel("Position").selectOption({ label: "Fullback" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "History Pagination Player", exact: true })).toBeVisible();
  for (let i = 0; i < 25; i++) {
    const response = await page.request.post("/api/workouts", {
      data: { type: "running", durationMin: 1, notes: `History note ${String(i).padStart(2, "0")}`, clientRequestId: crypto.randomUUID() },
    });
    expect(response.status()).toBe(201);
  }
  await page.goto("/log");
  const sessions = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your sessions", exact: true }) });
  await expect(sessions.getByRole("listitem")).toHaveCount(20);
  await expect(sessions).not.toContainText("History note 00");
  await sessions.getByRole("button", { name: "Load older sessions" }).click();
  await expect(sessions.getByRole("listitem")).toHaveCount(25);
  await expect(sessions).toContainText("History note 00");
  await expect(sessions.getByRole("button", { name: "Load older sessions" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
