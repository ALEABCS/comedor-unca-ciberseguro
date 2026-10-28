export const riskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof riskLevels)[number];

export type RiskSignal = {
  name: string;
  weight: number;
  value: number;
};

export type RiskAssessment = {
  score: number;
  level: RiskLevel;
  signals: RiskSignal[];
  explanation: string;
};

export function classifyRisk(score: number): RiskLevel {
  if (score >= 90) return "CRITICAL";
  if (score >= 70) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

export function evaluateRisk(signals: readonly RiskSignal[]): RiskAssessment {
  const normalized = signals.map((signal) => ({
    ...signal,
    weight: Number.isFinite(signal.weight) ? Math.max(0, signal.weight) : 0,
    value: Number.isFinite(signal.value) ? Math.max(0, signal.value) : 0
  }));

  const score = Math.min(100, Math.round(
    normalized.reduce((total, signal) => total + signal.weight * signal.value, 0)
  ));

  const level = classifyRisk(score);
  const explanation = normalized.length
    ? `${normalized.length} señales de riesgo fueron combinadas para alcanzar un nivel ${level}.`
    : `No se registraron señales de riesgo relevantes; el nivel resultante fue ${level}.`;

  return {
    score,
    level,
    signals: normalized,
    explanation
  };
}
