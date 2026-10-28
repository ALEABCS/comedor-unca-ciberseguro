CREATE TABLE `profile_photos` (
	`user_id` varchar(36) NOT NULL,
	`mime_type` varchar(20) NOT NULL,
	`image_data` mediumblob NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `profile_photos_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `profile_photos` ADD CONSTRAINT `profile_photos_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;