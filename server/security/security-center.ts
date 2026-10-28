import { classifyRisk } from "./risk";

export type SecurityCenterMetrics = {
  recentAuditEvents: number;
  failedLogins: number;
  activeSessions: number;
  revokedSessions: number;
  featureFlags?: Record<string, boolean>;
};

export function buildSecurityOverview(metrics: SecurityCenterMetrics) {
  const riskScore = Math.min(100, Math.round(
    metrics.recentAuditEvents * 0.2 +
    metrics.failedLogins * 4 +
    metrics.revokedSessions * 5 +
    Math.max(0, metrics.activeSessions - 60) * 0.1
  ));

  const riskLevel = classifyRisk(riskScore);
  const recommendation = riskLevel === "LOW"
    ? "Sin señales críticas; mantener políticas actuales y continuar con monitoreo habitual."
    : riskLevel === "MEDIUM"
      ? "Se requiere revisión de patrones, reforzamiento de rate limiting y revisión de sesiones activas."
      : riskLevel === "HIGH"
        ? "Se recomienda exigir reautenticación, revisar accesos administrativos y reforzar alertas inmediatas."
        : "Se debe activar revisión humana inmediata, invalidar sesiones sospechosas y cerrar incidentes operativos.";

  return {
    riskScore,
    riskLevel,
    status: riskLevel === "CRITICAL" ? "requires_attention" : riskLevel === "HIGH" ? "watch" : "stable",
    recommendation,
    metrics: {
      recentAuditEvents: metrics.recentAuditEvents,
      failedLogins: metrics.failedLogins,
      activeSessions: metrics.activeSessions,
      revokedSessions: metrics.revokedSessions,
      featureFlags: metrics.featureFlags ?? {}
    }
  };
}
