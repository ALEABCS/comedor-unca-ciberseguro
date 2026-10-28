CREATE TABLE `food_credit_movements` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`request_id` varchar(36) NOT NULL,
	`entry_type` enum('CREADO','APROBADO','RECHAZADO','UTILIZADO') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `food_credit_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `food_credit_requests` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`reservation_id` varchar(36),
	`service_date` date,
	`amount` decimal(10,2) NOT NULL DEFAULT '0',
	`reason` text,
	`credit_key` varchar(64) NOT NULL,
	`status` enum('PENDIENTE','APROBADA','RECHAZADA','UTILIZADA','VENCIDA') NOT NULL DEFAULT 'PENDIENTE',
	`reviewed_by` varchar(36),
	`reviewed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `food_credit_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_food_credit_key` UNIQUE(`credit_key`)
);
--> statement-breakpoint
ALTER TABLE `food_credit_movements` ADD CONSTRAINT `food_credit_movements_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `food_credit_movements` ADD CONSTRAINT `food_credit_movements_request_id_food_credit_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `food_credit_requests`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `food_credit_requests` ADD CONSTRAINT `food_credit_requests_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `food_credit_requests` ADD CONSTRAINT `food_credit_requests_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_food_credit_movement_user_created` ON `food_credit_movements` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_food_credit_user_status` ON `food_credit_requests` (`user_id`,`status`);