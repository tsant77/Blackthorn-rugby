import { clubCatalog } from "@blackthorn/db/catalog";
import type { ScoringRule } from "@blackthorn/scoring";

export async function ruleForDate(db: D1Database, date: string, id?: string) {
  const row = id
    ? await db
        .prepare(
          "SELECT id,version,config_json,effective_on FROM scoring_rule_versions WHERE club_id=? AND id=?",
        )
        .bind(clubCatalog.id, id)
        .first<RuleRow>()
    : await db
        .prepare(
          `SELECT id,version,config_json,effective_on FROM scoring_rule_versions WHERE club_id=?
        AND (effective_on IS NULL OR effective_on<=?) ORDER BY CASE WHEN version>=COALESCE((SELECT MAX(mr.version) FROM scoring_rule_versions mr
 WHERE mr.club_id=scoring_rule_versions.club_id AND json_extract(mr.config_json,'$.scoringModel')='met-v1'
 AND (mr.effective_on IS NULL OR mr.effective_on<=?2)),2147483647) THEN 1 ELSE 0 END DESC,effective_on DESC,version DESC LIMIT 1`,
        )
        .bind(clubCatalog.id, date)
        .first<RuleRow>();
  const fallback =
    row ??
    (await db
      .prepare(
        "SELECT id,version,config_json,effective_on FROM scoring_rule_versions WHERE club_id=? ORDER BY version LIMIT 1",
      )
      .bind(clubCatalog.id)
      .first<RuleRow>());
  if (!fallback) throw new Error("No scoring rule available.");
  return {
    id: fallback.id,
    effectiveOn: fallback.effective_on,
    rule: {
      ...JSON.parse(fallback.config_json),
      version: fallback.version,
      status: "active",
    } as ScoringRule,
  };
}
interface RuleRow {
  id: string;
  version: number;
  config_json: string;
  effective_on: string | null;
}
