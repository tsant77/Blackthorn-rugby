// Run only after the development rollout is explicitly approved. Never prints tokens or cookies.
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const origin = "https://blackthorn-rugby-dev.blackthorn-rugby.workers.dev";
if (process.env.RUN_DEV_AUTH_BENCHMARK !== "approved" || !process.env.DEV_AUTH_INPUT) {
  throw new Error("After deployment approval, set RUN_DEV_AUTH_BENCHMARK=approved and DEV_AUTH_INPUT to a private JSON file containing two synthetic players' personal links.");
}
let input;
try { input = JSON.parse(await readFile(process.env.DEV_AUTH_INPUT, "utf8")); }
catch { throw new Error("Could not read the private benchmark input JSON."); }
if (!Array.isArray(input.personalLinks) || input.personalLinks.length !== 2) throw new Error("Expected exactly two synthetic personalLinks.");
const tokens = input.personalLinks.map(value => {
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid personal link input."); }
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  if (url.origin !== origin || url.pathname !== "/player-login" || !/^[A-Za-z0-9_-]{43}$/.test(token ?? "")) throw new Error("Only development personal player links are accepted.");
  return token;
});
const samples = [];
const startedAt = new Date().toISOString();
async function login(token, concurrency, expected) {
  const start = performance.now();
  try {
    const response = await fetch(origin + "/api/auth/login", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", origin }, body: JSON.stringify({ token }),
    });
    await response.arrayBuffer();
    samples.push({ concurrency, expected, status: response.status, wallMs: performance.now() - start });
  } catch { samples.push({ concurrency, expected, status: "network-error", wallMs: performance.now() - start }); }
}
// 30 valid logins + 5 invalid attempts stay below the 60/IP/15 min limit on a quiet dev IP.
for (let repeat = 0; repeat < 2; repeat++) {
  for (const concurrency of [1, 2, 4, 8]) await Promise.all(Array.from({ length: concurrency }, (_, i) => login(tokens[i % 2], concurrency, 200)));
}
for (let i = 0; i < 5; i++) await login(randomBytes(32).toString("base64url"), 1, 401);
const endedAt = new Date().toISOString();
const summaries = [1, 2, 4, 8].map(concurrency => {
  const values = samples.filter(s => s.concurrency === concurrency && s.expected === 200).map(s => s.wallMs).sort((a,b) => a-b);
  const percentile = p => values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
  return { concurrency, count: values.length, p50WallMs: percentile(0.5), p95WallMs: percentile(0.95), maxWallMs: values.at(-1) };
});
const result = { worker: "blackthorn-rugby-dev", startedAt, endedAt, passed: samples.every(s => s.status === s.expected), summaries, samples,
  cpu: "Not measured by this HTTP client. Attach Workers invocation CPUTimeMs, outcome, and deployed version for this time window. Wall time is not CPU time." };
await writeFile(process.env.DEV_AUTH_OUTPUT ?? "dev-auth-benchmark.json", JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ startedAt, endedAt, passed: result.passed, summaries }));
if (!result.passed) process.exitCode = 1;
