CREATE TABLE `cash_receipts` (
	`id` varchar(36) NOT NULL,
	`receipt_number` int AUTO_INCREMENT NOT NULL,
	`cash_shift_id` varchar(36) NOT NULL,
	`payment_reference_id` varchar(36) NOT NULL,
	`received_by` varchar(36) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`note` text,
	`status` enum('CONFIRMADO','ANULADO') NOT NULL DEFAULT 'CONFIRMADO',
	`received_at` timestamp NOT NULL DEFAULT (now()),
	`voided_by` varchar(36),
	`voided_at` datetime,
	`void_reason` text,
	CONSTRAINT `cash_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `cash_receipts_receipt_number_unique` UNIQUE(`receipt_number`),
	CONSTRAINT `cash_receipts_payment_reference_id_unique` UNIQUE(`payment_reference_id`),
	CONSTRAINT `chk_cash_receipt_amount` CHECK(`cash_receipts`.`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `cash_shifts` (
	`id` varchar(36) NOT NULL,
	`active_operator_id` varchar(36),
	`opened_by` varchar(36) NOT NULL,
	`opening_balance` decimal(10,2) NOT NULL DEFAULT '0',
	`opening_note` text,
	`opened_at` timestamp NOT NULL DEFAULT (now()),
	`status` enum('ABIERTA','CERRADA') NOT NULL DEFAULT 'ABIERTA',
	`closed_by` varchar(36),
	`closed_at` datetime,
	`expected_cash` decimal(10,2),
	`counted_cash` decimal(10,2),
	`difference` decimal(10,2),
	`close_note` text,
	`reviewed_by` varchar(36),
	`reviewed_at` datetime,
	CONSTRAINT `cash_shifts_id` PRIMARY KEY(`id`),
	CONSTRAINT `cash_shifts_active_operator_id_unique` UNIQUE(`active_operator_id`),
	CONSTRAINT `chk_cash_shift_opening_balance` CHECK(`cash_shifts`.`opening_balance` >= 0),
	CONSTRAINT `chk_cash_shift_counted_cash` CHECK(`cash_shifts`.`counted_cash` IS NULL OR `cash_shifts`.`counted_cash` >= 0)
);
--> statement-breakpoint
CREATE TABLE `finance_adjustments` (
	`id` varchar(36) NOT NULL,
	`payment_reference_id` varchar(36) NOT NULL,
	`adjustment_type` enum('DEVOLUCION','AJUSTE','ANULACION') NOT NULL,
	`status` enum('SOLICITADA','AUTORIZADA','EJECUTADA','RECHAZADA','APLICADA') NOT NULL DEFAULT 'SOLICITADA',
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`reason` text NOT NULL,
	`requested_by` varchar(36) NOT NULL,
	`requested_at` timestamp NOT NULL DEFAULT (now()),
	`authorized_by` varchar(36),
	`authorized_at` datetime,
	`executed_by` varchar(36),
	`executed_at` datetime,
	`execution_reference` varchar(191),
	`execution_note` text,
	CONSTRAINT `finance_adjustments_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_finance_adjustment_amount` CHECK(`finance_adjustments`.`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` varchar(36) NOT NULL,
	`payment_reference_id` varchar(36) NOT NULL,
	`reservation_id` varchar(36) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`allocated_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_allocations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_payment_allocation_payment_reservation` UNIQUE(`payment_reference_id`,`reservation_id`),
	CONSTRAINT `chk_payment_allocation_amount` CHECK(`payment_allocations`.`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `payment_evidence` (
	`id` varchar(36) NOT NULL,
	`payment_reference_id` varchar(36) NOT NULL,
	`submitted_by` varchar(36) NOT NULL,
	`provider_reference` varchar(191) NOT NULL,
	`method` varchar(60) NOT NULL,
	`declared_amount` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`mime_type` varchar(20) NOT NULL,
	`image_data` mediumblob NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_evidence_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_payment_evidence_amount` CHECK(`payment_evidence`.`declared_amount` >= 0)
);
--> statement-breakpoint
CREATE TABLE `payment_finance_events` (
	`id` varchar(36) NOT NULL,
	`payment_reference_id` varchar(36) NOT NULL,
	`event_type` enum('COMPROBANTE_PRESENTADO','DOCUMENTACION_VERIFICADA','DOCUMENTACION_RECHAZADA','ACREDITACION_CONFIRMADA','DIFERENCIA_DETECTADA','COBRO_EFECTIVO','DEVOLUCION_SOLICITADA','DEVOLUCION_AUTORIZADA','DEVOLUCION_EJECUTADA','DEVOLUCION_RECHAZADA','AJUSTE_REGISTRADO') NOT NULL,
	`amount` decimal(10,2),
	`currency` varchar(3),
	`reference` varchar(191),
	`note` text,
	`actor_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_finance_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_payment_finance_event_amount` CHECK(`payment_finance_events`.`amount` IS NULL OR `payment_finance_events`.`amount` >= 0)
);
--> statement-breakpoint
ALTER TABLE `cash_receipts` ADD CONSTRAINT `cash_receipts_cash_shift_id_cash_shifts_id_fk` FOREIGN KEY (`cash_shift_id`) REFERENCES `cash_shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_receipts` ADD CONSTRAINT `cash_receipts_payment_reference_id_payment_references_id_fk` FOREIGN KEY (`payment_reference_id`) REFERENCES `payment_references`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_receipts` ADD CONSTRAINT `cash_receipts_received_by_users_id_fk` FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_receipts` ADD CONSTRAINT `cash_receipts_voided_by_users_id_fk` FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_shifts` ADD CONSTRAINT `cash_shifts_active_operator_id_users_id_fk` FOREIGN KEY (`active_operator_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_shifts` ADD CONSTRAINT `cash_shifts_opened_by_users_id_fk` FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_shifts` ADD CONSTRAINT `cash_shifts_closed_by_users_id_fk` FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_shifts` ADD CONSTRAINT `cash_shifts_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `fk_fin_adj_payment` FOREIGN KEY (`payment_reference_id`) REFERENCES `payment_references`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `fk_fin_adj_requester` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `fk_fin_adj_authorizer` FOREIGN KEY (`authorized_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `fk_fin_adj_executor` FOREIGN KEY (`executed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_allocations` ADD CONSTRAINT `fk_fin_alloc_payment` FOREIGN KEY (`payment_reference_id`) REFERENCES `payment_references`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_allocations` ADD CONSTRAINT `fk_fin_alloc_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_allocations` ADD CONSTRAINT `fk_fin_alloc_actor` FOREIGN KEY (`allocated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_evidence` ADD CONSTRAINT `fk_fin_evidence_payment` FOREIGN KEY (`payment_reference_id`) REFERENCES `payment_references`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_evidence` ADD CONSTRAINT `fk_fin_evidence_submitter` FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_finance_events` ADD CONSTRAINT `fk_fin_event_payment` FOREIGN KEY (`payment_reference_id`) REFERENCES `payment_references`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_finance_events` ADD CONSTRAINT `fk_fin_event_actor` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_cash_receipt_shift_received` ON `cash_receipts` (`cash_shift_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `ix_cash_receipt_receiver_received` ON `cash_receipts` (`received_by`,`received_at`);--> statement-breakpoint
CREATE INDEX `ix_cash_shift_status_opened` ON `cash_shifts` (`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `ix_cash_shift_operator_opened` ON `cash_shifts` (`opened_by`,`opened_at`);--> statement-breakpoint
CREATE INDEX `ix_finance_adjustment_payment_created` ON `finance_adjustments` (`payment_reference_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `ix_finance_adjustment_status_created` ON `finance_adjustments` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `ix_payment_allocation_reservation_created` ON `payment_allocations` (`reservation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_payment_evidence_payment_created` ON `payment_evidence` (`payment_reference_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_payment_evidence_submitter_created` ON `payment_evidence` (`submitted_by`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_payment_finance_event_payment_created` ON `payment_finance_events` (`payment_reference_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_payment_finance_event_actor_created` ON `payment_finance_events` (`actor_id`,`created_at`);