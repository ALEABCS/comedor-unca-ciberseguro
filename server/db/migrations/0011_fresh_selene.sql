CREATE TABLE `food_allergen_links` (
	`food_id` varchar(36) NOT NULL,
	`allergen_code` varchar(40) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pk_food_allergen` PRIMARY KEY(`food_id`,`allergen_code`)
);
--> statement-breakpoint
CREATE TABLE `food_allergens` (
	`code` varchar(40) NOT NULL,
	`label` varchar(80) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `food_allergens_code` PRIMARY KEY(`code`),
	CONSTRAINT `food_allergens_label_unique` UNIQUE(`label`)
);
--> statement-breakpoint
CREATE TABLE `food_categories` (
	`code` varchar(40) NOT NULL,
	`label` varchar(80) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `food_categories_code` PRIMARY KEY(`code`),
	CONSTRAINT `food_categories_label_unique` UNIQUE(`label`)
);
--> statement-breakpoint
CREATE TABLE `foods` (
	`id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`normalized_name` varchar(180) NOT NULL,
	`category_code` varchar(40) NOT NULL,
	`subcategory` varchar(80),
	`food_type` varchar(40) NOT NULL DEFAULT 'ALIMENTO',
	`description` text,
	`sin_tacc` boolean,
	`vegan` boolean,
	`vegetarian` boolean,
	`allergens_verified` boolean NOT NULL DEFAULT false,
	`calories` decimal(8,2),
	`protein_grams` decimal(8,2),
	`carbohydrate_grams` decimal(8,2),
	`fat_grams` decimal(8,2),
	`fiber_grams` decimal(8,2),
	`sodium_milligrams` decimal(8,2),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `foods_id` PRIMARY KEY(`id`),
	CONSTRAINT `foods_normalized_name_unique` UNIQUE(`normalized_name`)
);
--> statement-breakpoint
CREATE TABLE `menu_entry_items` (
	`id` varchar(36) NOT NULL,
	`menu_entry_id` varchar(36) NOT NULL,
	`food_id` varchar(36) NOT NULL,
	`food_name_snapshot` varchar(160) NOT NULL,
	`component` varchar(80) NOT NULL,
	`sort_order` int unsigned NOT NULL DEFAULT 0,
	`sin_tacc_snapshot` boolean,
	`vegan_snapshot` boolean,
	`vegetarian_snapshot` boolean,
	`allergens_verified_snapshot` boolean NOT NULL DEFAULT false,
	`allergens_snapshot` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `menu_entry_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `food_allergen_links` ADD CONSTRAINT `food_allergen_links_food_id_foods_id_fk` FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `food_allergen_links` ADD CONSTRAINT `food_allergen_links_allergen_code_food_allergens_code_fk` FOREIGN KEY (`allergen_code`) REFERENCES `food_allergens`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `foods` ADD CONSTRAINT `foods_category_code_food_categories_code_fk` FOREIGN KEY (`category_code`) REFERENCES `food_categories`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_entry_items` ADD CONSTRAINT `menu_entry_items_menu_entry_id_menu_entries_id_fk` FOREIGN KEY (`menu_entry_id`) REFERENCES `menu_entries`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_entry_items` ADD CONSTRAINT `menu_entry_items_food_id_foods_id_fk` FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_food_allergen_code` ON `food_allergen_links` (`allergen_code`,`food_id`);--> statement-breakpoint
CREATE INDEX `ix_food_category_active` ON `foods` (`category_code`,`active`);--> statement-breakpoint
CREATE INDEX `ix_food_name` ON `foods` (`name`);--> statement-breakpoint
CREATE INDEX `ix_menu_entry_item_order` ON `menu_entry_items` (`menu_entry_id`,`component`,`sort_order`);--> statement-breakpoint
CREATE INDEX `ix_menu_entry_item_food` ON `menu_entry_items` (`food_id`);