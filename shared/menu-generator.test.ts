import { describe, expect, it } from "vitest";
import { comidas } from "./comidas";
import { planMenus } from "./menu-generator";

describe("generación de menús desde el catálogo", () => {
  it("genera almuerzo y cena diarios con una proporción nutricional configurable", () => {
    const plan = planMenus(comidas, "2026-10-06", 7, 80);
    expect(plan).toHaveLength(14);
    expect(plan.filter((slot) => slot.service === "ALMUERZO")).toHaveLength(7);
    expect(plan.filter((slot) => slot.service === "CENA")).toHaveLength(7);
    expect(plan.filter((slot) => slot.meal.category === "NUTRICIONAL")).toHaveLength(11);
    expect(new Set(plan.map((slot) => slot.meal.id)).size).toBe(plan.length);
  });

  it("no reemplaza servicios existentes y limita el plan a un mes", () => {
    const week = planMenus(comidas, "2026-10-06", 7, 50, [{ date: "2026-10-06", service: "ALMUERZO" }]);
    expect(week).toHaveLength(13);
    expect(week.some((slot) => slot.date === "2026-10-06" && slot.service === "ALMUERZO")).toBe(false);
    expect(planMenus(comidas, "2026-10-01", 30, 80)).toHaveLength(60);
  });

  it("excluye platos que ya están en menús existentes cercanos", () => {
    const plan = planMenus(comidas, "2026-10-06", 1, 100, [], [comidas[0]!.id]);
    expect(plan.some((slot) => slot.meal.id === comidas[0]!.id)).toBe(false);
  });

  it("valida período, fecha y porcentaje antes de planificar", () => {
    expect(() => planMenus(comidas, "2026-02-31", 7, 80)).toThrow();
    expect(() => planMenus(comidas, "2026-10-06", 32, 80)).toThrow();
    expect(() => planMenus(comidas, "2026-10-06", 7, 101)).toThrow();
  });
});