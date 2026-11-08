import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { invitePlayer, useAdmin } from "./account";

test("mobile training flow preserves permissions, editing, and deletion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useAdmin(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Members", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Open club menu" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("link", { name: "Members", exact: true }).last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open club menu" })).toBeFocused();

  const link = await invitePlayer(page, "Mobile Athlete");
  await page.goto(link);
  await page.getByLabel("Roster name").fill("Mobile Athlete");
  await page.getByLabel("Position").selectOption({ label: "Fullback" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("button", { name: "Open club menu" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Log", exact: true }).click();
  await page.getByRole("button", { name: "Weights", exact: true }).click();
  await expect(page.getByLabel("Miles, optional")).toHaveCount(0);
  await page.getByRole("button", { name: "Rower", exact: true }).click();
  await expect(page.getByLabel("Miles, optional")).toBeVisible();
  await page.getByRole("button", { name: "Running", exact: true }).click();
  await page.getByRole("button", { name: "30 min", exact: true }).click();
  await expect(page.getByLabel("Minutes")).toHaveValue("30");
  await page.getByRole("button", { name: "hard", exact: true }).click();
  await page.getByLabel("Notes, optional").fill("Mobile test session");
  await expect(page.getByLabel("Date")).not.toHaveValue("");
  await mkdir("docs/screenshots/mobile-redesign", { recursive: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "docs/screenshots/mobile-redesign/log.png", fullPage: true });
  await page.getByRole("button", { name: "Save workout", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Workout saved");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Edit workout" })).toBeVisible();
  await page.getByLabel("Minutes").fill("45");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Workout saved");
  await expect(page.locator(".session-card").first()).toContainText("45 min");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mobile Athlete" })).toBeVisible();
  await expect(page.getByLabel("Weekly performance")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/mobile-redesign/home.png", fullPage: true });
  for (const [route, name] of [["/board", "board"], ["/you", "profile"]] as const) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `docs/screenshots/mobile-redesign/${name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/log");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await expect(page.locator(".session-card").first()).toContainText("Deleted");
});
