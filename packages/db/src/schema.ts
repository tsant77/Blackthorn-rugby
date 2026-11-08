import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull();
const updatedAt = () => integer("updated_at", { mode: "timestamp_ms" }).notNull();

export const clubs = sqliteTable("clubs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("clubs_slug_unique").on(table.slug),
]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  emailVerifiedAt: integer("email_verified_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  check("users_status_chk", sql`${table.status} IN ('invited', 'active', 'disabled')`),
]);

/** Unused. Access is magic-link only; this table is not written. */
export const credentials = sqliteTable("credentials", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "restrict" }),
  passwordHash: text("password_hash"),
  passwordUpdatedAt: integer("password_updated_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  userAgent: text("user_agent"),
}, (table) => [
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  index("sessions_user_idx").on(table.userId),
]);

export const magicLinks = sqliteTable("magic_links", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("magic_links_token_hash_unique").on(table.tokenHash),
  index("magic_links_email_idx").on(table.email, table.createdAt),
]);

/** Local/dev only. The console email provider writes bodies here so tests can read magic links. */
export const devMailbox = sqliteTable("dev_mailbox", {
  id: text("id").primaryKey(),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  textBody: text("text_body").notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("dev_mailbox_to_idx").on(table.toAddress, table.createdAt),
]);

export const loginAttempts = sqliteTable("login_attempts", {
  id: text("id").primaryKey(),
  bucketKey: text("bucket_key").notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("login_attempts_bucket_idx").on(table.bucketKey, table.createdAt),
]);

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  invitedBy: text("invited_by").references(() => users.id, { onDelete: "restrict" }),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
  index("invitations_club_email_idx").on(table.clubId, table.email),
  check("invitations_role_chk", sql`${table.role} IN ('player', 'coach', 'admin')`),
]);

export const clubMemberships = sqliteTable("club_memberships", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  role: text("role").notNull(),
  status: text("status").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("club_memberships_club_user_unique").on(table.clubId, table.userId),
  index("club_memberships_club_role_idx").on(table.clubId, table.role, table.status),
  check("club_memberships_role_chk", sql`${table.role} IN ('player', 'coach', 'admin')`),
  check("club_memberships_status_chk", sql`${table.status} IN ('active', 'deactivated')`),
]);

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("groups_club_name_unique").on(table.clubId, table.name),
  check("groups_kind_chk", sql`${table.kind} IN ('position_group', 'training_group')`),
]);

export const positions = sqliteTable("positions", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  groupId: text("group_id").references(() => groups.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("positions_club_name_unique").on(table.clubId, table.name),
  index("positions_group_idx").on(table.groupId),
]);

export const playerProfiles = sqliteTable("player_profiles", {
  id: text("id").primaryKey(),
  membershipId: text("membership_id").notNull().references(() => clubMemberships.id, { onDelete: "restrict" }),
  rosterName: text("roster_name").notNull(),
  positionId: text("position_id").references(() => positions.id, { onDelete: "restrict" }),
  groupId: text("group_id").references(() => groups.id, { onDelete: "restrict" }),
  jerseyNumber: integer("jersey_number"),
  injuryStatus: text("injury_status").notNull(),
  trainingLocked: integer("training_locked", { mode: "boolean" }).notNull(),
  injuryNote: text("injury_note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("player_profiles_membership_unique").on(table.membershipId),
  index("player_profiles_position_idx").on(table.positionId),
  index("player_profiles_group_idx").on(table.groupId),
  check("player_profiles_injury_chk", sql`${table.injuryStatus} IN ('available', 'limited', 'out')`),
  check("player_profiles_jersey_chk", sql`${table.jerseyNumber} IS NULL OR ${table.jerseyNumber} BETWEEN 1 AND 99`),
]);

export const competitionPeriods = sqliteTable("competition_periods", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  startOn: text("start_on").notNull(),
  endOn: text("end_on").notNull(),
  status: text("status").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("competition_periods_club_idx").on(table.clubId, table.status),
  uniqueIndex("competition_periods_one_active_offseason")
    .on(table.clubId)
    .where(sql`${table.kind} = 'offseason' AND ${table.status} = 'active'`),
  check("competition_periods_kind_chk", sql`${table.kind} IN ('offseason', 'custom')`),
  check("competition_periods_status_chk", sql`${table.status} IN ('scheduled', 'active', 'closed')`),
]);

export const scoringRuleVersions = sqliteTable("scoring_rule_versions", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  dailyCapTenths: integer("daily_cap_tenths").notNull(),
  sessionCapTenths: integer("session_cap_tenths").notNull(),
  weeklyLoadLimit: integer("weekly_load_limit").notNull(),
  backdateDays: integer("backdate_days").notNull(),
  configJson: text("config_json").notNull(),
  notes: text("notes"),
  effectiveOn: text("effective_on"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
  retiredAt: integer("retired_at", { mode: "timestamp_ms" }),
}, (table) => [
  uniqueIndex("scoring_rule_versions_club_version_unique").on(table.clubId, table.version),
  uniqueIndex("scoring_rule_versions_one_active")
    .on(table.clubId)
    .where(sql`${table.status} = 'active'`),
  check("scoring_rule_versions_status_chk", sql`${table.status} IN ('draft', 'active', 'retired')`),
]);

export const workouts = sqliteTable("workouts", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  playerProfileId: text("player_profile_id").notNull().references(() => playerProfiles.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  occurredOn: text("occurred_on").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  durationMin: integer("duration_min").notNull(),
  intensity: text("intensity"),
  distanceM: integer("distance_m"),
  notes: text("notes"),
  status: text("status").notNull(),
  clientRequestId: text("client_request_id"),
  ruleVersionId: text("rule_version_id").references(() => scoringRuleVersions.id, { onDelete: "restrict" }),
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" }).notNull(),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
  reviewNote: text("review_note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("workouts_club_date_idx").on(table.clubId, table.occurredOn),
  index("workouts_club_status_date_idx").on(table.clubId, table.status, table.occurredOn),
  index("workouts_player_date_idx").on(table.playerProfileId, table.occurredOn),
  uniqueIndex("workouts_idempotency_unique")
    .on(table.playerProfileId, table.clientRequestId)
    .where(sql`${table.clientRequestId} IS NOT NULL`),
  check("workouts_duration_chk", sql`${table.durationMin} BETWEEN 1 AND 240`),
  check("workouts_status_chk", sql`${table.status} IN ('submitted', 'approved', 'rejected', 'voided')`),
  check(
    "workouts_intensity_chk",
    sql`${table.intensity} IS NULL OR ${table.intensity} IN ('easy', 'moderate', 'hard', 'max')`,
  ),
]);

export const workoutExercises = sqliteTable("workout_exercises", {
  id: text("id").primaryKey(),
  workoutId: text("workout_id").notNull().references(() => workouts.id, { onDelete: "restrict" }),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  sets: integer("sets"),
  reps: integer("reps"),
  loadGrams: integer("load_grams"),
  durationMin: integer("duration_min"),
  distanceM: integer("distance_m"),
  sortOrder: integer("sort_order").notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("workout_exercises_workout_idx").on(table.workoutId, table.sortOrder),
  index("workout_exercises_club_idx").on(table.clubId),
]);

export const pointTransactions = sqliteTable("point_transactions", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  playerProfileId: text("player_profile_id").notNull().references(() => playerProfiles.id, { onDelete: "restrict" }),
  workoutId: text("workout_id").references(() => workouts.id, { onDelete: "restrict" }),
  ruleVersionId: text("rule_version_id").notNull().references(() => scoringRuleVersions.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  pointsTenths: integer("points_tenths").notNull(),
  reasonCode: text("reason_code").notNull(),
  reasonDetail: text("reason_detail"),
  occurredOn: text("occurred_on"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (table) => [
  index("point_transactions_player_idx").on(table.clubId, table.playerProfileId, table.createdAt),
  index("point_transactions_workout_idx").on(table.workoutId),
  index("point_transactions_adjustment_idx").on(table.playerProfileId, table.occurredOn),
  check(
    "point_transactions_kind_chk",
    sql`${table.kind} IN ('award', 'cap_reduction', 'reversal', 'adjustment')`,
  ),
]);

export const challenges = sqliteTable("challenges", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  startOn: text("start_on").notNull(),
  endOn: text("end_on").notNull(),
  ruleJson: text("rule_json").notNull(),
  status: text("status").notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("challenges_club_idx").on(table.clubId, table.status),
  check("challenges_status_chk", sql`${table.status} IN ('draft', 'published', 'archived')`),
]);

export const achievements = sqliteTable("achievements", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  criteriaJson: text("criteria_json").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("achievements_club_key_unique").on(table.clubId, table.key),
]);

export const playerAchievements = sqliteTable("player_achievements", {
  id: text("id").primaryKey(),
  achievementId: text("achievement_id").notNull().references(() => achievements.id, { onDelete: "restrict" }),
  playerProfileId: text("player_profile_id").notNull().references(() => playerProfiles.id, { onDelete: "restrict" }),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  awardedAt: integer("awarded_at", { mode: "timestamp_ms" }).notNull(),
  sourceWorkoutId: text("source_workout_id").references(() => workouts.id, { onDelete: "restrict" }),
}, (table) => [
  uniqueIndex("player_achievements_once").on(table.achievementId, table.playerProfileId),
  index("player_achievements_player_idx").on(table.playerProfileId),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  ip: text("ip"),
  createdAt: createdAt(),
}, (table) => [
  index("audit_events_club_idx").on(table.clubId, table.createdAt),
  index("audit_events_entity_idx").on(table.entityType, table.entityId),
]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (table) => [
  index("notifications_user_idx").on(table.userId, table.readAt, table.createdAt),
]);

export const mediaObjects = sqliteTable("media_objects", {
  id: text("id").primaryKey(),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "restrict" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  purpose: text("purpose").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("media_objects_r2_key_unique").on(table.r2Key),
  index("media_objects_club_idx").on(table.clubId, table.purpose),
  check("media_objects_purpose_chk", sql`${table.purpose} IN ('avatar', 'workout_attachment')`),
  check("media_objects_size_chk", sql`${table.byteSize} > 0`),
]);

export const schemaTables = [
  clubs,
  users,
  credentials,
  sessions,
  loginAttempts,
  magicLinks,
  devMailbox,
  invitations,
  clubMemberships,
  positions,
  groups,
  playerProfiles,
  competitionPeriods,
  scoringRuleVersions,
  workouts,
  workoutExercises,
  pointTransactions,
  challenges,
  achievements,
  playerAchievements,
  auditEvents,
  notifications,
  mediaObjects,
];
