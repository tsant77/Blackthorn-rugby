import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { useAdmin } from "./account";

const shots = "docs/screenshots/phase-2";

test("invite link, redeem, and onboarding", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Offseason" })).toBeVisible();
  await expect(page.getByText("Ask a coach for a link.")).toBeVisible();
  await page.screenshot({ path: `${shots}/login-mobile.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${shots}/login-desktop.png` });

  await useAdmin(page);
  await page.goto("/invite");
  await page.getByLabel("Name").fill("Test Player");
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Invite link").inputValue();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await page.screenshot({ path: `${shots}/home-desktop.png` });

  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Join the roster" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/onboarding-mobile.png` });
  await page.getByLabel("Roster name").fill("Test Player");
  await page.getByLabel("Position").selectOption({ label: "Scrum-half" });
  await expect(page.getByText("Backs")).toBeVisible();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "Test Player" })).toBeVisible();
  await page.screenshot({ path: `${shots}/player-home-mobile.png` });
});
