import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schemaTables } from "./schema";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function migrationSql(): string {
  const directory = join(packageRoot, "migrations");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(directory, name), "utf8"))
    .join("\n");
}

describe("D1 migration", () => {
  const sql = migrationSql();

  it("creates every Drizzle table", () => {
    for (const table of schemaTables) {
      const name = getTableName(table);
      expect(sql).toMatch(new RegExp(`CREATE TABLE\\s+[\`"]${name}[\`"]`, "i"));
    }
  });

  it("keeps the points ledger and the audit log append-only", () => {
    expect(sql).toMatch(/point_transactions_no_update/i);
    expect(sql).toMatch(/point_transactions_no_delete/i);
    expect(sql).toMatch(/audit_events_no_update/i);
    expect(sql).toMatch(/audit_events_no_delete/i);
  });

  it("seeds club config and does not seed people", () => {
    const lowered = sql.toLowerCase();
    expect(lowered).toContain("blackthorn rugby club");
    expect(lowered).toContain("loosehead prop");
    expect(lowered).not.toMatch(/insert into [`"]?(users|player_profiles|workouts|credentials)[`"]?/);
  });
});
