ALTER TABLE `point_transactions` ADD `occurred_on` text;--> statement-breakpoint
CREATE INDEX `point_transactions_adjustment_idx` ON `point_transactions` (`player_profile_id`,`occurred_on`);--> statement-breakpoint
ALTER TABLE `scoring_rule_versions` ADD `effective_on` text;