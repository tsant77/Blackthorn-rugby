import { writeFile } from "node:fs/promises";

export default async function globalSetup(): Promise<void> {
  const response = await fetch("http://127.0.0.1:8787/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "dev-setup-token", name: "Coach" }),
  });
  if (!response.ok) throw new Error(`Setup failed: ${response.status} ${await response.text()}`);
  const header = response.headers.get("set-cookie") ?? "";
  const value = header.split(";")[0]?.split("=")[1];
  if (!value) throw new Error("Setup did not set a session cookie.");
  await writeFile(new URL("./.session.json", import.meta.url), JSON.stringify({ value }));
}
