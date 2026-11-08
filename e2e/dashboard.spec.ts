import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { useAdmin } from "./account";

const shots = "docs/screenshots/phase-4";

test("coach logs and opens the dashboard", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await useAdmin(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Set up a training profile" }).click();
  await page.getByLabel("Roster name").fill("Coach Kim");
  await page.getByLabel("Position").selectOption({ label: "No position" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "Coach Kim" })).toBeVisible();

  await page.getByRole("link", { name: "Log", exact: true }).click();
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

