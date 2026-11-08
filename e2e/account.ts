import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

export async function useAdmin(page: Page): Promise<void> {
  const saved = JSON.parse(await readFile(new URL("./.session.json", import.meta.url), "utf8")) as { value: string };
  await page.context().addCookies([{ name: "blackthorn_session", value: saved.value, url: "http://127.0.0.1:8787" }]);
}

export async function invitePlayer(page: Page, label: string, role = "player"): Promise<string> {
  const response = await page.request.post("/api/share-invites", { data: { label, role } });
  if (!response.ok()) throw new Error(await response.text());
  const body = await response.json() as { url: string };
  return body.url;
}
