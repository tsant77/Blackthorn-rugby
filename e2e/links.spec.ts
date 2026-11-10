import { expect, test } from "@playwright/test";
import { invitePlayer, useAdmin } from "./account";

test("a player uses a recovery link on a signed-out device", async ({ page }) => {
  await useAdmin(page);
  const invite = await invitePlayer(page, "Recovery Wing");
  await page.goto(invite);
  await page.getByLabel("Roster name").fill("Recovery Wing");
  await page.getByLabel("Position").selectOption({ label: "Fullback" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "Recovery Wing" })).toBeVisible();

  await page.getByRole("link", { name: "You" }).click();
  await page.getByRole("button", { name: "Create personal login link" }).click();
  const recovery = await page.getByLabel("Personal login link").inputValue();
  await page.context().clearCookies();
  await page.goto(recovery);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recovery Wing" })).toBeVisible();
  await page.context().clearCookies();
  await page.goto(recovery);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recovery Wing" })).toBeVisible();
});
