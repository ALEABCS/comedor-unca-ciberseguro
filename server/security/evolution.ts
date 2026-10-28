export type EvolutionObservation = {
  event: string;
  value: number;
  description: string;
};

export type EvolutionProposal = {
  action: string;
  rationale: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requiresApproval: boolean;
};

export class EvolutionEngine {
  private observations: EvolutionObservation[] = [];

  observe(event: string, value: number, description: string): void {
    this.observations.push({ event, value, description });
  }

  analyze(): { totalObservations: number; averageValue: number; events: string[] } {
    const totalObservations = this.observations.length;
    const averageValue = totalObservations === 0
      ? 0
      : this.observations.reduce((total, observation) => total + observation.value, 0) / totalObservations;

    return {
      totalObservations,
      averageValue,
      events: this.observations.map((observation) => observation.event)
    };
  }

  propose(action: string, rationale: string, severity: EvolutionProposal["severity"]): EvolutionProposal {
    return {
      action,
      rationale,
      severity,
      requiresApproval: severity === "HIGH" || severity === "CRITICAL"
    };
  }

  policy(): { name: string; summary: string; allowsAutomation: boolean } {
    return {
      name: "EVOLUTION_ENGINE",
      summary: "Observación + análisis + propuesta + política + aprobación + ejecución controlada + auditoría.",
      allowsAutomation: false
    };
  }

  audit(event: string): { event: string; status: "recorded" } {
    return { event, status: "recorded" };
  }
}
