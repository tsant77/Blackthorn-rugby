CREATE TABLE `weekly_consistency` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`week_start` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_json` text NOT NULL,
	`pending_points_tenths` integer DEFAULT 0 NOT NULL,
	`points_tenths` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `player_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rule_id`) REFERENCES `scoring_rule_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_consistency_profile_week` ON `weekly_consistency` (`profile_id`,`week_start`);--> statement-breakpoint
ALTER TABLE `workouts` ADD `scoring_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `scoring_rules_effective_idx` ON `scoring_rule_versions` (`club_id`,`effective_on`,`version`);