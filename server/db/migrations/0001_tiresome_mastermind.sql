DROP INDEX `ix_reservation_date_service` ON `reservations`;--> statement-breakpoint
DROP INDEX `ix_reservation_user_date` ON `reservations`;--> statement-breakpoint
DROP INDEX `ix_ticket_service_date` ON `tickets`;--> statement-breakpoint
ALTER TABLE `menu_entries` ADD `created_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
CREATE INDEX `ix_audit_actor_created` ON `audit_logs` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_menu_published_date` ON `menu_entries` (`published`,`service_date`);--> statement-breakpoint
CREATE INDEX `ix_users_role_status` ON `users` (`role`,`status`);--> statement-breakpoint
CREATE INDEX `ix_reservation_date_service` ON `reservations` (`service_date`,`service`,`status`);--> statement-breakpoint
CREATE INDEX `ix_reservation_user_date` ON `reservations` (`user_id`,`service_date`,`status`);--> statement-breakpoint
CREATE INDEX `ix_ticket_service_date` ON `tickets` (`service_date`,`service`,`status`);