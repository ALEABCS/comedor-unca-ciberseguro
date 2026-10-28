import { describe, expect, it } from "vitest";
import { comidas } from "./comidas";

describe("catálogo estructurado de comidas", () => {
  it("genera 250 platos nutricionales y 250 de baja calidad con IDs únicos", () => {
    expect(comidas).toHaveLength(500);
    expect(comidas.filter((meal) => meal.category === "NUTRICIONAL")).toHaveLength(250);
    expect(comidas.filter((meal) => meal.category === "CHATARRA")).toHaveLength(250);
    expect(comidas.map((meal) => meal.id)).toEqual(Array.from({ length: 500 }, (_, index) => String(index + 1).padStart(3, "0")));
  });

  it("no repite nombres ni claves normalizadas", () => {
    expect(new Set(comidas.map((meal) => meal.name)).size).toBe(500);
    expect(new Set(comidas.map((meal) => meal.normalizedName)).size).toBe(500);
  });

  it("completa campos y valores numéricos coherentes para las 500 porciones", () => {
    for (const meal of comidas) {
      expect(meal.name.length).toBeGreaterThan(10);
      expect(meal.description.length).toBeGreaterThan(20);
      expect(meal.ingredients.length).toBeGreaterThan(10);
      expect(meal.preparation.length).toBeGreaterThan(20);
      expect(meal.portion.length).toBeGreaterThan(5);
      for (const value of [meal.calories, meal.proteinGrams, meal.carbohydrateGrams, meal.fatGrams,
        meal.fiberGrams, meal.sodiumMilligrams, meal.estimatedCost, meal.preparationMinutes]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
      expect(Math.abs(meal.calories - (meal.proteinGrams * 4 + meal.carbohydrateGrams * 4 + meal.fatGrams * 9))).toBeLessThanOrEqual(1);
      expect(meal.currency).toBe("ARS");
      expect(meal.suitableForCanteen).toBe(true);
    }
  });

  it("identifica los platos de baja calidad como consumo ocasional", () => {
    for (const meal of comidas.filter((item) => item.category === "CHATARRA")) {
      expect(meal.observations).toContain("baja calidad nutricional");
    }
  });

  it("incluye variedad de fuentes y métodos y refleja más sodio y energía en comida chatarra", () => {
    const nutritional = comidas.filter((meal) => meal.category === "NUTRICIONAL");
    const junk = comidas.filter((meal) => meal.category === "CHATARRA");
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(new Set(nutritional.map((meal) => meal.proteinSource)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(nutritional.map((meal) => meal.cookingMethod)).size).toBeGreaterThanOrEqual(5);
    expect(average(junk.map((meal) => meal.sodiumMilligrams))).toBeGreaterThan(average(nutritional.map((meal) => meal.sodiumMilligrams)));
    expect(average(junk.map((meal) => meal.calories))).toBeGreaterThan(average(nutritional.map((meal) => meal.calories)));
  });
});