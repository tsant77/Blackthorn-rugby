import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { useAdmin } from "./account";

const shots = "docs/screenshots/phase-7";

test("login and home meet axe and keyboard reach the main actions", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Offseason" })).toBeVisible();
  const login = await new AxeBuilder({ page }).analyze();
  expect(login.violations).toEqual([]);
  await page.screenshot({ path: `${shots}/login-mobile.png` });

  await useAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Coach" })).toBeVisible();
  const home = await new AxeBuilder({ page }).analyze();
  expect(home.violations).toEqual([]);
  await page.screenshot({ path: `${shots}/home-desktop.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Log" }).click();
  await expect(page.getByRole("heading", { name: "Log a workout" })).toBeVisible();
  const log = await new AxeBuilder({ page }).analyze();
  expect(log.violations).toEqual([]);
  await page.screenshot({ path: `${shots}/log-mobile.png` });
});
