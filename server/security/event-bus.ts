export type SecurityEventSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SecurityEventTopic = "AUTH" | "SESSION" | "ADMIN" | "RESERVATION" | "PAYMENT" | "TICKET" | "INCIDENT" | "SYSTEM";

export type SecurityEventFeedRow = {
  id: string;
  action: string;
  createdAt: string;
  resourceType?: string | null;
  actorRole?: string | null;
  email?: string | null;
  metadata?: unknown;
};

export type SecurityEventEntry = {
  id: string;
  occurredAt: string;
  topic: SecurityEventTopic;
  severity: SecurityEventSeverity;
  title: string;
  description: string;
  actor: string;
  source: string;
};

export function isFailedAuthenticationAction(action: string): boolean {
  const normalized = action.toLowerCase();
  return normalized.includes("login_failed") || normalized.includes("login.failed");
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function buildTitle(action: string): { title: string; topic: SecurityEventTopic; severity: SecurityEventSeverity } {
  const normalized = action.toLowerCase();

  if (isFailedAuthenticationAction(action) || normalized.includes("auth.login")) {
    return { title: "Intento de acceso fallido", topic: "AUTH", severity: "HIGH" };
  }
  if (normalized.includes("session.revoke") || normalized.includes("session") && normalized.includes("revoke")) {
    return { title: "Sesión revocada", topic: "SESSION", severity: "MEDIUM" };
  }
  if (normalized.includes("incident") || normalized.includes("security.action.create_incident") || normalized.includes("security.action.request_review")) {
    return { title: "Evento de incidente o revisión", topic: "INCIDENT", severity: "HIGH" };
  }
  if (normalized.includes("payment") || normalized.includes("reference")) {
    return { title: "Actividad de pago revisada", topic: "PAYMENT", severity: "MEDIUM" };
  }
  if (normalized.includes("ticket") || normalized.includes("validate") || normalized.includes("scan")) {
    return { title: "Consumo o ticket validado", topic: "TICKET", severity: "MEDIUM" };
  }
  if (normalized.includes("reservation") || normalized.includes("waitlist") || normalized.includes("cancel")) {
    return { title: "Cambio de reserva", topic: "RESERVATION", severity: "LOW" };
  }
  if (normalized.includes("role") || normalized.includes("user.create") || normalized.includes("user.update") || normalized.includes("profile.update")) {
    return { title: "Cambio administrativo", topic: "ADMIN", severity: "MEDIUM" };
  }

  return { title: "Evento del sistema", topic: "SYSTEM", severity: "LOW" };
}

function formatActor(actor: string | null | undefined, role: string | null | undefined): string {
  if (actor && actor.trim()) return actor.trim();
  if (role && role.trim()) return `Sistema • ${role.trim()}`;
  return "Sistema";
}

export function buildSecurityEventFeed(rows: readonly SecurityEventFeedRow[]): SecurityEventEntry[] {
  return rows.slice(0, 20).map((row) => {
    const metadata = parseMetadata(row.metadata);
    const { title, topic, severity } = buildTitle(row.action);
    const failedAuthentication = isFailedAuthenticationAction(row.action);
    const actor = failedAuthentication
      ? "Intento de acceso no identificado"
      : formatActor(row.email ?? null, row.actorRole ?? null);
    const source = row.resourceType ?? "audit";
    const description = failedAuthentication
      ? "Se registró un intento de acceso rechazado sin exponer la identidad ni las credenciales."
      : row.action.toLowerCase().includes("login")
      ? "Se detectó un intento de acceso con señales de autenticación no esperadas dentro del período actual."
      : row.action.toLowerCase().includes("session")
        ? "La operación afectó una sesión activa y quedó registrada con trazabilidad para revisión."
        : row.action.toLowerCase().includes("incident") || row.action.toLowerCase().includes("request_review")
          ? "Se registró un evento de supervisión con impacto operativo y requiere revisión humana."
          : row.action.toLowerCase().includes("ticket")
            ? "Se produjo una validación de ticket con seguimiento del consumo del comedor."
            : row.action.toLowerCase().includes("payment")
              ? "Se registró una operación de pago o referencia con posibles implicancias operativas."
              : `Se registró ${row.action} con metadatos del evento en auditoría.`;

    return {
      id: String(row.id),
      occurredAt: String(row.createdAt),
      topic,
      severity,
      title,
      description: !failedAuthentication && metadata.reason ? `${description} Motivo: ${String(metadata.reason)}` : description,
      actor,
      source
    };
  });
}
