CREATE TABLE `dev_mailbox` (
	`id` text PRIMARY KEY NOT NULL,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`text_body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dev_mailbox_to_idx` ON `dev_mailbox` (`to_address`,`created_at`);--> statement-breakpoint
CREATE TABLE `magic_links` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `magic_links_token_hash_unique` ON `magic_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `magic_links_email_idx` ON `magic_links` (`email`,`created_at`);--> statement-breakpoint
ALTER TABLE `positions` ADD `group_id` text REFERENCES groups(id);--> statement-breakpoint
CREATE INDEX `positions_group_idx` ON `positions` (`group_id`);