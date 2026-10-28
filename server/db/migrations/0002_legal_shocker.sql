CREATE TABLE `sessions` (
	`session_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
	`expires` int unsigned NOT NULL,
	`data` mediumtext,
	CONSTRAINT `sessions_session_id` PRIMARY KEY(`session_id`)
);
--> statement-breakpoint
CREATE INDEX `ix_sessions_expiry` ON `sessions` (`expires`);--> statement-breakpoint
ALTER TABLE `capacity_slots` ADD CONSTRAINT `chk_capacity_slot_bounds` CHECK (`capacity_slots`.`booked` >= 0 AND `capacity_slots`.`booked` <= `capacity_slots`.`capacity`);--> statement-breakpoint
ALTER TABLE `capacity_slots` ADD CONSTRAINT `chk_ticket_counter_positive` CHECK (`capacity_slots`.`next_ticket_number` > 0);--> statement-breakpoint
ALTER TABLE `service_capacity_config` ADD CONSTRAINT `chk_service_capacity_positive` CHECK (`service_capacity_config`.`capacity` > 0);