import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { useAdmin, invitePlayer } from "./account";

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await useAdmin(page);
  await page.goto("/scoring-settings");
  const data = await (await page.request.get("/api/scoring-settings")).json();
  const original = data.versions.find(
    (v: { version: number }) => v.version === 1,
  ).config;
  const latest = data.versions[0].config;
  const config = {
    ...original,
    types: { ...latest.types, ...original.types },
    consistency: [],
    consistencyMinMinutes: 20,
  };
  for (const id of Object.keys(config.types))
    if (!Object.hasOwn(original.types, id)) config.types[id].enabled = false;
  const restored = await page.request.post("/api/scoring-settings", {
    data: {
      config,
      effectiveOn: data.today,
      expectedVersion: data.latestVersion,
    },
  });
  expect(restored.ok()).toBe(true);
  await page.close();
});

test.use({
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
});
test("an administrator previews and publishes fitness rules from the club menu on mobile", async ({
  page,
}) => {
  await useAdmin(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open club menu" }).click();
  await page
    .getByRole("link", { name: "Scoring Settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scoring Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Points per 10 minutes for running", { exact: true }),
  ).toHaveValue("10");
  await expect(page.getByLabel("Workout cap", { exact: true })).toHaveValue(
    "60",
  );
  await expect(page.getByLabel("Daily cap", { exact: true })).toHaveValue(
    "100",
  );
  await page.getByLabel("Preview activity").selectOption("sprint_hiit");
  await page.getByLabel("Preview minutes").fill("60");
  await page.getByLabel("Preview intensity").selectOption("max");
  await page
    .getByRole("button", { name: "Calculate preview", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Preview: 60.0 points (100.8 before caps)",
  );
  await page
    .getByLabel("Name for rugby", { exact: true })
    .fill("Club rugby training");
  await expect(
    page.getByRole("button", { name: "Publish scoring version" }),
  ).toBeDisabled();
  await page.getByLabel("New activity identifier").fill("cycling");
  await page.getByLabel("New activity name").fill("Cycling");
  await page.getByRole("button", { name: "Add activity", exact: true }).click();
  await page
    .getByRole("button", { name: "Calculate preview", exact: true })
    .click();
  await page.getByRole("button", { name: "Publish scoring version" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Scoring version published" }),
  ).toBeVisible();
  await expect(page.getByText(/Version 2 ·/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a player logs server-scored training and sees balance and scoring history without admin access", async ({
  page,
}) => {
  await useAdmin(page);
  const invite = await invitePlayer(page, "Fitness Mobile Player");
  await page.goto(invite);
  await page.getByLabel("Roster name").fill("Fitness Mobile Player");
  await page.getByLabel("Position").selectOption({ label: "Fullback" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("link", { name: "Log", exact: true }).click();
  await page
    .getByRole("button", { name: "Sprint / HIIT", exact: true })
    .click();
  await page.getByRole("button", { name: "20 min", exact: true }).click();
  await expect(page.getByText(/Estimated/).first()).toContainText("24.0");
  await page.getByRole("button", { name: "Save workout", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("24.0 points");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(
    page.getByLabel("Training balance", { exact: true }),
  ).toContainText("not clinically validated");
  await page.getByRole("link", { name: "You", exact: true }).click();
  await expect(page.getByLabel("Training statistics")).toContainText("24.0");
  await expect(
    page.getByRole("heading", { name: "Scoring history", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/scoring-settings")).status()).toBe(403);
  expect(
    (
      await page.request.post("/api/workouts", {
        data: { type: "running", durationMin: 20, points: 99999 },
      })
    ).status(),
  ).toBe(400);
  await page.goto("/scoring-settings");
  await expect(
    page.getByText("Only administrators can manage scoring."),
  ).toBeVisible();
});
