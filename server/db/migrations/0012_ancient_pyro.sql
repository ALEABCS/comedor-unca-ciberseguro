CREATE TABLE `carousel_photos` (
	`id` varchar(36) NOT NULL,
	`caption` varchar(100) NOT NULL,
	`mime_type` varchar(20) NOT NULL,
	`image_data` mediumblob NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `carousel_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `carousel_photos` ADD CONSTRAINT `carousel_photos_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_carousel_photos_created_at` ON `carousel_photos` (`created_at`,`id`);