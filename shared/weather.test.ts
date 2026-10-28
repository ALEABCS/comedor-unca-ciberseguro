import { describe, expect, it } from "vitest";
import { weatherConditionForCode } from "./weather";

describe("Open-Meteo weather codes", () => {
  it("maps clear, cloud, fog, rain and storm conditions to Spanish labels and icons", () => {
    expect(weatherConditionForCode(0)).toEqual({ label: "Despejado", icon: "sun" });
    expect(weatherConditionForCode(2)).toEqual({ label: "Parcialmente nublado", icon: "partly-cloudy" });
    expect(weatherConditionForCode(3)).toEqual({ label: "Nublado", icon: "cloud" });
    expect(weatherConditionForCode(45)).toEqual({ label: "Niebla", icon: "fog" });
    expect(weatherConditionForCode(63)).toEqual({ label: "Lluvia", icon: "rain" });
    expect(weatherConditionForCode(95)).toEqual({ label: "Tormenta", icon: "storm" });
  });

  it("does not invent a condition for unknown service codes", () => {
    expect(weatherConditionForCode(-1)).toEqual({ label: "Condición no disponible", icon: "cloud" });
  });
});