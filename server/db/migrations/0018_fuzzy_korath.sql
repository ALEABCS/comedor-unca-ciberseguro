CREATE TABLE `comidas` (
	`id` char(3) NOT NULL,
	`nombre` varchar(150) NOT NULL,
	`normalized_name` varchar(180) NOT NULL,
	`categoria` enum('NUTRICIONAL','CHATARRA') NOT NULL,
	`tipo_comida` enum('ALMUERZO','CENA','AMBOS') NOT NULL,
	`descripcion` text NOT NULL,
	`ingredientes` text NOT NULL,
	`preparacion` text NOT NULL,
	`porcion` varchar(100) NOT NULL,
	`calorias` decimal(8,2) NOT NULL,
	`proteinas` decimal(8,2) NOT NULL,
	`carbohidratos` decimal(8,2) NOT NULL,
	`grasas` decimal(8,2) NOT NULL,
	`fibra` decimal(8,2) NOT NULL,
	`sodio` decimal(8,2) NOT NULL,
	`tiempo_preparacion` int unsigned NOT NULL,
	`dificultad` enum('FACIL','MEDIA','ALTA') NOT NULL,
	`costo_estimado` decimal(10,2) NOT NULL,
	`moneda` char(3) NOT NULL DEFAULT 'ARS',
	`apta_comedor` boolean NOT NULL DEFAULT true,
	`observaciones` text,
	`fuente_proteina` varchar(40) NOT NULL,
	`metodo_coccion` varchar(30) NOT NULL,
	`vegetariana` boolean NOT NULL,
	`contiene_carne` boolean NOT NULL,
	`contiene_pescado` boolean NOT NULL,
	`contiene_legumbres` boolean NOT NULL,
	`activa` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comidas_id` PRIMARY KEY(`id`),
	CONSTRAINT `comidas_normalized_name_unique` UNIQUE(`normalized_name`)
);
--> statement-breakpoint
CREATE INDEX `ix_comidas_categoria` ON `comidas` (`categoria`,`activa`);--> statement-breakpoint
CREATE INDEX `ix_comidas_tipo_comida` ON `comidas` (`tipo_comida`,`activa`);--> statement-breakpoint
CREATE INDEX `ix_comidas_apta_comedor` ON `comidas` (`apta_comedor`,`activa`);--> statement-breakpoint
CREATE INDEX `ix_comidas_calorias` ON `comidas` (`calorias`);--> statement-breakpoint
CREATE INDEX `ix_comidas_proteinas` ON `comidas` (`proteinas`);--> statement-breakpoint
CREATE INDEX `ix_comidas_costo` ON `comidas` (`costo_estimado`);--> statement-breakpoint
CREATE INDEX `ix_comidas_dificultad_tiempo` ON `comidas` (`dificultad`,`tiempo_preparacion`);--> statement-breakpoint
CREATE INDEX `ix_comidas_fuente_proteina` ON `comidas` (`fuente_proteina`);--> statement-breakpoint
CREATE INDEX `ix_comidas_filtros_dieteticos` ON `comidas` (`vegetariana`,`contiene_carne`,`contiene_pescado`,`contiene_legumbres`);