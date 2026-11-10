import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// The only deletable target is this repository's disposable local browser-test DB.
const root = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(root, "apps/api/.wrangler/e2e");
if (target !== fileURLToPath(new URL("../apps/api/.wrangler/e2e", import.meta.url))) throw new Error("Unexpected test database path");
await rm(target, { recursive: true, force: true });
