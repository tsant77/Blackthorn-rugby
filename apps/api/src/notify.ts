import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";

const CLUB_ID = clubCatalog.id;

export async function notifyUser(env: Env, input: {
  userId: string;
  email: string;
  emailOptIn: boolean;
  kind: string;
  title: string;
  body: string;
  dedupeKey: string | null;
  now: number;
}): Promise<boolean> {
  if (input.dedupeKey) {
    const existing = await env.DB.prepare(
      "SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?",
    ).bind(input.userId, input.dedupeKey).first<{ id: string }>();
    if (existing) return false;
  }
  await env.DB.prepare(
    `INSERT INTO notifications (id, club_id, user_id, kind, title, body, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), CLUB_ID, input.userId, input.kind, input.title, input.body, input.dedupeKey, input.now).run();
  return true;
}

export function reviewCopy(action: "reject" | "void" | "restore", activity: string, occurredOn: string, reason: string): { title: string; body: string } {
  const session = `${activity.replaceAll("_", " ")} on ${occurredOn}`;
  if (action === "reject") {
    return { title: "Workout rejected", body: `A coach marked your ${session} as not a legitimate session. ${reason}` };
  }
  if (action === "void") {
    return { title: "Workout voided", body: `A coach marked your ${session} as logged by mistake. ${reason}` };
  }
  return { title: "Workout restored", body: `A coach restored your ${session}. The points from the reversal are back. ${reason}` };
}

export async function notifyReview(env: Env, workoutId: string, action: "reject" | "void" | "restore", reason: string, now: number): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT w.type, w.occurred_on, w.player_profile_id, u.id AS user_id, u.email, u.email_notifications
     FROM workouts w
     JOIN player_profiles pr ON pr.id = w.player_profile_id
     JOIN club_memberships m ON m.id = pr.membership_id
     JOIN users u ON u.id = m.user_id
     WHERE w.id = ? AND m.club_id = ?`,
  ).bind(workoutId, CLUB_ID).first<{
    type: string;
    occurred_on: string;
    player_profile_id: string;
    user_id: string;
    email: string;
    email_notifications: number;
  }>();
  if (!row) return;
  const copy = reviewCopy(action, row.type, row.occurred_on, reason);
  await notifyUser(env, {
    userId: row.user_id,
    email: row.email,
    emailOptIn: optedIn(row.email_notifications),
    kind: `workout_${action}`,
    title: copy.title,
    body: copy.body,
    dedupeKey: `review:${action}:${workoutId}:${now}`,
    now,
  });
}

export function optedIn(value: number | boolean | null): boolean {
  return value === 1 || value === true;
}
