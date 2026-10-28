CREATE TABLE IF NOT EXISTS `kitchen_production` (
  `id` varchar(36) NOT NULL,
  `service_date` date NOT NULL,
  `service` enum('ALMUERZO','CENA') NOT NULL,
  `produced_portions` int NOT NULL DEFAULT 0,
  `notes` text NULL,
  `updated_by` varchar(36) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_kitchen_production_date_service` UNIQUE (`service_date`, `service`),
  CONSTRAINT `chk_kitchen_produced_nonnegative` CHECK (`produced_portions` >= 0),
  CONSTRAINT `fk_kitchen_production_user` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB;