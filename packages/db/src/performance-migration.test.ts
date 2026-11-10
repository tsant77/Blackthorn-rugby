import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("performance migration preservation", () => {
  it("retains every pre-existing column, including workout, exercise and immutable ledger history", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
    const files = readdirSync(directory).filter(f=>f.endsWith(".sql")).sort();
    for(const file of files.filter(f=>f!=="0010_performance_tracking.sql")) db.exec(readFileSync(directory+file,"utf8"));
    db.exec(`INSERT INTO users(id,email,name,status,created_at,updated_at) VALUES('old_user','old@members.invalid','Original','active',1,1);
      INSERT INTO club_memberships(id,club_id,user_id,role,status,created_at,updated_at) VALUES('old_member','club_blackthorn','old_user','player','active',1,1);
      INSERT INTO player_profiles(id,membership_id,roster_name,injury_status,training_locked,created_at,updated_at) VALUES('old_profile','old_member','Original','available',0,1,1);
      INSERT INTO workouts(id,club_id,player_profile_id,type,occurred_on,duration_min,intensity,distance_m,notes,status,rule_version_id,submitted_at,created_at,updated_at)
      VALUES('old_workout','club_blackthorn','old_profile','running','2026-11-08',30,'moderate',5000,'Keep this','submitted','rule_v1',1,1,1);
      INSERT INTO workout_exercises(id,workout_id,club_id,name,sets,reps,load_grams,sort_order,created_at) VALUES('old_exercise','old_workout','club_blackthorn','Legacy custom lift',3,5,60000,0,1);
      INSERT INTO point_transactions(id,club_id,player_profile_id,workout_id,rule_version_id,kind,points_tenths,reason_code,created_at)
      VALUES('old_award','club_blackthorn','old_profile','old_workout','rule_v1','award',45,'workout',1);`);
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name as string);
    const before=tables.map(table=>({table,columns:db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name as string),rows:db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()}));
    db.exec(readFileSync(directory+"0010_performance_tracking.sql","utf8"));
    for(const saved of before) expect(db.prepare(`SELECT ${saved.columns.map(c=>`"${c}"`).join(",")} FROM "${saved.table}" ORDER BY rowid`).all(),saved.table).toEqual(saved.rows);
    expect(db.prepare("SELECT performance_public FROM player_profiles").get()?.performance_public).toBe(0);
    expect(db.prepare("SELECT calories,calorie_source FROM workouts").get()).toEqual({calories:null,calorie_source:null});
    expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(()=>db.exec("UPDATE point_transactions SET points_tenths=99")).toThrow();
    db.close();
  });
});
