CREATE TABLE `player_login_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_login_links_token_hash_unique` ON `player_login_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_limits_window_idx` ON `auth_limits` (`window_start`);