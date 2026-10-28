CREATE TABLE `app_settings` (
	`setting_key` varchar(100) NOT NULL,
	`setting_value` varchar(255) NOT NULL,
	`updated_by` varchar(36),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_settings_setting_key` PRIMARY KEY(`setting_key`)
);
--> statement-breakpoint
CREATE TABLE `scholarship_types` (
	`code` enum('BECA_COMPLETA','MEDIA_BECA','SIN_BECA') NOT NULL,
	`label` varchar(80) NOT NULL,
	CONSTRAINT `scholarship_types_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `ticket_scans` (
	`id` varchar(36) NOT NULL,
	`ticket_id` varchar(36),
	`reservation_id` varchar(36),
	`operator_id` varchar(36) NOT NULL,
	`result` enum('VALID','ALREADY_USED','EXPIRED','CANCELLED','INVALID') NOT NULL,
	`scanned_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ticket_scans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `price_history` MODIFY COLUMN `changed_by` varchar(36);--> statement-breakpoint
ALTER TABLE `reservations` MODIFY COLUMN `status` enum('PENDIENTE','CONFIRMADA','PAGADA','CANCELADA','UTILIZADA','VENCIDA') NOT NULL DEFAULT 'CONFIRMADA';--> statement-breakpoint
ALTER TABLE `tickets` MODIFY COLUMN `status` enum('CONFIRMADO','DISPONIBLE','UTILIZADO','VENCIDO','CANCELADO') NOT NULL DEFAULT 'DISPONIBLE';--> statement-breakpoint
UPDATE `tickets` SET `status` = 'DISPONIBLE' WHERE `status` = 'CONFIRMADO';--> statement-breakpoint
ALTER TABLE `tickets` MODIFY COLUMN `status` enum('DISPONIBLE','UTILIZADO','VENCIDO','CANCELADO') NOT NULL DEFAULT 'DISPONIBLE';--> statement-breakpoint
ALTER TABLE `menu_entries` ADD `nutritional_information` text;--> statement-breakpoint
ALTER TABLE `menu_entries` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `payment_references` ADD `reservation_id` varchar(36);--> statement-breakpoint
ALTER TABLE `payment_references` ADD `method` varchar(60) DEFAULT 'REFERENCIA_EXTERNA' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_references` ADD `reviewed_by` varchar(36);--> statement-breakpoint
ALTER TABLE `payment_references` ADD `reviewed_at` timestamp NULL DEFAULT NULL;--> statement-breakpoint
ALTER TABLE `price_history` ADD `scholarship_type` enum('BECA_COMPLETA','MEDIA_BECA','SIN_BECA');--> statement-breakpoint
ALTER TABLE `reservations` ADD `dni_snapshot` varchar(20);--> statement-breakpoint
ALTER TABLE `reservations` ADD `role_snapshot` enum('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR');--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_status` enum('NO_REQUIERE_PAGO','PENDIENTE','PAGADO','RECHAZADO') DEFAULT 'NO_REQUIERE_PAGO' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `price_amount` decimal(10,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `price_currency` varchar(3) DEFAULT 'ARS' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `scholarship_type` enum('BECA_COMPLETA','MEDIA_BECA','SIN_BECA');--> statement-breakpoint
ALTER TABLE `reservations` ADD `presentation_deadline` timestamp NULL DEFAULT NULL;--> statement-breakpoint
ALTER TABLE `service_capacity_config` ADD `booking_opens_at` varchar(5) DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `service_capacity_config` ADD `booking_closes_at` varchar(5) DEFAULT '11:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `service_capacity_config` ADD `presentation_deadline_at` varchar(5) DEFAULT '13:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(80);--> statement-breakpoint
ALTER TABLE `users` ADD `dni` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(30);--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `payment_references` ADD CONSTRAINT `payment_references_reservation_id_unique` UNIQUE(`reservation_id`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_dni_unique` UNIQUE(`dni`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD CONSTRAINT `app_settings_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ticket_scans` ADD CONSTRAINT `ticket_scans_ticket_id_tickets_id_fk` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ticket_scans` ADD CONSTRAINT `ticket_scans_operator_id_users_id_fk` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_ticket_scans_ticket_date` ON `ticket_scans` (`ticket_id`,`scanned_at`);--> statement-breakpoint
CREATE INDEX `ix_ticket_scans_operator_date` ON `ticket_scans` (`operator_id`,`scanned_at`);--> statement-breakpoint
ALTER TABLE `payment_references` ADD CONSTRAINT `payment_references_reservation_id_reservations_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_references` ADD CONSTRAINT `payment_references_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;