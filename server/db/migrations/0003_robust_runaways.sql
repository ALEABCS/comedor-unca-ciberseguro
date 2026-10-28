DROP INDEX `ix_price_role_validity` ON `price_history`;--> statement-breakpoint
ALTER TABLE `price_history` ADD CONSTRAINT `chk_price_amount` CHECK (`price_history`.`amount` >= 0);--> statement-breakpoint
ALTER TABLE `price_history` ADD CONSTRAINT `chk_price_validity` CHECK (`price_history`.`valid_until` IS NULL OR `price_history`.`valid_until` >= `price_history`.`valid_from`);--> statement-breakpoint
CREATE INDEX `ix_price_role_validity` ON `price_history` (`role`,`valid_from`,`valid_until`);