// Approved development-only synthetic workload. CPU must be attached from Worker telemetry.
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const origin = "https://blackthorn-rugby-dev.blackthorn-rugby.workers.dev";
if (process.env.RUN_DEV_WORKOUT_BENCHMARK !== "approved" || !process.env.DEV_WORKOUT_INPUT) {
  throw new Error("Set RUN_DEV_WORKOUT_BENCHMARK=approved and DEV_WORKOUT_INPUT to a private synthetic-session file after development approval.");
}
const players = JSON.parse(await readFile(process.env.DEV_WORKOUT_INPUT, "utf8"));
if (!Array.isArray(players) || players.length < 1 || players.length > 4 || players.some(p =>
  p.synthetic !== true || !Number.isSafeInteger(p.historySize) || p.historySize < 0 ||
  !/^blackthorn_session=[A-Za-z0-9_-]{43}$/.test(p.cookie ?? ""))) throw new Error("Expected 1–4 explicitly synthetic players with private session cookies and verified history sizes.");
const samples = [], groups = [];
async function request(player, path, method = "GET", body, concurrency = 1) {
  const start = performance.now();
  try {
    const response = await fetch(origin + path, {
      method, redirect: "error", signal: AbortSignal.timeout(60000),
      headers: { cookie: player.cookie, origin, "user-agent": "Blackthorn-Development-QA/1.0", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const sample = { historySize: player.historySize, path: path.startsWith("/api/workouts/") ? "/api/workouts/:id" : path.split("?")[0],
      variant: path.includes("cursor=") ? "older-page" : path.includes("status=counted") ? "recent" : path.includes("limit=25") ? "max-page" : "default",
      method, status: response.status, responseBytes: bytes.length, wallMs: performance.now() - start, concurrency };
    if (path.startsWith("/api/workouts")) samples.push(sample);
    return { status: response.status, data };
  } catch { samples.push({ historySize: player.historySize, method, status: "network-error", concurrency }); return { status: "network-error", data: {} }; }
}
// Verify names/roles via the application before performing any mutations.
for (const player of players) {
  const me = await request(player, "/api/me");
  if (me.status !== 200 || me.data.membership?.role !== "player" || !/^Performance QA /.test(me.data.user?.name ?? "")) {
    throw new Error("Only active synthetic Performance QA players on the development Worker may be benchmarked.");
  }
}
const startedAt = Date.now();
for (const player of players) {
  const start = Date.now();
  for (let repeat = 0; repeat < 3; repeat++) {
    const page = await request(player, "/api/workouts");
    await request(player, "/api/workouts?limit=25");
    await request(player, "/api/workouts?limit=3&status=counted&context=none");
    if (page.data.nextCursor) await request(player, "/api/workouts?context=none&cursor=" + encodeURIComponent(page.data.nextCursor));
  }
  for (const concurrency of [1, 4, 8]) {
    const results = await Promise.all(Array.from({ length: concurrency }, () => request(player, "/api/workouts", "POST", {
      type: "running", durationMin: 5, intensity: "moderate", notes: "Synthetic development CPU benchmark", clientRequestId: randomUUID(),
    }, concurrency)));
    // Delete exactly the returned newly created IDs, preserving ledger/audit history.
    for (const result of results) if (result.status === 201 && typeof result.data.workout?.id === "string") {
      await request(player, "/api/workouts/" + encodeURIComponent(result.data.workout.id), "DELETE");
    }
  }
  groups.push({ historySize: player.historySize, startedAt: start, endedAt: Date.now() });
}
const result = { worker: "blackthorn-rugby-dev", version: process.env.DEV_WORKOUT_VERSION ?? "attach-verified-version", startedAt, endedAt: Date.now(), groups, samples,
  functionalPassed: samples.every(s => s.status === (s.method === "POST" ? 201 : 200)),
  cpu: "Attach invocation CPUTimeMs and outcomes for this exact version and time window; client wall time is not CPU time." };
await writeFile(process.env.DEV_WORKOUT_OUTPUT ?? "dev-workout-benchmark.json", JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ functionalPassed: result.functionalPassed, requests: samples.length, startedAt, endedAt: result.endedAt, groups }));
if (!result.functionalPassed) process.exitCode = 1;
