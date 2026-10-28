export type WeatherIconKey =
  | "sun"
  | "partly-cloudy"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm";

export type WeatherCondition = { label: string; icon: WeatherIconKey };

export function weatherConditionForCode(code: number): WeatherCondition {
  if (code === 0) return { label: "Despejado", icon: "sun" };
  if (code === 1 || code === 2) return { label: "Parcialmente nublado", icon: "partly-cloudy" };
  if (code === 3) return { label: "Nublado", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Niebla", icon: "fog" };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: "Llovizna", icon: "drizzle" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "Lluvia", icon: "rain" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Nieve", icon: "snow" };
  if ([95, 96, 99].includes(code)) return { label: "Tormenta", icon: "storm" };
  return { label: "Condición no disponible", icon: "cloud" };
}