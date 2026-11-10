CREATE TABLE `auth_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`attempts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`claim` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_hash_unique` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_resets_user_idx` ON `password_resets` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `team_registration` (
	`club_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`expires_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "team_registration_enabled_chk" CHECK("team_registration"."enabled" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_registration_token_hash_unique` ON `team_registration` (`token_hash`);--> statement-breakpoint
ALTER TABLE `credentials` ADD `username` text;--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_username_unique` ON `credentials` ("username" COLLATE NOCASE);