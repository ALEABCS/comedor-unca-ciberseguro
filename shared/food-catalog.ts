export type FoodType = "ALIMENTO" | "PREPARACION" | "BEBIDA";

export function splitFoodCatalogSearch(search: string): string[] {
  return search.split(/[,;\n]+/).map((term) => term.trim()).filter(Boolean);
}

export function foodTypeForCategory(categoryCode: string): FoodType {
  if (categoryCode === "BEBIDAS") return "BEBIDA";
  if (["TARTAS", "GUARNICIONES", "SOPAS", "PLATOS_NUTRICIONALES", "PLATOS_CHATARRA"].includes(categoryCode)) return "PREPARACION";
  return "ALIMENTO";
}
