CREATE TABLE `reservation_waitlist` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`service_date` date NOT NULL,
	`service` enum('ALMUERZO','CENA') NOT NULL,
	`status` enum('WAITING','OFFERED','CLAIMED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'WAITING',
	`offered_at` timestamp NULL DEFAULT NULL,
	`expires_at` timestamp NULL DEFAULT NULL,
	`reservation_id` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`claimed_at` timestamp NULL DEFAULT NULL,
	`cancelled_at` timestamp NULL DEFAULT NULL,
	CONSTRAINT `reservation_waitlist_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservation_waitlist_reservation_id_unique` UNIQUE(`reservation_id`)
);
--> statement-breakpoint
ALTER TABLE `reservation_waitlist` ADD CONSTRAINT `reservation_waitlist_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_waitlist` ADD CONSTRAINT `reservation_waitlist_reservation_id_reservations_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_waitlist_slot_order` ON `reservation_waitlist` (`service_date`,`service`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ix_waitlist_user_status` ON `reservation_waitlist` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_waitlist_offer_expiry` ON `reservation_waitlist` (`status`,`expires_at`);