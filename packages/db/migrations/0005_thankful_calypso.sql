CREATE TABLE `access_links` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text,
	`landing` text,
	`label` text,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "access_links_kind_chk" CHECK("access_links"."kind" IN ('invite', 'signin', 'club')),
	CONSTRAINT "access_links_role_chk" CHECK("access_links"."role" IS NULL OR "access_links"."role" IN ('player', 'coach', 'admin')),
	CONSTRAINT "access_links_landing_chk" CHECK("access_links"."landing" IS NULL OR "access_links"."landing" IN ('player', 'pending'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_links_token_unique` ON `access_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `access_links_club_kind_idx` ON `access_links` (`club_id`,`kind`);--> statement-breakpoint
ALTER TABLE `clubs` ADD `bootstrap_consumed_at` integer;