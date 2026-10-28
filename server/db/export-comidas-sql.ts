import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { comidas } from "../../shared/comidas";

const columns = [
  "id", "nombre", "normalized_name", "categoria", "tipo_comida", "descripcion", "ingredientes",
  "preparacion", "porcion", "calorias", "proteinas", "carbohidratos", "grasas", "fibra", "sodio",
  "tiempo_preparacion", "dificultad", "costo_estimado", "moneda", "apta_comedor", "observaciones",
  "fuente_proteina", "metodo_coccion", "vegetariana", "contiene_carne", "contiene_pescado", "contiene_legumbres"
] as const;

function sqlValue(value: string | number | boolean): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("El catálogo contiene un valor numérico inválido.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${value.replace(/\\/g, "\\\\").replace(/\0/g, "\\0").replace(/\u001a/g, "\\Z").replace(/'/g, "''")}'`;
}

if (comidas.length !== 500 || comidas.filter((meal) => meal.category === "NUTRICIONAL").length !== 250 || comidas.filter((meal) => meal.category === "CHATARRA").length !== 250) {
  throw new Error("Se requieren exactamente 250 comidas por categoría para exportar el SQL.");
}
if (new Set(comidas.map((meal) => meal.id)).size !== 500 || new Set(comidas.map((meal) => meal.normalizedName)).size !== 500) {
  throw new Error("El catálogo tiene identificadores o nombres normalizados duplicados.");
}

const table = `CREATE TABLE IF NOT EXISTS comidas (
  id CHAR(3) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  normalized_name VARCHAR(180) NOT NULL,
  categoria ENUM('NUTRICIONAL','CHATARRA') NOT NULL,
  tipo_comida ENUM('ALMUERZO','CENA','AMBOS') NOT NULL,
  descripcion TEXT NOT NULL,
  ingredientes TEXT NOT NULL,
  preparacion TEXT NOT NULL,
  porcion VARCHAR(100) NOT NULL,
  calorias DECIMAL(8,2) NOT NULL,
  proteinas DECIMAL(8,2) NOT NULL,
  carbohidratos DECIMAL(8,2) NOT NULL,
  grasas DECIMAL(8,2) NOT NULL,
  fibra DECIMAL(8,2) NOT NULL,
  sodio DECIMAL(8,2) NOT NULL,
  tiempo_preparacion INT UNSIGNED NOT NULL,
  dificultad ENUM('FACIL','MEDIA','ALTA') NOT NULL,
  costo_estimado DECIMAL(10,2) NOT NULL,
  moneda CHAR(3) NOT NULL DEFAULT 'ARS',
  apta_comedor BOOLEAN NOT NULL DEFAULT TRUE,
  observaciones TEXT NULL,
  fuente_proteina VARCHAR(40) NOT NULL,
  metodo_coccion VARCHAR(30) NOT NULL,
  vegetariana BOOLEAN NOT NULL,
  contiene_carne BOOLEAN NOT NULL,
  contiene_pescado BOOLEAN NOT NULL,
  contiene_legumbres BOOLEAN NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_comidas_nombre_normalizado (normalized_name),
  KEY idx_categoria (categoria, activa),
  KEY idx_tipo_comida (tipo_comida, activa),
  KEY idx_apta_comedor (apta_comedor, activa),
  KEY idx_calorias (calorias),
  KEY idx_proteinas (proteinas),
  KEY idx_costo_estimado (costo_estimado),
  KEY idx_dificultad_tiempo (dificultad, tiempo_preparacion),
  KEY idx_fuente_proteina (fuente_proteina),
  KEY idx_filtros_dieteticos (vegetariana, contiene_carne, contiene_pescado, contiene_legumbres)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;

const rows = comidas.map((meal) => [
  meal.id, meal.name, meal.normalizedName, meal.category, meal.mealService, meal.description,
  meal.ingredients, meal.preparation, meal.portion, meal.calories, meal.proteinGrams,
  meal.carbohydrateGrams, meal.fatGrams, meal.fiberGrams, meal.sodiumMilligrams,
  meal.preparationMinutes, meal.difficulty, meal.estimatedCost, meal.currency,
  meal.suitableForCanteen, meal.observations, meal.proteinSource, meal.cookingMethod,
  meal.vegetarian, meal.containsMeat, meal.containsFish, meal.containsLegumes
].map(sqlValue).join(", "));

const validation = `-- Consultas para validar y explorar el catálogo
SELECT COUNT(*) AS total FROM comidas;
SELECT categoria, COUNT(*) AS cantidad FROM comidas GROUP BY categoria ORDER BY categoria;
SELECT COUNT(*) AS almuerzos FROM comidas WHERE tipo_comida IN ('ALMUERZO','AMBOS');
SELECT COUNT(*) AS cenas FROM comidas WHERE tipo_comida IN ('CENA','AMBOS');
SELECT id, nombre, costo_estimado, moneda FROM comidas WHERE activa = TRUE ORDER BY costo_estimado ASC LIMIT 10;
SELECT id, nombre, proteinas, porcion FROM comidas WHERE activa = TRUE ORDER BY proteinas DESC LIMIT 10;
SELECT id, nombre, calorias, porcion FROM comidas WHERE activa = TRUE ORDER BY calorias ASC LIMIT 10;
`;

const weeklyExample = `-- Ejemplo de selección semanal: 7 días, almuerzo y cena, 80% nutricional.
-- La consulta es de vista previa. Para guardar borradores con auditoría y evitar reemplazar menús,
-- usar el generador de la aplicación en Menú > Constructor de menú.
SET @fecha_inicio = CURRENT_DATE();
SET @porcentaje_nutricional = 80;
WITH RECURSIVE dias AS (
  SELECT 0 AS desplazamiento, DATE(@fecha_inicio) AS fecha
  UNION ALL
  SELECT desplazamiento + 1, DATE_ADD(@fecha_inicio, INTERVAL desplazamiento + 1 DAY)
  FROM dias WHERE desplazamiento < 6
), servicios AS (
  SELECT 'ALMUERZO' AS servicio, 1 AS orden
  UNION ALL SELECT 'CENA', 2
), turnos AS (
  SELECT dias.fecha, servicios.servicio,
         ROW_NUMBER() OVER (ORDER BY dias.fecha, servicios.orden) AS turno
  FROM dias CROSS JOIN servicios
), categoria_turno AS (
  SELECT fecha, servicio, turno,
         CASE WHEN ROUND(turno * @porcentaje_nutricional / 100) >
                   ROUND((turno - 1) * @porcentaje_nutricional / 100)
              THEN 'NUTRICIONAL' ELSE 'CHATARRA' END AS categoria
  FROM turnos
), numerados AS (
  SELECT c.id, c.nombre, c.categoria, c.tipo_comida, c.fuente_proteina,
         s.servicio,
         ROW_NUMBER() OVER (PARTITION BY c.categoria, s.servicio ORDER BY CRC32(CONCAT(c.id, @fecha_inicio))) AS opcion,
         COUNT(*) OVER (PARTITION BY c.categoria, s.servicio) AS opciones
  FROM comidas c
  CROSS JOIN servicios s
  WHERE c.activa = TRUE AND c.apta_comedor = TRUE
    AND (c.tipo_comida = 'AMBOS' OR c.tipo_comida = s.servicio)
), turnos_categoria AS (
  SELECT fecha, servicio, turno, categoria,
   ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY fecha, FIELD(servicio, 'ALMUERZO','CENA')) AS eleccion
  FROM categoria_turno
)
SELECT tc.fecha, tc.servicio, tc.categoria, n.id, n.nombre, n.fuente_proteina
FROM turnos_categoria tc
JOIN numerados n ON n.categoria = tc.categoria AND n.servicio = tc.servicio
  AND n.opcion = MOD(tc.eleccion - 1, n.opciones) + 1
ORDER BY tc.fecha, FIELD(tc.servicio, 'ALMUERZO','CENA');
`;

const sql = `-- Comedor UNCA: catálogo de 500 platos preparados.
-- Nutrientes, costos y tiempos son orientativos por porción y requieren validación institucional.
-- No elimina ni reemplaza tablas o registros existentes; la importación puede repetirse.
SET NAMES utf8mb4;

${table}

INSERT IGNORE INTO comidas (${columns.join(", ")}) VALUES\n${rows.map((row) => `(${row})`).join(",\n")};

${validation}
${weeklyExample}`;

const output = resolve(process.cwd(), "database", "comidas_500.sql");
await writeFile(output, sql, "utf8");
console.info(`SQL generado: ${output} (${comidas.length} filas, ${Buffer.byteLength(sql)} bytes).`);
