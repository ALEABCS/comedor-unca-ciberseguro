import { describe, expect, it } from "vitest";
import { buildSecurityOverview } from "./security-center";

describe("security center summary", () => {
  it("scores risk using combined security signals", () => {
    const summary = buildSecurityOverview({
      recentAuditEvents: 80,
      failedLogins: 12,
      activeSessions: 75,
      revokedSessions: 3,
      featureFlags: { CYBERDEFENSE_ENGINE: true, ADAPTIVE_SECURITY: true }
    });

    expect(summary.riskLevel).toBe("HIGH");
    expect(summary.status).toBe("watch");
    expect(summary.metrics.failedLogins).toBe(12);
  });

  it("keeps the security center stable under low-risk conditions", () => {
    const summary = buildSecurityOverview({
      recentAuditEvents: 6,
      failedLogins: 1,
      activeSessions: 18,
      revokedSessions: 0
    });

    expect(summary.riskLevel).toBe("LOW");
    expect(summary.status).toBe("stable");
    expect(summary.recommendation).toContain("mantener políticas actuales");
  });
});
