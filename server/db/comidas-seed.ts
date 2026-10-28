import type { PoolConnection } from "mysql2/promise";
import { comidas } from "../../shared/comidas";

const batchSize = 50;
const columns = [
  "id", "nombre", "normalized_name", "categoria", "tipo_comida", "descripcion", "ingredientes",
  "preparacion", "porcion", "calorias", "proteinas", "carbohidratos", "grasas", "fibra", "sodio",
  "tiempo_preparacion", "dificultad", "costo_estimado", "moneda", "apta_comedor", "observaciones",
  "fuente_proteina", "metodo_coccion", "vegetariana", "contiene_carne", "contiene_pescado", "contiene_legumbres"
] as const;

export async function seedComidas(connection: PoolConnection): Promise<number> {
  let inserted = 0;
  for (let offset = 0; offset < comidas.length; offset += batchSize) {
    const batch = comidas.slice(offset, offset + batchSize);
    const values = batch.flatMap((meal) => [
      meal.id, meal.name, meal.normalizedName, meal.category, meal.mealService, meal.description,
      meal.ingredients, meal.preparation, meal.portion, meal.calories, meal.proteinGrams,
      meal.carbohydrateGrams, meal.fatGrams, meal.fiberGrams, meal.sodiumMilligrams,
      meal.preparationMinutes, meal.difficulty, meal.estimatedCost, meal.currency,
      meal.suitableForCanteen, meal.observations, meal.proteinSource, meal.cookingMethod,
      meal.vegetarian, meal.containsMeat, meal.containsFish, meal.containsLegumes
    ]);
    const placeholders = batch.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    const [result] = await connection.execute(
      `INSERT IGNORE INTO comidas (${columns.join(", ")}) VALUES ${placeholders}`,
      values
    );
    if ("affectedRows" in result) inserted += result.affectedRows;
  }

  for (const meal of comidas) {
    const foodId = `00000000-0000-4000-8000-${meal.id.padStart(12, "0")}`;
    const categoryCode = meal.category === "NUTRICIONAL" ? "PLATOS_NUTRICIONALES" : "PLATOS_CHATARRA";
    await connection.execute(
      `INSERT IGNORE INTO foods
       (id, name, normalized_name, category_code, subcategory, food_type, description,
        sin_tacc, vegan, vegetarian, allergens_verified, calories, protein_grams,
        carbohydrate_grams, fat_grams, fiber_grams, sodium_milligrams)
       VALUES (?, ?, ?, ?, ?, 'PREPARACION', ?, NULL, NULL, ?, FALSE, ?, ?, ?, ?, ?, ?)`,
      [foodId, meal.name, meal.normalizedName, categoryCode, meal.proteinSource, meal.description,
        meal.vegetarian, meal.calories, meal.proteinGrams, meal.carbohydrateGrams,
        meal.fatGrams, meal.fiberGrams, meal.sodiumMilligrams]
    );
  }

  return inserted;
}
