import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:8787",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: "npm run build --workspace @blackthorn/web && npm run e2e:server --workspace @blackthorn/api",
    url: "http://127.0.0.1:8787/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
