import { expect, test } from "@playwright/test";
import { invitePlayer, useAdmin } from "./account";

test("recent activity waits for data and excludes voided and rejected sessions before limiting", async ({ page }) => {
  await useAdmin(page);
  const invite = await invitePlayer(page, "Recent Activity Player");
  await page.goto(invite);
  await page.getByLabel("Roster name").fill("Recent Activity Player");
  await page.getByLabel("Position").selectOption({ label: "Fullback" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "Recent Activity Player" })).toBeVisible();

  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/workouts?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("limit")).toBe("3");
    expect(query.get("status")).toBe("counted");
    expect(query.get("context")).toBe("none");
    await waiting;
    await route.fulfill({ json: { workouts: [
      { id: "deleted", type: "football", status: "voided" },
      { id: "rejected", type: "basketball", status: "rejected" },
      ...["running", "rower", "rugby", "circuit_training"].map((type, index) => ({
        id: String(index), type, status: index === 1 ? "approved" : "submitted",
        occurred_on: "2026-11-08", duration_min: 30, points_tenths: 45,
      })),
    ] } });
  });
  await page.reload();
  const activity = page.locator("section").filter({ has: page.getByRole("heading", { name: "Recent activity", exact: true }) });
  await expect(activity.getByRole("status")).toHaveText("Loading recent activity…");
  await expect(activity).not.toContainText("Your first session starts the story");
  release();
  await expect(activity.getByRole("article")).toHaveCount(3);
  await expect(activity).toContainText("running");
  await expect(activity).toContainText("rower");
  await expect(activity).toContainText("rugby");
  await expect(activity).not.toContainText("football");
  await expect(activity).not.toContainText("basketball");
  await expect(activity).not.toContainText("circuit");

  await page.unroute("**/api/workouts?*");
  await page.route("**/api/workouts?*", (route) => route.fulfill({ status: 500, json: { error: "Unavailable" } }));
  await page.reload();
  await expect(activity.getByRole("alert")).toHaveText("Could not load recent activity.");
  await expect(activity).not.toContainText("Your first session starts the story");

  await page.unroute("**/api/workouts?*");
  await page.route("**/api/workouts?*", (route) => route.fulfill({ json: { workouts: [
    { id: "deleted", status: "voided" }, { id: "rejected", status: "rejected" },
  ] } }));
  await page.reload();
  await expect(activity).toContainText("Your first session starts the story");
  await expect(activity.getByRole("status")).toHaveCount(0);
});
