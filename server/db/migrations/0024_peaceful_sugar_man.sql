CREATE TABLE `service_closures` (
	`id` varchar(36) NOT NULL,
	`service_date` date NOT NULL,
	`service` enum('ALMUERZO','CENA') NOT NULL,
	`reason` varchar(250) NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `service_closures_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_service_closure_date_service` UNIQUE(`service_date`,`service`)
);
--> statement-breakpoint
ALTER TABLE `service_closures` ADD CONSTRAINT `service_closures_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_service_closure_date` ON `service_closures` (`service_date`,`service`);--> statement-breakpoint
UPDATE `service_capacity_config`
SET `booking_opens_at` = '15:00', `booking_closes_at` = '17:00'
WHERE `service` = 'CENA' AND `booking_opens_at` = '18:00' AND `booking_closes_at` = '22:00';--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role_code`, `permission_code`)
SELECT 'ADMINISTRADOR_LOCAL', 'payments:export'
FROM `permissions` WHERE `code` = 'payments:export';