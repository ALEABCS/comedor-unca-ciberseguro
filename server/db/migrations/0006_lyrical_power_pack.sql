ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `totp_secret` varchar(256);--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `totp_enabled_at` timestamp NULL DEFAULT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `totp_last_used_step` int unsigned;--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `totp_recovery_codes` json;