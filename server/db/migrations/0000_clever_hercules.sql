CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`actor_id` varchar(36),
	`action` varchar(100) NOT NULL,
	`resource_type` varchar(80) NOT NULL,
	`resource_id` varchar(36),
	`outcome` enum('SUCCESS','DENIED','FAILURE') NOT NULL,
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `benefits` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`status` enum('PENDIENTE','APROBADO','RECHAZADO','VENCIDO') NOT NULL DEFAULT 'PENDIENTE',
	`valid_from` date,
	`valid_until` date,
	`approved_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `benefits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `capacity_slots` (
	`service_date` date NOT NULL,
	`service` enum('ALMUERZO','CENA') NOT NULL,
	`capacity` int NOT NULL,
	`booked` int NOT NULL DEFAULT 0,
	`next_ticket_number` int NOT NULL DEFAULT 1,
	CONSTRAINT `pk_capacity_slot` PRIMARY KEY(`service_date`,`service`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`operation` varchar(80) NOT NULL,
	`idempotency_key` varchar(100) NOT NULL,
	`response` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `idempotency_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_idempotency_operation` UNIQUE(`user_id`,`operation`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` varchar(36) NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`title` varchar(160) NOT NULL,
	`description` text NOT NULL,
	`severity` enum('BAJA','MEDIA','ALTA','CRITICA') NOT NULL DEFAULT 'MEDIA',
	`status` enum('ABIERTO','EN_INVESTIGACION','RESUELTO','CERRADO') NOT NULL DEFAULT 'ABIERTO',
	`assigned_to` varchar(36),
	`resolution` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `menu_entries` (
	`id` varchar(36) NOT NULL,
	`service_date` date NOT NULL,
	`service` enum('ALMUERZO','CENA') NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text,
	`ingredients` text,
	`published` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `menu_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_menu_date_service` UNIQUE(`service_date`,`service`)
);
--> statement-breakpoint
CREATE TABLE `menu_history` (
	`id` varchar(36) NOT NULL,
	`menu_entry_id` varchar(36) NOT NULL,
	`actor_id` varchar(36) NOT NULL,
	`action` varchar(40) NOT NULL,
	`snapshot` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `menu_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`title` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`read_at` timestamp NULL DEFAULT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_references` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`provider` varchar(60) NOT NULL,
	`provider_reference` varchar(191) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'ARS',
	`status` enum('PENDIENTE','APROBADO','RECHAZADO','REEMBOLSADO') NOT NULL DEFAULT 'PENDIENTE',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_references_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_payment_provider_reference` UNIQUE(`provider`,`provider_reference`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`code` varchar(80) NOT NULL,
	`description` varchar(180) NOT NULL,
	CONSTRAINT `permissions_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` varchar(36) NOT NULL,
	`role` enum('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'ARS',
	`valid_from` date NOT NULL,
	`valid_until` date,
	`changed_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`service_date` date NOT NULL,
	`service` enum('ALMUERZO','CENA') NOT NULL,
	`status` enum('CONFIRMADA','CANCELADA','UTILIZADA') NOT NULL DEFAULT 'CONFIRMADA',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`cancelled_at` timestamp NULL DEFAULT NULL,
	CONSTRAINT `reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_reservation_user_date_service` UNIQUE(`user_id`,`service_date`,`service`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_code` enum('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NOT NULL,
	`permission_code` varchar(80) NOT NULL,
	CONSTRAINT `role_permissions_role_code_permission_code_pk` PRIMARY KEY(`role_code`,`permission_code`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`code` enum('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NOT NULL,
	`label` varchar(80) NOT NULL,
	CONSTRAINT `roles_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `scholarships` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`scholarship_type` varchar(100) NOT NULL,
	`status` enum('PENDIENTE','APROBADA','RECHAZADA','VENCIDA') NOT NULL DEFAULT 'PENDIENTE',
	`valid_from` date,
	`valid_until` date,
	`documentation_reference` varchar(500),
	`reviewed_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scholarships_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_capacity_config` (
	`service` enum('ALMUERZO','CENA') NOT NULL,
	`capacity` int NOT NULL DEFAULT 750,
	`booking_enabled` boolean NOT NULL DEFAULT true,
	CONSTRAINT `service_capacity_config_service` PRIMARY KEY(`service`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` varchar(36) NOT NULL,
	`reservation_id` varchar(36) NOT NULL,
	`service_date` date NOT NULL,
	`service` enum('ALMUERZO','CENA') NOT NULL,
	`daily_number` int NOT NULL,
	`status` enum('CONFIRMADO','UTILIZADO','CANCELADO') NOT NULL DEFAULT 'CONFIRMADO',
	`consumed_at` timestamp NULL DEFAULT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tickets_reservation_id_unique` UNIQUE(`reservation_id`),
	CONSTRAINT `uq_ticket_daily_number` UNIQUE(`service_date`,`service`,`daily_number`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`google_subject` varchar(191),
	`email` varchar(254) NOT NULL,
	`first_name` varchar(100) NOT NULL,
	`last_name` varchar(100) NOT NULL,
	`role` enum('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NOT NULL DEFAULT 'ALUMNO',
	`status` enum('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
	`is_demo` boolean NOT NULL DEFAULT false,
	`last_login_at` timestamp NULL DEFAULT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_google_subject_unique` UNIQUE(`google_subject`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `benefits` ADD CONSTRAINT `benefits_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `benefits` ADD CONSTRAINT `benefits_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_assigned_to_users_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_entries` ADD CONSTRAINT `menu_entries_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_history` ADD CONSTRAINT `menu_history_menu_entry_id_menu_entries_id_fk` FOREIGN KEY (`menu_entry_id`) REFERENCES `menu_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_history` ADD CONSTRAINT `menu_history_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_references` ADD CONSTRAINT `payment_references_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_history` ADD CONSTRAINT `price_history_changed_by_users_id_fk` FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_code_roles_code_fk` FOREIGN KEY (`role_code`) REFERENCES `roles`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_code_permissions_code_fk` FOREIGN KEY (`permission_code`) REFERENCES `permissions`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scholarships` ADD CONSTRAINT `scholarships_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scholarships` ADD CONSTRAINT `scholarships_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_reservation_id_reservations_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_audit_action_created` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_benefit_user_status` ON `benefits` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_incident_status_created` ON `incidents` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_menu_history_entry_date` ON `menu_history` (`menu_entry_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_notification_user_created` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_payment_user_date` ON `payment_references` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_price_role_validity` ON `price_history` (`role`,`valid_from`);--> statement-breakpoint
CREATE INDEX `ix_reservation_date_service` ON `reservations` (`service_date`,`service`);--> statement-breakpoint
CREATE INDEX `ix_reservation_user_date` ON `reservations` (`user_id`,`service_date`);--> statement-breakpoint
CREATE INDEX `ix_scholarship_user_status` ON `scholarships` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_ticket_service_date` ON `tickets` (`service_date`,`service`);