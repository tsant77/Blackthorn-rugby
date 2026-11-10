import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { invitePlayer, useAdmin } from "./account";

test.use({ serviceWorkers: "block", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test("shared registration, personal link login/recovery, training and mobile refinements", async ({ page, browserName }) => {
  await useAdmin(page);
  await page.goto("/registration");
  await page.getByRole("button", { name: "Create registration link", exact: true }).click();
  const url = await page.getByLabel("Team registration link").inputValue();
  expect(url).toContain("/join#token=");
  await expect(page.getByRole("heading", { name: "Registrations open" })).toBeVisible();
  await page.context().clearCookies();
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Join the team" })).toBeVisible();
  await expect(page.getByLabel("Full name")).toBeVisible();
  await expect.poll(() => page.url()).toMatch(/\/join$/);
  await page.getByLabel("Full name").fill("Rollout Wing");
  await page.getByLabel("Playing group").selectOption({ label: "Backs" });
  await page.getByLabel("Rugby position").selectOption({ label: "Fullback" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const shots = `docs/screenshots/team-rollout/${browserName}`;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/registration.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Create player account" }).click();
  const personal = await page.getByLabel("Personal login link").inputValue();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Rollout Wing" })).toBeVisible();

  await page.getByRole("link", { name: "Log", exact: true }).click();
  await page.getByRole("button", { name: "45 min", exact: true }).click();
  await page.getByLabel("Minutes").fill("40");
  await expect(page.getByText("Estimated", { exact: false }).first()).toContainText("6.0");
  const ids: string[] = [];
  // First request is saved but a gateway error replaces its response. Retry must reuse the key.
  await page.route("**/api/workouts", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    ids.push((route.request().postDataJSON() as { clientRequestId: string }).clientRequestId);
    if (ids.length === 1) { await route.fetch(); await route.fulfill({ status: 503, json: { error: "Temporary response failure. Please retry." } }); }
    else await route.continue();
  });
  await page.locator(".workout-form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.getByRole("alert")).toBeVisible();
  expect(ids).toHaveLength(1);
  await page.getByRole("button", { name: "Save workout", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("6.0 points");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  const own = await (await page.request.get("/api/workouts")).json() as { workouts: { status: string }[] };
  expect(own.workouts.filter(w => w.status === "submitted")).toHaveLength(1);
  await page.screenshot({ path: `${shots}/log.png`, fullPage: true, animations: "disabled" });

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByLabel("Weekly performance")).toContainText("6.0");
  await expect(page.getByRole("article").filter({ hasText: "Running" })).toBeVisible();
  await page.screenshot({ path: `${shots}/home.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page.getByLabel("Group or position").selectOption({ label: "Backs" });
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Rollout Wing" })).toContainText("6.0");
  await page.getByRole("button", { name: "Offseason", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Rollout Wing" })).toContainText("PTS");
  await page.getByRole("button", { name: "This week", exact: true }).click();
  await expect(page.getByRole("button", { name: "This week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Rollout Wing" })).toBeVisible();
  await page.screenshot({ path: `${shots}/board.png`, fullPage: true, animations: "disabled" });

  // Simulate device-provided insets; the implementation itself uses env(safe-area-inset-*).
  await page.addStyleTag({ content: ":root { --safe-top:44px; --safe-bottom:34px; --safe-left:0px; --safe-right:0px; }" });
  for (const size of [{ width: 320, height: 640 }, { width: 375, height: 812 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(size);
    await page.getByRole("link", { name: "Log", exact: true }).click();
    await page.getByLabel("Notes, optional").fill("Keyboard and scroll test");
    await page.getByRole("link", { name: "Board", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const top = await page.locator(".mobile-header").boundingBox();
    expect(top!.y).toBeGreaterThanOrEqual(44);
    const previous = await page.evaluate(() => window.scrollY);
    await page.getByRole("button", { name: "Open club menu" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.getByRole("link", { name: "Registration", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Close club menu" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Open club menu" })).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(previous);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rollout Wing" })).toBeVisible();
  await expect(page.getByLabel("Training statistics")).toContainText("6.0");
  await expect(page.getByRole("progressbar", { name: "Progress toward 50 points" })).toHaveAttribute("value", "6");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `${shots}/profile.png`, fullPage: true, animations: "disabled" });
  const me = await (await page.request.get("/api/me")).json() as { user: { id: string } };
  expect((await page.request.post("/api/player-login-links", { data: { userId: me.user.id, action: "rotate" } })).status()).toBe(403);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(personal);
  await expect.poll(() => page.url()).toMatch(/\/player-login$/);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rollout Wing" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Rollout Wing" })).toBeVisible();

  await useAdmin(page);
  await page.goto("/members");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Replace login link for Rollout Wing", exact: true }).click();
  const replacement = await page.getByLabel("Replacement personal login link").inputValue();
  await page.context().clearCookies();
  await page.goto(personal);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("invalid or revoked");
  await page.goto(replacement);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Weekly performance")).toContainText("6.0");

});

test("legacy player saves a personal link without losing their profile", async ({ page }) => {
  await useAdmin(page);
  const url = await invitePlayer(page, "Legacy Rollout");
  await page.goto(url);
  await page.getByLabel("Roster name").fill("Legacy Rollout");
  await page.getByLabel("Position").selectOption({ label: "Fullback" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("link", { name: "You", exact: true }).click();
  await page.getByRole("button", { name: "Create personal login link", exact: true }).click();
  const personal = await page.getByLabel("Personal login link").inputValue();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(personal);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Legacy Rollout" })).toBeVisible();
});

test("leaderboard keeps the latest filter when earlier requests finish late", async ({ page }) => {
  await useAdmin(page);
  let release!: () => void;
  let monthStarted!: () => void;
  let monthFinished!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { monthStarted = resolve; });
  const finished = new Promise<void>(resolve => { monthFinished = resolve; });
  await page.route("**/api/leaderboard?*", async route => {
    const period = new URL(route.request().url()).searchParams.get("period");
    if (period === "month") { monthStarted(); await waiting; }
    await route.fulfill({ json: { start: "2026-11-02", end: "2026-11-08", standings: [{
      rank: 1, previousRank: 1, movement: 0, profile_id: "synthetic-filter-test",
      roster_name: period === "offseason" ? "Current Season" : period === "month" ? "Stale Month" : "Current Week",
      position_name: "Fullback", group_name: "Backs", points_tenths: 60, workout_count: 1,
    }] } }).catch(() => {}); // An intentionally aborted month request has no response consumer.
    if (period === "month") monthFinished();
  });
  await page.goto("/board");
  await expect(page.getByText("Current Week", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await started;
  await page.getByRole("button", { name: "Offseason", exact: true }).click();
  await expect(page.getByText("Current Season", { exact: true })).toBeVisible();
  release();
  await finished;
  await expect(page.getByText("Current Season", { exact: true })).toBeVisible();
  await expect(page.getByText("Stale Month", { exact: true })).toHaveCount(0);
});
