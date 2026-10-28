import { describe, expect, it } from "vitest";
import { EvolutionEngine } from "./evolution";
import { resolveFeatureFlags } from "./feature-flags";
import { classifyRisk, evaluateRisk } from "./risk";

describe("risk and evolution security primitives", () => {
  it("classifies escalating risk based on combined signals", () => {
    expect(classifyRisk(5)).toBe("LOW");
    expect(classifyRisk(60)).toBe("MEDIUM");
    expect(classifyRisk(85)).toBe("HIGH");
    expect(classifyRisk(95)).toBe("CRITICAL");

    const assessment = evaluateRisk([
      { name: "login_fails", weight: 10, value: 2 },
      { name: "new_session", weight: 5, value: 1 }
    ]);

    expect(assessment.level).toBe("MEDIUM");
    expect(assessment.score).toBeGreaterThan(0);
    expect(assessment.signals).toHaveLength(2);
  });

  it("exposes feature flags and evolution proposals", () => {
    expect(resolveFeatureFlags().CYBERDEFENSE_ENGINE).toBe(true);

    const engine = new EvolutionEngine();
    engine.observe("security_event", 42, "Multiple failed login attempts");
    const analysis = engine.analyze();
    const proposal = engine.propose("raise_monitoring", "Múltiples fallos de autenticación en un breve periodo.", "HIGH");

    expect(analysis.totalObservations).toBe(1);
    expect(proposal.requiresApproval).toBe(true);
    expect(engine.policy().name).toBe("EVOLUTION_ENGINE");
  });
});
