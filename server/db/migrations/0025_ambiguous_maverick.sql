ALTER TABLE `reservations` ADD `queue_number` int unsigned;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `uq_reservation_queue_number` UNIQUE(`service_date`,`service`,`queue_number`);--> statement-breakpoint
UPDATE `reservations` r
JOIN `tickets` t ON t.`reservation_id` = r.`id`
SET r.`queue_number` = t.`daily_number`;--> statement-breakpoint
INSERT INTO `capacity_slots` (`service_date`, `service`, `capacity`, `booked`, `next_ticket_number`)
SELECT r.`service_date`, r.`service`, c.`capacity`, 0, 1
FROM `reservations` r
JOIN `service_capacity_config` c ON c.`service` = r.`service`
LEFT JOIN `capacity_slots` cs
  ON cs.`service_date` = r.`service_date` AND cs.`service` = r.`service`
WHERE cs.`service_date` IS NULL
GROUP BY r.`service_date`, r.`service`, c.`capacity`;--> statement-breakpoint
UPDATE `capacity_slots` cs
JOIN (
  SELECT `service_date`, `service`, MAX(`daily_number`) + 1 AS `next_number`
  FROM `tickets`
  GROUP BY `service_date`, `service`
) ticket_max
  ON ticket_max.`service_date` = cs.`service_date` AND ticket_max.`service` = cs.`service`
SET cs.`next_ticket_number` = GREATEST(cs.`next_ticket_number`, ticket_max.`next_number`);--> statement-breakpoint
CREATE TEMPORARY TABLE `reservation_queue_backfill` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
  `queue_number` int unsigned NOT NULL
) ENGINE=InnoDB;--> statement-breakpoint
INSERT INTO `reservation_queue_backfill` (`id`, `queue_number`)
SELECT r.`id`,
       cs.`next_ticket_number` + ROW_NUMBER() OVER (
         PARTITION BY r.`service_date`, r.`service`
         ORDER BY r.`created_at`, r.`id`
       ) - 1
FROM `reservations` r
JOIN `capacity_slots` cs
  ON cs.`service_date` = r.`service_date` AND cs.`service` = r.`service`
WHERE r.`queue_number` IS NULL;--> statement-breakpoint
UPDATE `reservations` r
JOIN `reservation_queue_backfill` b ON b.`id` = r.`id`
SET r.`queue_number` = b.`queue_number`;--> statement-breakpoint
UPDATE `capacity_slots` cs
JOIN (
  SELECT `service_date`, `service`, MAX(`queue_number`) + 1 AS `next_number`
  FROM `reservations`
  WHERE `queue_number` IS NOT NULL
  GROUP BY `service_date`, `service`
) reservation_max
  ON reservation_max.`service_date` = cs.`service_date` AND reservation_max.`service` = cs.`service`
SET cs.`next_ticket_number` = GREATEST(cs.`next_ticket_number`, reservation_max.`next_number`);--> statement-breakpoint
DROP TEMPORARY TABLE `reservation_queue_backfill`;