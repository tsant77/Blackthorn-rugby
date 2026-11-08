-- One club, forwards/backs, standard XV positions, and the confirmed offseason.
-- No player rows. The first admin is created from BOOTSTRAP_ADMIN_EMAIL, not from this file.
INSERT INTO clubs (id, name, slug, timezone, created_at, updated_at)
VALUES ('club_blackthorn', 'Blackthorn Rugby Club', 'blackthorn', 'America/New_York', 1794096000000, 1794096000000);

INSERT INTO groups (id, club_id, name, kind, sort_order, created_at, updated_at) VALUES
  ('group_forwards', 'club_blackthorn', 'Forwards', 'position_group', 1, 1794096000000, 1794096000000),
  ('group_backs', 'club_blackthorn', 'Backs', 'position_group', 2, 1794096000000, 1794096000000);

INSERT INTO positions (id, club_id, group_id, name, sort_order, created_at, updated_at) VALUES
  ('pos_loosehead_prop', 'club_blackthorn', 'group_forwards', 'Loosehead Prop', 1, 1794096000000, 1794096000000),
  ('pos_hooker', 'club_blackthorn', 'group_forwards', 'Hooker', 2, 1794096000000, 1794096000000),
  ('pos_tighthead_prop', 'club_blackthorn', 'group_forwards', 'Tighthead Prop', 3, 1794096000000, 1794096000000),
  ('pos_lock', 'club_blackthorn', 'group_forwards', 'Lock', 4, 1794096000000, 1794096000000),
  ('pos_blindside_flanker', 'club_blackthorn', 'group_forwards', 'Blindside Flanker', 5, 1794096000000, 1794096000000),
  ('pos_openside_flanker', 'club_blackthorn', 'group_forwards', 'Openside Flanker', 6, 1794096000000, 1794096000000),
  ('pos_number_8', 'club_blackthorn', 'group_forwards', 'Number 8', 7, 1794096000000, 1794096000000),
  ('pos_scrum_half', 'club_blackthorn', 'group_backs', 'Scrum-half', 8, 1794096000000, 1794096000000),
  ('pos_fly_half', 'club_blackthorn', 'group_backs', 'Fly-half', 9, 1794096000000, 1794096000000),
  ('pos_inside_centre', 'club_blackthorn', 'group_backs', 'Inside Centre', 10, 1794096000000, 1794096000000),
  ('pos_outside_centre', 'club_blackthorn', 'group_backs', 'Outside Centre', 11, 1794096000000, 1794096000000),
  ('pos_left_wing', 'club_blackthorn', 'group_backs', 'Left Wing', 12, 1794096000000, 1794096000000),
  ('pos_right_wing', 'club_blackthorn', 'group_backs', 'Right Wing', 13, 1794096000000, 1794096000000),
  ('pos_fullback', 'club_blackthorn', 'group_backs', 'Fullback', 14, 1794096000000, 1794096000000);

INSERT INTO competition_periods (id, club_id, kind, name, start_on, end_on, status, created_at, updated_at)
VALUES ('period_offseason_2026', 'club_blackthorn', 'offseason', '2026-27 offseason', '2026-11-08', '2027-04-30', 'active', 1794096000000, 1794096000000);

INSERT INTO scoring_rule_versions (
  id, club_id, version, status, daily_cap_tenths, session_cap_tenths, weekly_load_limit, backdate_days,
  config_json, notes, created_by, created_at, activated_at, retired_at
) VALUES (
  'rule_v1',
  'club_blackthorn',
  1,
  'active',
  300,
  150,
  600,
  7,
  '{"version":1,"status":"active","dailyCapTenths":300,"sessionCapTenths":150,"backdateDays":7,"minDurationMin":1,"maxDurationMin":240,"weeklyLoadLimit":600,"duplicateStartWindowMin":15,"maxNotesLength":500,"maxLoadGrams":400000,"allowedWhenLimited":[],"types":{"running":{"multiplierHundredths":150,"allowsDistance":true,"maxDistanceM":100000,"minPaceSecPerKm":150,"minSplitSecPer500":null},"rower":{"multiplierHundredths":150,"allowsDistance":true,"maxDistanceM":60000,"minPaceSecPerKm":null,"minSplitSecPer500":80},"circuit_training":{"multiplierHundredths":150,"allowsDistance":false,"maxDistanceM":null,"minPaceSecPerKm":null,"minSplitSecPer500":null},"weight_training":{"multiplierHundredths":125,"allowsDistance":false,"maxDistanceM":null,"minPaceSecPerKm":null,"minSplitSecPer500":null},"rugby":{"multiplierHundredths":125,"allowsDistance":false,"maxDistanceM":null,"minPaceSecPerKm":null,"minSplitSecPer500":null},"basketball":{"multiplierHundredths":100,"allowsDistance":false,"maxDistanceM":null,"minPaceSecPerKm":null,"minSplitSecPer500":null},"football":{"multiplierHundredths":100,"allowsDistance":false,"maxDistanceM":null,"minPaceSecPerKm":null,"minSplitSecPer500":null}},"intensityHundredths":{"easy":85,"moderate":100,"hard":115,"max":125},"intensityLoadHundredths":{"easy":75,"moderate":100,"hard":125,"max":150}}',
  'Owner-confirmed defaults: 15 points per session, 30 per day, 600 weighted minutes per 7 days.',
  NULL,
  1794096000000,
  1794096000000,
  NULL
);
