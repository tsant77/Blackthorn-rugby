/** Club configuration seeded for the single Blackthorn club. No player names. */
export const SEEDED_AT_MS = 1794096000000;

export const clubCatalog = {
  id: "club_blackthorn",
  name: "Blackthorn Rugby Club",
  slug: "blackthorn",
  timezone: "America/New_York",
} as const;

export const offseasonCatalog = {
  id: "period_offseason_2026",
  name: "2026-27 offseason",
  startOn: "2026-11-08",
  endOn: "2027-04-30",
} as const;

export const groupCatalog = [
  { id: "group_forwards", name: "Forwards", kind: "position_group", sortOrder: 1 },
  { id: "group_backs", name: "Backs", kind: "position_group", sortOrder: 2 },
] as const;

/**
 * Standard XV positions. Lock is one position shared by shirts 4 and 5.
 * Wings are split so a player can say which wing they play.
 */
export const positionCatalog = [
  { id: "pos_loosehead_prop", name: "Loosehead Prop", groupId: "group_forwards", sortOrder: 1 },
  { id: "pos_hooker", name: "Hooker", groupId: "group_forwards", sortOrder: 2 },
  { id: "pos_tighthead_prop", name: "Tighthead Prop", groupId: "group_forwards", sortOrder: 3 },
  { id: "pos_lock", name: "Lock", groupId: "group_forwards", sortOrder: 4 },
  { id: "pos_blindside_flanker", name: "Blindside Flanker", groupId: "group_forwards", sortOrder: 5 },
  { id: "pos_openside_flanker", name: "Openside Flanker", groupId: "group_forwards", sortOrder: 6 },
  { id: "pos_number_8", name: "Number 8", groupId: "group_forwards", sortOrder: 7 },
  { id: "pos_scrum_half", name: "Scrum-half", groupId: "group_backs", sortOrder: 8 },
  { id: "pos_fly_half", name: "Fly-half", groupId: "group_backs", sortOrder: 9 },
  { id: "pos_inside_centre", name: "Inside Centre", groupId: "group_backs", sortOrder: 10 },
  { id: "pos_outside_centre", name: "Outside Centre", groupId: "group_backs", sortOrder: 11 },
  { id: "pos_left_wing", name: "Left Wing", groupId: "group_backs", sortOrder: 12 },
  { id: "pos_right_wing", name: "Right Wing", groupId: "group_backs", sortOrder: 13 },
  { id: "pos_fullback", name: "Fullback", groupId: "group_backs", sortOrder: 14 },
] as const;

export const scoringRuleId = "rule_v1";
