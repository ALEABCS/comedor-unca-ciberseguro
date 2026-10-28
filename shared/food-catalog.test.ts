import { describe, expect, it } from "vitest";
import { foodTypeForCategory, splitFoodCatalogSearch } from "./food-catalog";

describe("food catalog category defaults", () => {
  it("splits catalog searches into independent terms", () => {
    expect(splitFoodCatalogSearch("pizza, salsa; sopa\nfruta")).toEqual(["pizza", "salsa", "sopa", "fruta"]);
    expect(splitFoodCatalogSearch("  pescado ,,  ")).toEqual(["pescado"]);
  });

  it("classifies beverages and prepared dishes consistently", () => {
    expect(foodTypeForCategory("BEBIDAS")).toBe("BEBIDA");
    expect(foodTypeForCategory("TARTAS")).toBe("PREPARACION");
    expect(foodTypeForCategory("GUARNICIONES")).toBe("PREPARACION");
    expect(foodTypeForCategory("SOPAS")).toBe("PREPARACION");
    expect(foodTypeForCategory("PLATOS_NUTRICIONALES")).toBe("PREPARACION");
    expect(foodTypeForCategory("PLATOS_CHATARRA")).toBe("PREPARACION");
    expect(foodTypeForCategory("FRUTAS")).toBe("ALIMENTO");
    expect(foodTypeForCategory("CUSTOM")).toBe("ALIMENTO");
  });
});
