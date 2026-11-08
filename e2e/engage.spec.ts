import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const shots = "docs/screenshots/phase-6";

test("a badge, a challenge, and a void notice", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await signIn(page, "coach@blackthorn.test");
  await page.getByRole("link", { name: "Invite a player" }).click();
  await page.getByLabel("Email").fill("badged@blackthorn.test");
  await page.getByRole("button", { name: "Send invite" }).click();
  await page.goto(await latestLink(page, "badged@blackthorn.test"));
  await page.getByLabel("Roster name").fill("Test Player");
  await page.getByLabel("Position").selectOption({ label: "Fullback" });
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("link", { name: "Log" }).click();
  await page.getByLabel("Minutes").fill("40");
  await page.getByRole("button", { name: "Save workout" }).click();
  await expect(page.getByRole("status")).toContainText("6.0 points");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "You" }).click();
  await expect(page.getByText("First session")).toBeVisible();
  await expect(page.getByText("Earned · Log the first workout that counts.")).toBeVisible();
  await page.screenshot({ path: `${shots}/badges-mobile.png` });

  await signOut(page);
  await signIn(page, "coach@blackthorn.test");
  await page.getByRole("link", { name: "Challenges", exact: true }).click();
  await expect(page.getByLabel("Starts")).not.toHaveValue("");
  await page.getByLabel("Title").fill("November sessions");
  await page.getByLabel("Description").fill("Log one session");
  await page.getByLabel("Target").fill("1");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Test Player reached the target.")).toBeVisible();
  await page.screenshot({ path: `${shots}/challenges-desktop.png`, fullPage: true });

  await page.getByRole("link", { name: "Moderate", exact: true }).click();
  await page.getByLabel("Reason").fill("Logged twice");
  await page.locator("li").filter({ hasText: "Test Player" }).filter({ hasText: "submitted" }).first().getByRole("button", { name: "Void" }).click();
  await expect(page.getByText("voided")).toBeVisible();

  await signOut(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Email").fill("badged@blackthorn.test");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await page.goto(await latestLink(page, "badged@blackthorn.test"));
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("logged by mistake")).toBeVisible();
  await expect(page.getByText("Logged twice")).toBeVisible();
  await page.screenshot({ path: `${shots}/inbox-mobile.png`, fullPage: true });
});

async function signOut(page: Page) {
  await page.request.post("/api/auth/logout");
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
}

async function signIn(page: Page, email: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await page.goto(await latestLink(page, email));
}

async function latestLink(page: Page, email: string): Promise<string> {
  const response = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  const body = await response.json() as { messages: { text_body: string }[] };
  const match = body.messages[0]?.text_body.match(/https?:\/\/\S+/);
  if (!match?.[0]) throw new Error(`No link for ${email}`);
  return match[0];
}
