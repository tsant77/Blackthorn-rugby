CREATE TABLE `achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`criteria_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `achievements_club_key_unique` ON `achievements` (`club_id`,`key`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `audit_events_club_idx` ON `audit_events` (`club_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`start_on` text NOT NULL,
	`end_on` text NOT NULL,
	`rule_json` text NOT NULL,
	`status` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "challenges_status_chk" CHECK("challenges"."status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `challenges_club_idx` ON `challenges` (`club_id`,`status`);--> statement-breakpoint
CREATE TABLE `club_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "club_memberships_role_chk" CHECK("club_memberships"."role" IN ('player', 'coach', 'admin')),
	CONSTRAINT "club_memberships_status_chk" CHECK("club_memberships"."status" IN ('active', 'deactivated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `club_memberships_club_user_unique` ON `club_memberships` (`club_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `club_memberships_club_role_idx` ON `club_memberships` (`club_id`,`role`,`status`);--> statement-breakpoint
CREATE TABLE `clubs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clubs_slug_unique` ON `clubs` (`slug`);--> statement-breakpoint
CREATE TABLE `competition_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`start_on` text NOT NULL,
	`end_on` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "competition_periods_kind_chk" CHECK("competition_periods"."kind" IN ('offseason', 'custom')),
	CONSTRAINT "competition_periods_status_chk" CHECK("competition_periods"."status" IN ('scheduled', 'active', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `competition_periods_club_idx` ON `competition_periods` (`club_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_periods_one_active_offseason` ON `competition_periods` (`club_id`) WHERE "competition_periods"."kind" = 'offseason' AND "competition_periods"."status" = 'active';--> statement-breakpoint
CREATE TABLE `credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`password_hash` text,
	`password_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "groups_kind_chk" CHECK("groups"."kind" IN ('position_group', 'training_group'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_club_name_unique` ON `groups` (`club_id`,`name`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`invited_by` text,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invitations_role_chk" CHECK("invitations"."role" IN ('player', 'coach', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_club_email_idx` ON `invitations` (`club_id`,`email`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_bucket_idx` ON `login_attempts` (`bucket_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `media_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`purpose` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_objects_purpose_chk" CHECK("media_objects"."purpose" IN ('avatar', 'workout_attachment')),
	CONSTRAINT "media_objects_size_chk" CHECK("media_objects"."byte_size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_objects_r2_key_unique` ON `media_objects` (`r2_key`);--> statement-breakpoint
CREATE INDEX `media_objects_club_idx` ON `media_objects` (`club_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `player_achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`achievement_id` text NOT NULL,
	`player_profile_id` text NOT NULL,
	`club_id` text NOT NULL,
	`awarded_at` integer NOT NULL,
	`source_workout_id` text,
	FOREIGN KEY (`achievement_id`) REFERENCES `achievements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_profile_id`) REFERENCES `player_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_achievements_once` ON `player_achievements` (`achievement_id`,`player_profile_id`);--> statement-breakpoint
CREATE INDEX `player_achievements_player_idx` ON `player_achievements` (`player_profile_id`);--> statement-breakpoint
CREATE TABLE `player_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`roster_name` text NOT NULL,
	`position_id` text,
	`group_id` text,
	`jersey_number` integer,
	`injury_status` text NOT NULL,
	`training_locked` integer NOT NULL,
	`injury_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `club_memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "player_profiles_injury_chk" CHECK("player_profiles"."injury_status" IN ('available', 'limited', 'out')),
	CONSTRAINT "player_profiles_jersey_chk" CHECK("player_profiles"."jersey_number" IS NULL OR "player_profiles"."jersey_number" BETWEEN 1 AND 99)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_profiles_membership_unique` ON `player_profiles` (`membership_id`);--> statement-breakpoint
CREATE INDEX `player_profiles_position_idx` ON `player_profiles` (`position_id`);--> statement-breakpoint
CREATE INDEX `player_profiles_group_idx` ON `player_profiles` (`group_id`);--> statement-breakpoint
CREATE TABLE `point_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`player_profile_id` text NOT NULL,
	`workout_id` text,
	`rule_version_id` text NOT NULL,
	`kind` text NOT NULL,
	`points_tenths` integer NOT NULL,
	`reason_code` text NOT NULL,
	`reason_detail` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_profile_id`) REFERENCES `player_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rule_version_id`) REFERENCES `scoring_rule_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "point_transactions_kind_chk" CHECK("point_transactions"."kind" IN ('award', 'cap_reduction', 'reversal', 'adjustment'))
);
--> statement-breakpoint
CREATE INDEX `point_transactions_player_idx` ON `point_transactions` (`club_id`,`player_profile_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `point_transactions_workout_idx` ON `point_transactions` (`workout_id`);--> statement-breakpoint
CREATE TABLE `positions` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_club_name_unique` ON `positions` (`club_id`,`name`);--> statement-breakpoint
CREATE TABLE `scoring_rule_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`daily_cap_tenths` integer NOT NULL,
	`session_cap_tenths` integer NOT NULL,
	`weekly_load_limit` integer NOT NULL,
	`backdate_days` integer NOT NULL,
	`config_json` text NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`activated_at` integer,
	`retired_at` integer,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "scoring_rule_versions_status_chk" CHECK("scoring_rule_versions"."status" IN ('draft', 'active', 'retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scoring_rule_versions_club_version_unique` ON `scoring_rule_versions` (`club_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `scoring_rule_versions_one_active` ON `scoring_rule_versions` (`club_id`) WHERE "scoring_rule_versions"."status" = 'active';--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`email_verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_status_chk" CHECK("users"."status" IN ('invited', 'active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workout_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`club_id` text NOT NULL,
	`name` text NOT NULL,
	`sets` integer,
	`reps` integer,
	`load_grams` integer,
	`duration_min` integer,
	`distance_m` integer,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `workout_exercises_workout_idx` ON `workout_exercises` (`workout_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `workout_exercises_club_idx` ON `workout_exercises` (`club_id`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`player_profile_id` text NOT NULL,
	`type` text NOT NULL,
	`occurred_on` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`duration_min` integer NOT NULL,
	`intensity` text,
	`distance_m` integer,
	`notes` text,
	`status` text NOT NULL,
	`client_request_id` text,
	`rule_version_id` text,
	`submitted_at` integer NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`review_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_profile_id`) REFERENCES `player_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rule_version_id`) REFERENCES `scoring_rule_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workouts_duration_chk" CHECK("workouts"."duration_min" BETWEEN 1 AND 240),
	CONSTRAINT "workouts_status_chk" CHECK("workouts"."status" IN ('submitted', 'approved', 'rejected', 'voided')),
	CONSTRAINT "workouts_intensity_chk" CHECK("workouts"."intensity" IS NULL OR "workouts"."intensity" IN ('easy', 'moderate', 'hard', 'max'))
);
--> statement-breakpoint
CREATE INDEX `workouts_club_date_idx` ON `workouts` (`club_id`,`occurred_on`);--> statement-breakpoint
CREATE INDEX `workouts_player_date_idx` ON `workouts` (`player_profile_id`,`occurred_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `workouts_idempotency_unique` ON `workouts` (`player_profile_id`,`client_request_id`) WHERE "workouts"."client_request_id" IS NOT NULL;