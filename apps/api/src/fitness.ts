import {
  addDays,
  defaultRule,
  FITNESS_CATEGORIES,
  type FitnessCategory,
  type ScoringRule,
} from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";

export function monday(date: string) {
  const day = new Date(date + "T12:00:00Z").getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

/** Statements run in the SAME D1 transaction as the workout mutation. No read-then-write bonus race. */
export async function consistencyStatements(
  db: D1Database,
  profile: string,
  dates: string[],
  actor: string,
  now: number,
) {
  const statements: D1PreparedStatement[] = [];
  for (const start of new Set(dates.map(monday))) {
    const end = addDays(start, 6);
    // Select the Monday rule and initialize its snapshot in the mutation transaction.
    // Existing snapshots remain unchanged; pre-first-rule weeks use the earliest version.
    // SQLite's indexed player/date range is at most seven days, irrespective of account history.
    const days = `(SELECT COUNT(*) FROM (SELECT occurred_on FROM workouts WHERE player_profile_id=s.profile_id
      AND occurred_on>='${start}' AND occurred_on<='${end}' AND status IN ('submitted','approved') GROUP BY occurred_on
      HAVING SUM(duration_min)>=COALESCE(json_extract(s.rule_json,'$.consistencyMinMinutes'),20)))`;
    const target = `(SELECT COALESCE(MAX(CAST(json_extract(value,'$.pointsTenths') AS INTEGER)),0)
      FROM json_each(s.rule_json,'$.consistency') WHERE CAST(json_extract(value,'$.days') AS INTEGER)<=${days})`;
    // Dates come from validated civil dates or stored workouts, never arbitrary request SQL.
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO weekly_consistency(id,profile_id,week_start,rule_id,rule_json,points_tenths)
           SELECT ?,?,?,r.id,json_object(
             'consistency',json(COALESCE(json_extract(r.config_json,'$.consistency'),'[]')),
             'consistencyMinMinutes',COALESCE(json_extract(r.config_json,'$.consistencyMinMinutes'),20)
           ),0 FROM scoring_rule_versions r WHERE r.club_id=? AND r.id=COALESCE(
             (SELECT id FROM scoring_rule_versions WHERE club_id=? AND (effective_on IS NULL OR effective_on<=?)
              ORDER BY effective_on DESC,version DESC LIMIT 1),
             (SELECT id FROM scoring_rule_versions WHERE club_id=? ORDER BY version LIMIT 1)
           )`,
        )
        .bind(crypto.randomUUID(), profile, start, clubCatalog.id, clubCatalog.id, start, clubCatalog.id),
      db
        .prepare(
          `UPDATE weekly_consistency AS s SET pending_points_tenths=${target} WHERE s.profile_id=? AND s.week_start=?`,
        )
        .bind(profile, start),
      db
        .prepare(
          `INSERT INTO point_transactions(id,club_id,player_profile_id,workout_id,rule_version_id,kind,points_tenths,reason_code,reason_detail,occurred_on,created_by,created_at)
        SELECT ?,?,s.profile_id,NULL,s.rule_id,CASE WHEN s.pending_points_tenths<s.points_tenths THEN 'reversal' ELSE 'adjustment' END,
        s.pending_points_tenths-s.points_tenths,'weekly_consistency','Highest weekly consistency bonus; non-cumulative',s.week_start,?,?
        FROM weekly_consistency s WHERE s.profile_id=? AND s.week_start=? AND s.pending_points_tenths<>s.points_tenths`,
        )
        .bind(crypto.randomUUID(), clubCatalog.id, actor, now, profile, start),
      db
        .prepare(
          `UPDATE weekly_consistency AS s SET points_tenths=s.pending_points_tenths WHERE s.profile_id=? AND s.week_start=?`,
        )
        .bind(profile, start),
    );
  }
  return statements;
}

/** A NOT NULL failure aborts the entire D1 batch when another mutation wins. */
export function revisionGuard(
  db: D1Database,
  id: string,
  revision: number,
  status: string,
) {
  return db
    .prepare(
      `UPDATE workouts SET scoring_revision=CASE WHEN scoring_revision=? AND status=? THEN scoring_revision+1 ELSE NULL END WHERE id=?`,
    )
    .bind(revision, status, id);
}
export function mutationConflict(error: unknown) {
  return String(error).includes("scoring_revision");
}

/** Apply the daily cap INSIDE the mutation batch after the formula/session rows are inserted. */
export function dailyCapStatement(
  db: D1Database,
  profile: string,
  workout: string,
  ruleId: string,
  date: string,
  cap: number,
  actor: string,
  now: number,
) {
  return db
    .prepare(
      `INSERT INTO point_transactions(id,club_id,player_profile_id,workout_id,rule_version_id,kind,points_tenths,reason_code,created_by,created_at)
    SELECT ?,?,?,?,?,'cap_reduction',-reduction,'daily_cap',?,? FROM (SELECT MIN(
      MAX(0,(SELECT COALESCE(SUM(t.points_tenths),0) FROM point_transactions t JOIN workouts w ON w.id=t.workout_id
        WHERE w.player_profile_id=? AND w.occurred_on=? AND w.status IN ('submitted','approved'))-?),
      MAX(0,(SELECT COALESCE(SUM(points_tenths),0) FROM point_transactions WHERE workout_id=?))) AS reduction) WHERE reduction>0`,
    )
    .bind(
      crypto.randomUUID(),
      clubCatalog.id,
      profile,
      workout,
      ruleId,
      actor,
      now,
      profile,
      date,
      cap,
      workout,
    );
}

export async function trainingBalance(
  db: D1Database,
  profile: string,
  start: string,
  end: string,
) {
  const rows = await db
    .prepare(
      `SELECT w.type,w.rule_version_id,r.config_json,SUM(w.duration_min) AS minutes
    FROM workouts w LEFT JOIN scoring_rule_versions r ON r.id=w.rule_version_id
    WHERE w.player_profile_id=? AND w.occurred_on>=? AND w.occurred_on<=? AND w.status IN ('submitted','approved')
    GROUP BY w.type,w.rule_version_id,r.config_json`,
    )
    .bind(profile, start, end)
    .all<{ type: string; config_json: string | null; minutes: number }>();
  const totals = Object.fromEntries(
    FITNESS_CATEGORIES.map((c) => [c, 0]),
  ) as Record<FitnessCategory, number>;
  const defaults = defaultRule();
  for (const row of rows.results) {
    const rule = row.config_json
      ? (JSON.parse(row.config_json) as ScoringRule)
      : defaults;
    const categories =
      rule.types[row.type]?.categories ??
      defaults.types[row.type]?.categories ??
      [];
    for (const category of categories)
      totals[category] += Number(row.minutes) / categories.length;
  }
  return FITNESS_CATEGORIES.map((category) => ({
    category,
    minutes: Math.round(totals[category] * 10) / 10,
  }));
}
