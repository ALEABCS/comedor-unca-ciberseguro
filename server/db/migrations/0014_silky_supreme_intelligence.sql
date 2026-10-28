CREATE TABLE `events_news` (
	`id` varchar(36) NOT NULL,
	`type` enum('NOTICIA','COMUNICADO','EVENTO') NOT NULL,
	`title` varchar(180) NOT NULL,
	`body` text NOT NULL,
	`event_date` date,
	`start_time` varchar(5),
	`end_time` varchar(5),
	`location` varchar(180),
	`event_status` enum('PROGRAMADO','REALIZADO','CANCELADO') NOT NULL DEFAULT 'PROGRAMADO',
	`published` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `events_news_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `events_news_photos` (
	`id` varchar(36) NOT NULL,
	`entry_id` varchar(36) NOT NULL,
	`mime_type` varchar(20) NOT NULL,
	`image_data` mediumblob NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `events_news_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `events_news` ADD CONSTRAINT `events_news_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events_news_photos` ADD CONSTRAINT `events_news_photos_entry_id_events_news_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `events_news`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events_news_photos` ADD CONSTRAINT `events_news_photos_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_events_news_published_created` ON `events_news` (`published`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_events_news_event_date` ON `events_news` (`event_date`,`event_status`);--> statement-breakpoint
CREATE INDEX `ix_events_news_photos_entry_created` ON `events_news_photos` (`entry_id`,`created_at`);