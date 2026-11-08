import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  defaultRule,
  isRealCivilDate,
  formulaTenths,
  validateRule,
  type ScoringRule,
} from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";
import { scoringBasis } from "./workouts";

type C = Context<{ Bindings: Env }>;
type Actor = { user_id: string; role: string };

export function registerScoringSettings(
  app: Hono<{ Bindings: Env }>,
  session: (c: C) => Promise<Actor | null>,
) {
  app.use(
    "/api/rules",
    bodyLimit({
      maxSize: 32768,
      onError: (c) => c.json({ error: "Settings payload is too large." }, 413),
    }),
  );
  app.use(
    "/api/scoring-settings/*",
    bodyLimit({
      maxSize: 32768,
      onError: (c) => c.json({ error: "Settings payload is too large." }, 413),
    }),
  );
  app.use(
    "/api/scoring-settings",
    bodyLimit({
      maxSize: 32768,
      onError: (c) => c.json({ error: "Settings payload is too large." }, 413),
    }),
  );
  app.get("/api/scoring-settings", async (c) => {
    const actor = await session(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    if (actor.role !== "admin") return c.json({ error: "Admins only." }, 403);
    // The settings screen needs the active rule and today's date, not leaderboard
    // week/month boundaries. Fetch independent data without serial D1 waits.
    const [context, rows] = await Promise.all([
      scoringBasis(c.env.DB),
      c.env.DB.prepare(
        "SELECT id,version,effective_on,config_json,notes,created_at FROM scoring_rule_versions WHERE club_id=? ORDER BY version DESC",
      )
        .bind(clubCatalog.id)
        .all<{
          id: string;
          version: number;
          effective_on: string | null;
          config_json: string;
          notes: string | null;
        }>(),
    ]);
    return c.json({
      today: context.today,
      currentId: context.ruleId,
      current: context.rule,
      defaults: defaultRule(),
      latestVersion: rows.results[0]?.version,
      versions: rows.results.map((r) => ({
        ...r,
        config_json: undefined,
        config: JSON.parse(r.config_json),
      })),
    });
  });
  app.post("/api/scoring-settings/preview", async (c) => {
    const actor = await session(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    if (actor.role !== "admin") return c.json({ error: "Admins only." }, 403);
    const body = await read(c),
      rule = body?.config as ScoringRule;
    const error = validateRule(rule);
    if (error) return c.json({ error }, 400);
    const duration = body?.durationMin,
      type = body?.type,
      intensity = body?.intensity;
    if (
      !Number.isInteger(duration) ||
      Number(duration) < 1 ||
      Number(duration) > 240 ||
      typeof type !== "string" ||
      !Object.hasOwn(rule.types, type) ||
      rule.types[type]!.enabled === false ||
      !["easy", "moderate", "hard", "max"].includes(String(intensity))
    )
      return c.json({ error: "Invalid preview workout." }, 400);
    const gross = formulaTenths(
      Number(duration),
      rule.types[type]!.multiplierHundredths,
      rule.intensityHundredths[
        intensity as keyof ScoringRule["intensityHundredths"]
      ],
    );
    return c.json({
      grossPointsTenths: gross,
      pointsTenths: Math.min(gross, rule.sessionCapTenths, rule.dailyCapTenths),
      note: "Before other workouts, training limits, and weekly bonuses.",
    });
  });
  app.post("/api/scoring-settings", async (c) => {
    const actor = await session(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    if (actor.role !== "admin") return c.json({ error: "Admins only." }, 403);
    return publishScoringRule(c, actor.user_id);
  });
}

export async function publishScoringRule(c: C, actor: string) {
  const body = await read(c);
  if (!body) return c.json({ error: "Invalid settings." }, 400);
  const context = await scoringBasis(c.env.DB);
  const latest = await c.env.DB.prepare(
    "SELECT MAX(version) AS version FROM scoring_rule_versions WHERE club_id=?",
  )
    .bind(clubCatalog.id)
    .first<{ version: number }>();
  const expected = body.expectedVersion ?? latest?.version;
  if (expected !== latest?.version)
    return c.json(
      { error: "Settings changed. Reload before publishing." },
      409,
    );
  // Retain the old caps endpoint as a validated compatibility adapter.
  const config: ScoringRule = structuredClone(
    (body.config ?? {
      ...context.rule,
      dailyCapTenths: body.dailyCapTenths,
      sessionCapTenths: body.sessionCapTenths,
      weeklyLoadLimit: body.weeklyLoadLimit,
    }) as ScoringRule,
  );
  if (!config || typeof config !== "object")
    return c.json({ error: "Invalid scoring configuration." }, 400);
  config.version = Number(expected) + 1;
  config.status = "active";
  const error = validateRule(config);
  if (error) return c.json({ error }, 400);
  const date = body.effectiveOn;
  if (
    typeof date !== "string" ||
    !isRealCivilDate(date) ||
    date < context.today
  )
    return c.json({ error: "Effective date must be today or later." }, 400);
  const keys = await c.env.DB.prepare(
    "SELECT DISTINCT j.key AS id FROM scoring_rule_versions r,json_each(r.config_json,'$.types') j WHERE r.club_id=?",
  )
    .bind(clubCatalog.id)
    .all<{ id: string }>();
  if (keys.results.some((r) => !Object.hasOwn(config.types, r.id)))
    return c.json(
      {
        error:
          "Existing activity identifiers must be retained; disable or rename their labels instead.",
      },
      400,
    );
  const id = crypto.randomUUID(),
    now = Date.now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO scoring_rule_versions(id,club_id,version,status,daily_cap_tenths,session_cap_tenths,weekly_load_limit,backdate_days,config_json,notes,effective_on,created_by,created_at)
      SELECT ?,?,?,'draft',?,?,?,?,?,?,?,?,? WHERE (SELECT MAX(version) FROM scoring_rule_versions WHERE club_id=?)=?`,
    ).bind(
      id,
      clubCatalog.id,
      config.version,
      config.dailyCapTenths,
      config.sessionCapTenths,
      config.weeklyLoadLimit,
      config.backdateDays,
      JSON.stringify(config),
      typeof body.notes === "string" ? body.notes.slice(0, 200) : null,
      date,
      actor,
      now,
      clubCatalog.id,
      expected,
    ),
    c.env.DB.prepare(
      `INSERT INTO audit_events(id,club_id,actor_user_id,action,entity_type,entity_id,after_json,created_at)
      SELECT ?,?,?,'scoring_published','scoring_rule_version',?,?,? WHERE EXISTS(SELECT 1 FROM scoring_rule_versions WHERE id=?)`,
    ).bind(
      crypto.randomUUID(),
      clubCatalog.id,
      actor,
      id,
      JSON.stringify({ version: config.version, effectiveOn: date }),
      now,
      id,
    ),
  ]);
  if (results[0]!.meta.changes !== 1)
    return c.json(
      { error: "Settings changed. Reload before publishing." },
      409,
    );
  return c.json(
    {
      ok: true,
      id,
      version: config.version,
      status: date > context.today ? "draft" : "active",
    },
    201,
  );
}
async function read(c: C): Promise<Record<string, unknown> | null> {
  try {
    const v = await c.req.json();
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
