import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const migrationDir = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/migrations");

export function openTestDatabase(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(migrationDir).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(migrationDir, name), "utf8").replaceAll("--> statement-breakpoint", "");
    sqlite.exec(sql);
  }

  function statement(sql: string, params: unknown[]) {
    return {
      async run() {
        const info = sqlite.prepare(sql).run(...(params as Array<string | number | null | bigint | Uint8Array>));
        return { success: true, meta: { changes: info.changes } };
      },
      async first<T>() {
        const row = sqlite.prepare(sql).get(...(params as Array<string | number | null | bigint | Uint8Array>));
        return (row ?? null) as T | null;
      },
      async all<T>() {
        return { results: sqlite.prepare(sql).all(...(params as Array<string | number | null | bigint | Uint8Array>)) as T[] };
      },
    };
  }

  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return statement(sql, params);
        },
      };
    },
    async batch<T>(statements: { run: () => Promise<T> }[]) {
      sqlite.exec("BEGIN");
      try {
        const results: T[] = [];
        for (const entry of statements) results.push(await entry.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
}

/** Synthetic session fixture for domain tests; authentication itself is tested through routes. */
export async function testMemberSession(db: D1Database, label: string, role = "player"): Promise<string> {
  const { randomToken, sha256Hex } = await import("./tokens");
  const id = crypto.randomUUID(), now = Date.now(), token = randomToken();
  await db.batch([
    db.prepare("INSERT INTO users(id,email,name,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)")
      .bind(id, `m.${id}@members.invalid`, label.split("@")[0]!, now, now),
    db.prepare("INSERT INTO club_memberships(id,club_id,user_id,role,status,created_at,updated_at) VALUES(?,'club_blackthorn',?,?,'active',?,?)")
      .bind(crypto.randomUUID(), id, role, now, now),
    db.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), id, await sha256Hex(token), now + 180 * 86400000, now),
  ]);
  return `blackthorn_session=${token}`;
}
