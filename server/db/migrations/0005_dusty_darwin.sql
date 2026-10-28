ALTER TABLE `menu_entries` ADD COLUMN IF NOT EXISTS `main_dish` text;--> statement-breakpoint
ALTER TABLE `menu_entries` ADD COLUMN IF NOT EXISTS `side_dish` text;--> statement-breakpoint
ALTER TABLE `menu_entries` ADD COLUMN IF NOT EXISTS `salad` text;--> statement-breakpoint
ALTER TABLE `menu_entries` ADD COLUMN IF NOT EXISTS `dessert` text;--> statement-breakpoint
ALTER TABLE `menu_entries` ADD COLUMN IF NOT EXISTS `drink` text;--> statement-breakpoint
ALTER TABLE `menu_entries` ADD COLUMN IF NOT EXISTS `bread` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `approval_status` enum('PENDIENTE','APROBADA','RECHAZADA') DEFAULT 'PENDIENTE' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `approval_actor_id` varchar(36);--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `approval_role_snapshot` enum('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR');--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `approval_updated_at` timestamp NULL DEFAULT NULL;--> statement-breakpoint
UPDATE `reservations` SET `approval_status` = 'APROBADA' WHERE `status` IN ('CONFIRMADA','PAGADA','UTILIZADA') AND `payment_status` <> 'RECHAZADO';--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_approval_actor_id_users_id_fk` FOREIGN KEY (`approval_actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;