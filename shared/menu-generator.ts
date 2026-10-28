import type { Comida, MealCategory, MealService } from "./comidas";

export type MenuSlot = { date: string; service: "ALMUERZO" | "CENA"; meal: Comida };

export function planMenus(
  meals: Comida[], startDate: string, days: number, nutritionalPercentage: number,
  existingSlots: Array<{ date: string; service: string }> = [], excludedMealIds: string[] = []
): MenuSlot[] {
  const parsedStartDate = new Date(`${startDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(parsedStartDate.getTime()) || parsedStartDate.toISOString().slice(0, 10) !== startDate) {
    throw new RangeError("La fecha inicial debe usar AAAA-MM-DD y ser válida.");
  }
  if (!Number.isInteger(days) || days < 1 || days > 31) throw new RangeError("El período debe tener entre 1 y 31 días.");
  if (!Number.isInteger(nutritionalPercentage) || nutritionalPercentage < 0 || nutritionalPercentage > 100) {
    throw new RangeError("El porcentaje nutricional debe ser un entero entre 0 y 100.");
  }

  const existing = new Set(existingSlots.map((slot) => `${slot.date}:${slot.service}`));
  const targets: Array<{ date: string; service: "ALMUERZO" | "CENA" }> = [];
  const firstDay = new Date(`${startDate}T12:00:00.000Z`);
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(firstDay);
    date.setUTCDate(firstDay.getUTCDate() + offset);
    const dateKey = date.toISOString().slice(0, 10);
    for (const service of ["ALMUERZO", "CENA"] as const) {
      if (!existing.has(`${dateKey}:${service}`)) targets.push({ date: dateKey, service });
    }
  }

  const targetNutrition = Math.round(targets.length * nutritionalPercentage / 100);
  let nutritionCount = 0;
  const usedMealIds = new Set(excludedMealIds);
  const output: MenuSlot[] = [];

  for (const [slotIndex, target] of targets.entries()) {
    const slotsLeft = targets.length - slotIndex;
    const nutritionNeeded = targetNutrition - nutritionCount;
    const category: MealCategory = nutritionNeeded >= slotsLeft ? "NUTRICIONAL"
      : nutritionNeeded <= 0 ? "CHATARRA"
        : nutritionNeeded / slotsLeft >= targetNutrition / targets.length ? "NUTRICIONAL" : "CHATARRA";
    const previous = output.at(-1)?.meal;
    const sameDayOther = output.find((slot) => slot.date === target.date && slot.service !== target.service)?.meal;
    const candidates = meals.filter((meal) => meal.category === category && (meal.mealService === target.service || meal.mealService === "AMBOS"));
    if (!candidates.length) throw new Error(`No hay comidas disponibles para ${category} en ${target.service}.`);

    const recentProteinCounts = new Map<string, number>();
    for (const recent of output.slice(-4)) {
      recentProteinCounts.set(recent.meal.proteinSource, (recentProteinCounts.get(recent.meal.proteinSource) ?? 0) + 1);
    }
    const deterministicOffset = slotIndex % candidates.length;
    const selected = candidates.map((meal, index) => {
      let score = usedMealIds.has(meal.id) ? 100 : 0;
      if (previous?.proteinSource === meal.proteinSource) score += 12;
      if (sameDayOther?.proteinSource === meal.proteinSource) score += 9;
      if (previous?.cookingMethod === meal.cookingMethod) score += 2;
      score += (recentProteinCounts.get(meal.proteinSource) ?? 0) * 2;
      if (meal.mealService !== "AMBOS" && meal.mealService !== target.service) score += 4;
      return { meal, score, tie: (index - deterministicOffset + candidates.length) % candidates.length };
    }).sort((left, right) => left.score - right.score || left.tie - right.tie)[0]!.meal;

    output.push({ ...target, meal: selected });
    usedMealIds.add(selected.id);
    if (selected.category === "NUTRICIONAL") nutritionCount += 1;
  }

  return output;
}

export function mealServiceSupports(mealService: MealService, service: "ALMUERZO" | "CENA"): boolean {
  return mealService === service || mealService === "AMBOS";
}