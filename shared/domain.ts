export const roles = [
  "ALUMNO",
  "DOCENTE",
  "NO_DOCENTE",
  "INVITADO_ESPECIAL",
  "ADMINISTRADOR_LOCAL",
  "SUPERVISOR"
] as const;

export type Role = (typeof roles)[number];
export type Service = "ALMUERZO" | "CENA";

export function assignableRolesForActor(actorRole: Role): readonly Role[] {
  if (actorRole === "SUPERVISOR") return roles;
  if (actorRole === "ADMINISTRADOR_LOCAL") {
    return ["ALUMNO", "DOCENTE", "NO_DOCENTE", "INVITADO_ESPECIAL"];
  }
  return [];
}

export function canAccessFoodCredits(role: Role): boolean {
  return role === "ALUMNO" || role === "SUPERVISOR";
}

export const permissions = {
  "menu:read": roles,
  "reservations:create": ["ALUMNO", "DOCENTE", "NO_DOCENTE", "INVITADO_ESPECIAL"],
  "reservations:read:own": ["ALUMNO", "DOCENTE", "NO_DOCENTE", "INVITADO_ESPECIAL"],
  "reservations:cancel:own": ["ALUMNO", "DOCENTE", "NO_DOCENTE", "INVITADO_ESPECIAL"],
  "reservations:read:all": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "reservations:manage": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "menu:manage": ["ADMINISTRADOR_LOCAL"],
  "tickets:validate": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "reservations:approve": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "users:read": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "users:manage": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "users:create": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "scholarships:manage": ["SUPERVISOR"],
  "prices:manage": ["SUPERVISOR"],
  "payments:read": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "payments:manage": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "payments:cash:manage": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "payments:reconcile": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "payments:adjustments:manage": ["SUPERVISOR"],
  "payments:export": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "incidents:create": ["ALUMNO", "DOCENTE", "NO_DOCENTE", "INVITADO_ESPECIAL", "ADMINISTRADOR_LOCAL"],
  "incidents:read": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "incidents:manage": ["ADMINISTRADOR_LOCAL"],
  "audit:read": ["SUPERVISOR"],
  "statistics:read": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "settings:manage": ["SUPERVISOR"],
  "kitchen:read": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"],
  "kitchen:manage": ["ADMINISTRADOR_LOCAL", "SUPERVISOR"]
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof permissions;

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return (permissions[permission] as readonly Role[]).includes(role);
}

export function isTicketEligible(approvalStatus: string, paymentStatus: string): boolean {
  return approvalStatus === "APROBADA" &&
    (paymentStatus === "PAGADO" || paymentStatus === "NO_REQUIERE_PAGO");
}

export function startOfWeek(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - ((day + 6) % 7));
  return value.toISOString().slice(0, 10);
}

export function isReservationDateAllowed(date: string, today: string): boolean {
  return isCalendarDate(date) && isCalendarDate(today) && date >= today;
}

export function isInstitutionalBusinessDay(date: string): boolean {
  if (!isCalendarDate(date)) return false;
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

export function canBook(usedThisWeek: number, capacity: number, booked: number): boolean {
  return usedThisWeek < 5 && booked < capacity;
}

export function configuredDeadlineUtc(date: string, time: string): Date {
  const utcValue = new Date(`${date}T${time}:00.000Z`);
  utcValue.setUTCHours(utcValue.getUTCHours() + 3);
  return utcValue;
}

export function isDeadlineReached(deadline: string | Date | null | undefined, now = Date.now()): boolean {
  if (!deadline) return false;
  const timestamp = deadline instanceof Date ? deadline.getTime() : Date.parse(deadline);
  return Number.isFinite(timestamp) && timestamp <= now;
}

export function formatDeadlineCountdown(deadline: string | Date | null | undefined, now = Date.now()) {
  if (!deadline) return null;
  const timestamp = deadline instanceof Date ? deadline.getTime() : Date.parse(deadline);
  if (!Number.isFinite(timestamp)) return null;
  const secondsRemaining = Math.max(0, Math.ceil((timestamp - now) / 1000));
  if (secondsRemaining === 0) return { expired: true, label: "Plazo vencido" };

  const days = Math.floor(secondsRemaining / 86_400);
  const hours = Math.floor((secondsRemaining % 86_400) / 3_600);
  const minutes = Math.floor((secondsRemaining % 3_600) / 60);
  const seconds = secondsRemaining % 60;
  const label = days > 0
    ? `${days} d ${hours} h`
    : hours > 0
      ? `${hours} h ${minutes} min`
      : minutes > 0
        ? `${minutes} min ${seconds} s`
        : `${seconds} s`;
  return { expired: false, label };
}

export function isWithinBookingWindow(now: string, opensAt: string, closesAt: string): boolean {
  return /^\d{2}:\d{2}$/.test(now) && now >= opensAt && now < closesAt;
}

export function isCancellationAllowed(
  serviceDate: string,
  bookingClosesAt: string,
  today: string,
  nowTime: string
): boolean {
  if (!isCalendarDate(serviceDate) || !isCalendarDate(today) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(bookingClosesAt)) {
    return false;
  }
  if (serviceDate > today) return true;
  return serviceDate === today &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(nowTime) &&
    nowTime < bookingClosesAt;
}

export function formatTicketIdentifier(serviceDate: string, service: Service, dailyNumber: number): string {
  const [year, month, day] = serviceDate.slice(0, 10).split("-");
  const serviceCode = service === "ALMUERZO" ? "A" : "C";
  return `${dailyNumber}-${Number(day)}-${Number(month)}-${year}-${serviceCode}`;
}
