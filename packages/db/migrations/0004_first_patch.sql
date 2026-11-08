ALTER TABLE `notifications` ADD `dedupe_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_unique` ON `notifications` (`user_id`,`dedupe_key`) WHERE "notifications"."dedupe_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `email_notifications` integer DEFAULT 0 NOT NULL;