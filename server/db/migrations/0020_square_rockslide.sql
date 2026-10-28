CREATE TABLE `payment_reference_reservations` (
	`payment_reference_id` varchar(36) NOT NULL,
	`reservation_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pk_payment_ref_reservation` PRIMARY KEY(`payment_reference_id`,`reservation_id`)
);
--> statement-breakpoint
ALTER TABLE `payment_reference_reservations` ADD CONSTRAINT `fk_payment_ref_reservation_payment` FOREIGN KEY (`payment_reference_id`) REFERENCES `payment_references`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_reference_reservations` ADD CONSTRAINT `fk_payment_ref_reservation_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO `payment_reference_reservations` (`payment_reference_id`, `reservation_id`)
SELECT `id`, `reservation_id` FROM `payment_references` WHERE `reservation_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `ix_payment_reference_reservations_reservation_id` ON `payment_reference_reservations` (`reservation_id`);