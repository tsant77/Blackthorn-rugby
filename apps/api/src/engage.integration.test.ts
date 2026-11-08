import { addDays } from "@blackthorn/scoring";
import { beforeAll, describe, expect, it } from "vitest";
import app, { type Env } from "./app";
import { runScheduledJobs } from "./jobs";
import { openTestDatabase } from "./test-db";

describe("badges, challenges, and notifications", () => {
  let env: Env;
  let admin = "";
  let player = "";
  let forward = "";
  let today = "";

  beforeAll(async () => {
    env = {
      DB: openTestDatabase(),
      EMAIL_PROVIDER: "console",
      APP_ORIGIN: "http://localhost",
      BOOTSTRAP_ADMIN_EMAIL: "coach@blackthorn.test",
      EMAIL_FROM: "noreply@blackthorn.test",
    };
    admin = await signIn("coach@blackthorn.test");
    player = await invite("wing@blackthorn.test", "player");
    forward = await invite("prop@blackthorn.test", "player");
    await onboard(player, "Test Wing", "Left Wing");
    await onboard(forward, "Test Prop", "Hooker");
    const logged = await app.request("http://localhost/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ type: "running", durationMin: 40, clientRequestId: "badge-run" }),
    }, env);
    expect(logged.status).toBe(201);
    today = (await json<{ today: string }>("/api/workouts", player)).today;
    for (const day of [addDays(today, -1), addDays(today, -2)]) {
      const profile = (await json<{ profile: { id: string } }>("/api/me", player)).profile.id;
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO workouts (
          id, club_id, player_profile_id, type, occurred_on, duration_min, status, submitted_at, created_at, updated_at
        ) VALUES (?, 'club_blackthorn', ?, 'running', ?, 20, 'submitted', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), profile, day, now, now, now).run();
    }
    await app.request("http://localhost/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ type: "rugby", durationMin: 20, clientRequestId: "badge-rugby" }),
    }, env);
    await app.request("http://localhost/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ type: "football", durationMin: 20, clientRequestId: "badge-football" }),
    }, env);
    await app.request("http://localhost/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: forward },
      body: JSON.stringify({ type: "running", durationMin: 40, clientRequestId: "prop-run" }),
    }, env);
  });

  it("awards badges once", async () => {
    const first = await json<{ badges: { key: string; awarded_at: number | null }[] }>("/api/badges", player);
    const earned = first.badges.filter((badge) => badge.awarded_at).map((badge) => badge.key);
    expect(earned).toContain("first_session");
    expect(earned).toContain("streak_3");
    expect(earned).toContain("variety_3");
    expect(earned).not.toContain("points_50");
    const again = await json<{ badges: { key: string; awarded_at: number | null }[] }>("/api/badges", player);
    expect(again.badges.filter((badge) => badge.awarded_at)).toHaveLength(earned.length);
    const notes = await json<{ notifications: { kind: string; dedupe_key?: string }[] }>("/api/notifications", player);
    expect(notes.notifications.filter((note) => note.kind === "badge")).toHaveLength(earned.length);
  });

  it("tells the player a void was a mistake and does not email until they opt in", async () => {
    const history = await json<{ workouts: { id: string; type: string }[] }>("/api/workouts", player);
    const workout = history.workouts.find((row) => row.type === "football");
    const removed = await app.request(`http://localhost/api/moderation/${workout?.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ action: "void", reason: "Wrong sport" }),
    }, env);
    expect(removed.status).toBe(200);
    const inbox = await json<{ unread: number; notifications: { id: string; title: string; body: string; read_at: number | null }[] }>("/api/notifications", player);
    const note = inbox.notifications.find((row) => row.title === "Workout voided");
    expect(note?.body).toContain("logged by mistake");
    expect(note?.body).toContain("Wrong sport");
    expect(inbox.unread).toBeGreaterThan(0);
    const mailbox = await json<{ messages: { subject: string }[] }>(`/api/dev/mailbox?to=${encodeURIComponent("wing@blackthorn.test")}`, admin);
    expect(mailbox.messages.some((message) => message.subject === "Workout voided")).toBe(false);
    const read = await app.request(`http://localhost/api/notifications/${note?.id}/read`, { method: "POST", headers: { cookie: player } }, env);
    expect(read.status).toBe(200);
    const opted = await app.request("http://localhost/api/me/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ emailNotifications: true }),
    }, env);
    expect(opted.status).toBe(200);
    const restored = await app.request(`http://localhost/api/moderation/${workout?.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ action: "restore", reason: "It was football" }),
    }, env);
    expect(restored.status).toBe(200);
    const after = await json<{ messages: { subject: string; text_body: string }[] }>(`/api/dev/mailbox?to=${encodeURIComponent("wing@blackthorn.test")}`, admin);
    const mail = after.messages.find((message) => message.subject === "Workout restored");
    expect(mail?.text_body).toContain("It was football");
  });

  it("blocks a player from creating a challenge and shows group progress", async () => {
    const denied = await app.request("http://localhost/api/challenges", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ title: "Nope", description: "No", startOn: today, endOn: today, scope: "individual", metric: "sessions", target: 1 }),
    }, env);
    expect(denied.status).toBe(403);
    const created = await app.request("http://localhost/api/challenges", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({
        title: "Pack versus backs",
        description: "Minutes this week",
        startOn: today,
        endOn: addDays(today, 7),
        scope: "group",
        metric: "minutes",
        target: 30,
      }),
    }, env);
    expect(created.status).toBe(201);
    const board = await json<{ challenges: { title: string; sides: { name: string; display: string; complete: boolean }[]; summary: string }[] }>("/api/challenges", player);
    const challenge = board.challenges.find((row) => row.title === "Pack versus backs");
    expect(challenge?.sides.map((side) => side.name)).toEqual(["Backs", "Forwards"]);
    expect(challenge?.summary).toContain("Backs lead");
  });

  it("sends the weekly recap once from the scheduled job", async () => {
    const monday = addDays(today, weekday(today) === 0 ? 7 : 7 - weekday(today));
    const when = Date.parse(`${monday}T16:00:00Z`);
    await runScheduledJobs(env, when);
    const first = await json<{ notifications: { kind: string }[] }>("/api/notifications", player);
    const recaps = first.notifications.filter((note) => note.kind === "weekly_recap");
    expect(recaps).toHaveLength(1);
    await runScheduledJobs(env, when);
    const second = await json<{ notifications: { kind: string }[] }>("/api/notifications", player);
    expect(second.notifications.filter((note) => note.kind === "weekly_recap")).toHaveLength(1);
  });

  async function json<T>(path: string, cookie: string): Promise<T> {
    const response = await app.request(`http://localhost${path}`, { headers: { cookie } }, env);
    expect(response.status).toBe(200);
    return response.json() as Promise<T>;
  }

  async function signIn(email: string): Promise<string> {
    await app.request("http://localhost/api/auth/request", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.90" },
      body: JSON.stringify({ email }),
    }, env);
    return accept(email);
  }

  async function invite(email: string, role: string): Promise<string> {
    await app.request("http://localhost/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ email, role }),
    }, env);
    return accept(email);
  }

  async function accept(email: string): Promise<string> {
    const mailbox = await app.request(`http://localhost/api/dev/mailbox?to=${encodeURIComponent(email)}`, {}, env);
    const body = await mailbox.json() as { messages: { text_body: string }[] };
    const link = body.messages[0]?.text_body.match(/http:\/\/localhost\S+/)?.[0];
    if (!link) throw new Error(`No link for ${email}`);
    const verified = await app.request(link, {}, env);
    return verified.headers.get("set-cookie")?.split(";")[0] ?? "";
  }

  async function onboard(cookie: string, rosterName: string, positionName: string): Promise<void> {
    const options = await json<{ positions: { id: string; name: string }[] }>("/api/roster-options", cookie);
    const position = options.positions.find((row) => row.name === positionName);
    const response = await app.request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ rosterName, positionId: position?.id, injuryStatus: "available" }),
    }, env);
    expect(response.status).toBe(200);
  }
});

function weekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return (date.getUTCDay() + 6) % 7;
}
