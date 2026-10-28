import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  Accessibility, Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, CalendarDays, Camera, CameraOff, Check, ChevronDown,
  CircleHelp, ClipboardList, Clock3, CreditCard, Download, FileClock, Gift, GraduationCap, LayoutDashboard, LogOut,
  Menu as MenuIcon, Moon, MonitorSmartphone, Newspaper, Plus, Printer, QrCode, Settings, ShieldCheck, Soup, TicketCheck, Trash2, Utensils, Users, X
} from "lucide-react";
import { trpc } from "./trpc";
import { ClockWeather } from "./ClockWeather";
import { brandAssets, comedorPhotos } from "./branding";
import { assignableRolesForActor, canAccessFoodCredits, formatDeadlineCountdown, formatTicketIdentifier, isCancellationAllowed, isTicketEligible } from "../../shared/domain";
import { downloadCsv } from "./csv";
import type { Role } from "../../shared/domain";
import { accessibilityPreferencesSchema, defaultAccessibilityPreferences, type AccessibilityPreferences } from "../../shared/accessibility";
import { paymentMethodLabels, paymentMethodValues, type PaymentMethod } from "../../shared/payment-methods";
import type { AuthUser } from "../../server/trpc";

const EventsNews = lazy(() => import("./EventsNews").then((module) => ({ default: module.EventsNews })));
const MenuCatalogTools = lazy(() => import("./MenuCatalogTools").then((module) => ({ default: module.MenuCatalogTools })));
const MenuStructuredDetails = lazy(() => import("./MenuCatalogTools").then((module) => ({ default: module.MenuStructuredDetails })));
const FinancePage = lazy(() => import("./FinancePage").then((module) => ({ default: module.FinancePage })));
const UsersReportPage = lazy(() => import("./UsersReportPage").then((module) => ({ default: module.UsersReportPage })));

const roleNames: Record<Role, string> = {
  ALUMNO: "Estudiante",
  DOCENTE: "Docente",
  NO_DOCENTE: "No docente",
  INVITADO_ESPECIAL: "Invitado especial",
  ADMINISTRADOR_LOCAL: "Administrador local",
  SUPERVISOR: "Supervisor"
};

type TwoFactorStatus = {
  step: "enroll" | "verify" | null;
  setupSecret?: string;
  otpauthUrl?: string;
  accountLabel?: string;
};

const navItems = [
  { href: "/", label: "Resumen", icon: LayoutDashboard, permission: undefined },
  { href: "/reservas", label: "Reservas", icon: CalendarDays, permission: "reservations:read:own" as const },
  { href: "/eventos-especiales", label: "Eventos Especiales y Noticias", icon: Newspaper, permission: undefined },
  { href: "/menu", label: "Menú semanal", icon: Soup, permission: "menu:read" as const },
  { href: "/cocina", label: "Cocina", icon: Utensils, permission: "kitchen:read" as const },
  { href: "/tickets", label: "Mis tickets", icon: QrCode, permission: "reservations:read:own" as const },
  { href: "/incidentes", label: "Incidentes", icon: CircleHelp, permission: "incidents:create" as const },
  { href: "/operacion", label: "Operación", icon: Activity, permission: "statistics:read" as const },
  { href: "/seguridad", label: "Defensa y Seguridad", icon: ShieldCheck, permission: "audit:read" as const },
  { href: "/auditoria", label: "Auditoría", icon: FileClock, permission: "audit:read" as const },
  { href: "/pagos", label: "Pagos y referencias", icon: CreditCard, permission: undefined },
  { href: "/turnos", label: "Turnos", icon: TicketCheck, permission: "reservations:read:all" as const },
  { href: "/finanzas", label: "Conciliación financiera", icon: CreditCard, permission: "payments:read" as const },
  { href: "/becas", label: "Becas", icon: GraduationCap, permission: undefined },
  { href: "/creditos", label: "Créditos de comida", icon: Gift, permission: undefined },
  { href: "/perfil", label: "Mi perfil", icon: Users, permission: undefined },
  { href: "/accesibilidad", label: "Accesibilidad", icon: Accessibility, permission: undefined },
  { href: "/sesiones", label: "Sesiones activas", icon: MonitorSmartphone, permission: undefined },
  { href: "/usuarios", label: "Usuarios", icon: Users, permission: "users:read" as const },
  { href: "/informes-usuarios", label: "Informes de usuarios", icon: Download, permission: "users:read" as const },
  { href: "/tarifas", label: "Tarifas", icon: CreditCard, permission: "prices:manage" as const },
  { href: "/configuracion", label: "Configuración", icon: Settings, permission: "settings:manage" as const }
];

const accessibilityStorageKey = "comedor-accessibility-preferences";

function readAccessibilityPreferences(): AccessibilityPreferences {
  try {
    const saved = window.localStorage.getItem(accessibilityStorageKey);
    if (!saved) return defaultAccessibilityPreferences;
    const parsed: unknown = JSON.parse(saved);
    const result = accessibilityPreferencesSchema.safeParse(parsed);
    if (!result.success) {
      console.warn("Las preferencias locales de accesibilidad no tienen un formato válido; se usarán los valores predeterminados.");
      return defaultAccessibilityPreferences;
    }
    return result.data;
  } catch (error) {
    console.warn("No se pudieron leer las preferencias locales de accesibilidad.", error);
    return defaultAccessibilityPreferences;
  }
}

function friendlyError(error: { message: string; data?: { code?: string | null } | null } | null | undefined) {
  if (!error) return "";
  if (error.data?.code === "UNAUTHORIZED") return "Tu sesión venció. Iniciá sesión nuevamente.";
  if (error.data?.code === "FORBIDDEN") return "No tenés permiso para realizar esta acción.";
  return error.message.replace(/^.*?: /, "");
}

function Login({
  demoEnabled,
  guestDemoEnabled,
  googleEnabled,
  accessibilityPreferences,
  onAccessibilityChange
}: {
  demoEnabled: boolean;
  guestDemoEnabled: boolean;
  googleEnabled: boolean;
  accessibilityPreferences: AccessibilityPreferences;
  onAccessibilityChange: (preferences: AccessibilityPreferences) => void;
}) {
  const googleLoginUrl = new URL("/auth/google", window.location.origin);
  if (import.meta.env.DEV && ["127.0.0.1", "::1", "[::1]"].includes(window.location.hostname)) {
    googleLoginUrl.hostname = "localhost";
  }
  const [role, setRole] = useState<Role>("ALUMNO");
  const [accountMode, setAccountMode] = useState<"closed" | "login" | "register">(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("account");
    return requestedMode === "register" || requestedMode === "login" ? requestedMode : "closed";
  });
  const [accountForm, setAccountForm] = useState({
    identifier: "", password: "", firstName: "", lastName: "", dni: "", username: "", email: "", phone: "",
    registerRole: "ALUMNO" as "ALUMNO" | "DOCENTE" | "NO_DOCENTE" | "INVITADO_ESPECIAL", confirmPassword: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const authErrorMessage = "No se pudo completar el ingreso con Google. Verificá que uses la cuenta correcta y que esté aprobada por personal autorizado.";
  const [successMessage, setSuccessMessage] = useState(() => {
    const authResult = new URLSearchParams(window.location.search).get("auth");
    if (authResult === "pending") return "Tu cuenta está pendiente de validación institucional. Por eso todavía no se habilita el acceso ni la verificación en dos pasos; un Supervisor debe aprobarla y asignar el rol correspondiente.";
    if (authResult === "error") return authErrorMessage;
    return "";
  });
  const [authStatusChecked, setAuthStatusChecked] = useState(false);
  const [authStatus, setAuthStatus] = useState<TwoFactorStatus | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/auth/2fa/status", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo comprobar el estado de seguridad de la sesión.");
        return response.json() as Promise<TwoFactorStatus>;
      })
      .then((status) => { if (active) setAuthStatus(status); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo comprobar la sesión.");
      })
      .finally(() => { if (active) setAuthStatusChecked(true); });
    return () => { active = false; };
  }, []);

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccessMessage("");
    try {
      const registering = accountMode === "register";
      if (registering && accountForm.password !== accountForm.confirmPassword) {
        throw new Error("Las contraseñas no coinciden.");
      }
      const response = await fetch(registering ? "/auth/register" : "/auth/login", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registering ? {
          firstName: accountForm.firstName, lastName: accountForm.lastName, dni: accountForm.dni,
          username: accountForm.username || undefined, email: accountForm.email, phone: accountForm.phone, role: accountForm.registerRole,
          password: accountForm.password
        } : { identifier: accountForm.identifier, password: accountForm.password })
      });
      const body = await response.json() as { error?: string; approvalRequired?: boolean };
      if (!response.ok) {
        throw new Error(body.error ?? "No se pudo acceder a la cuenta.");
      }
      if (registering) {
        if (!body.approvalRequired) throw new Error("No se recibió confirmación de revisión institucional.");
        setSuccessMessage("Recibimos tu solicitud. Personal autorizado debe validar tu pertenencia institucional antes de habilitar el acceso. Intentá iniciar sesión más tarde.");
        setAccountMode("closed");
        setAccountForm({
          identifier: "", password: "", firstName: "", lastName: "", dni: "", username: "", email: "", phone: "",
          registerRole: "ALUMNO", confirmPassword: ""
        });
        setLoading(false);
        return;
      }
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo conectar con el servidor.");
      setLoading(false);
    }
  }

  async function demoLogin() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/auth/demo", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role })
      });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "No se pudo iniciar el modo demostración.");
      }
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo conectar con el servidor.");
      setLoading(false);
    }
  }

  async function guestDemoLogin() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/auth/demo/guest", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}"
      });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "No se pudo abrir la demo de invitado.");
      }
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo conectar con el servidor.");
      setLoading(false);
    }
  }

  if (!authStatusChecked) return <div className="boot"><span className="spinner" /> Comprobando acceso seguro…</div>;
  if (authStatus?.step) return <TwoFactorGate />;

  return (
    <main className="login-page">
      <a className="skip-link" href="#login-access">Saltar a las opciones de acceso</a>
      <section className="login-card">
        <div className="login-brand">
          <div className="brand-topbar">
            <div className="brand-badge">
              <img className="brand-seal" src={brandAssets.comedorLogo} alt="Comedor Universitario de la Universidad Nacional de Catamarca" width="64" height="64" />
              <div>
                <span className="brand-kicker">UNCA</span>
                <strong>Comedor</strong>
              </div>
            </div>
            <span className="status-chip"><span className="dot" /> En línea</span>
          </div>
          <div className="brand-hero">
            <span className="eyebrow eyebrow-light">Universidad Nacional de Catamarca</span>
            <h1>Comedor Universitario</h1>
            <p>Tu espacio para organizar cada comida, reserva y acceso institucional con una experiencia moderna y segura.</p>
            <img
              className="brand-hero-image"
              src={brandAssets.loginExterior}
              alt="Vista exterior del edificio del Comedor Universitario de la UNCA."
              width="596"
              height="335"
            />
          </div>
          <div className="brand-metrics">
            <div>
              <strong>4.8k</strong>
              <span>servicios</span>
            </div>
            <div>
              <strong>24/7</strong>
              <span>operación</span>
            </div>
            <div>
              <strong>100%</strong>
              <span>institucional</span>
            </div>
          </div>
          <div className="brand-footer">
            <a className="unca-logo-link" href="https://www.unca.edu.ar/" target="_blank" rel="noopener noreferrer" aria-label="Visitar el sitio oficial de la Universidad Nacional de Catamarca (se abre en una pestaña nueva)">
              <img className="unca-wordmark" src={brandAssets.uncaWordmark} alt="Universidad Nacional de Catamarca — UNCA" width="200" height="42" />
            </a>
          </div>
        </div>
        <div className="login-action" id="login-access">
          <span className="eyebrow">ACCESO INSTITUCIONAL</span>
          <h2>Te damos la bienvenida</h2>
          <details className="login-accessibility">
            <summary><Accessibility size={17} /> Opciones de accesibilidad</summary>
            <AccessibilityOptions preferences={accessibilityPreferences} onChange={onAccessibilityChange} />
            <p>Antes de ingresar, estas preferencias se guardan en este dispositivo. Después podés guardarlas en tu perfil.</p>
          </details>
          <p>Ingresá con tu cuenta de Google para consultar el menú y gestionar tus reservas.</p>
          <p className="oauth-note">Las cuentas nuevas requieren validación manual de personal autorizado antes de poder ingresar.</p>
          {googleEnabled
            ? <a className="google-button" href={googleLoginUrl.toString()}><GoogleMark /> Continuar con Google</a>
            : <button className="google-button" disabled><GoogleMark /> Google OAuth no configurado</button>}
          {!googleEnabled && <span className="oauth-note">Configurá las credenciales de Google para habilitar el inicio de sesión.</span>}
          <div className="local-account-access">
            {accountMode === "closed" ? (
              <button className="button button-secondary button-full" onClick={() => setAccountMode("login")}>
                Ingresar con DNI o usuario
              </button>
            ) : (
              <>
                <div className="local-account-heading">
                  <strong>{accountMode === "register" ? "Crear cuenta" : "Acceso con contraseña"}</strong>
                  <button type="button" className="text-button" onClick={() => {
                    setAccountMode(accountMode === "register" ? "login" : "register");
                    setError("");
                    setSuccessMessage("");
                  }}>
                    {accountMode === "register" ? "Ya tengo cuenta" : "Crear cuenta"}
                  </button>
                </div>
                <form className="local-account-form" onSubmit={(event) => void submitAccount(event)}>
                  {accountMode === "register" ? (
                    <>
                      <div className="form-grid">
                        <label>Nombre<input required maxLength={100} autoComplete="given-name" value={accountForm.firstName} onChange={(event) => setAccountForm({ ...accountForm, firstName: event.target.value })} /></label>
                        <label>Apellido<input required maxLength={100} autoComplete="family-name" value={accountForm.lastName} onChange={(event) => setAccountForm({ ...accountForm, lastName: event.target.value })} /></label>
                      </div>
                      <label>DNI<input required inputMode="numeric" pattern="[0-9]{7,10}" autoComplete="off" value={accountForm.dni} onChange={(event) => setAccountForm({ ...accountForm, dni: event.target.value })} /></label>
                      <label>Usuario <span className="muted-inline">(opcional)</span><input minLength={3} maxLength={80} pattern="[A-Za-z0-9_.-]+" autoComplete="username" value={accountForm.username} onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })} /></label>
                      <label>Correo electrónico<input required type="email" maxLength={254} autoComplete="email" value={accountForm.email} onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })} /></label>
                      <label>Teléfono <span className="muted-inline">(opcional)</span><input maxLength={30} autoComplete="tel" value={accountForm.phone} onChange={(event) => setAccountForm({ ...accountForm, phone: event.target.value })} /></label>
                      <label>Tipo de cuenta<select value={accountForm.registerRole} onChange={(event) => setAccountForm({ ...accountForm, registerRole: event.target.value as "ALUMNO" | "DOCENTE" | "NO_DOCENTE" | "INVITADO_ESPECIAL" })}><option value="ALUMNO">Estudiante</option><option value="DOCENTE">Docente</option><option value="NO_DOCENTE">No docente</option><option value="INVITADO_ESPECIAL">Invitado especial</option></select></label>
                    </>
                  ) : (
                    <label>DNI o usuario<input required maxLength={254} autoComplete="username" value={accountForm.identifier} onChange={(event) => setAccountForm({ ...accountForm, identifier: event.target.value })} /></label>
                  )}
                  <label>Contraseña<input required type="password" minLength={accountMode === "register" ? 10 : 1} maxLength={128} autoComplete={accountMode === "register" ? "new-password" : "current-password"} value={accountForm.password} onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} /></label>
                  {accountMode === "register" && <label>Repetir contraseña<input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={accountForm.confirmPassword} onChange={(event) => setAccountForm({ ...accountForm, confirmPassword: event.target.value })} /></label>}
                  <button className="button button-primary button-full" disabled={loading}>{loading ? "Procesando…" : accountMode === "register" ? "Crear cuenta" : "Ingresar"}</button>
                  {error && <p className="form-error" role="alert">{error}</p>}
                </form>
              </>
            )}
          </div>
          <section className="quick-access-card" aria-label="Código QR de acceso al Comedor Universitario">
            <QuickAccessQr />
          </section>
          {successMessage && <div className={`notice-message${successMessage === authErrorMessage ? " notice-error" : ""}`} role={successMessage === authErrorMessage ? "alert" : "status"}>{successMessage}</div>}
          {demoEnabled && (
            <div className="demo-access">
              <div className="demo-caption"><span className="demo-dot" /> Modo de demostración <span>· sin credenciales reales</span></div>
              <label htmlFor="demo-role">Explorar como</label>
              <div className="demo-select">
                <select id="demo-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  {Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
              <button className="button button-secondary button-full" disabled={loading} onClick={() => void demoLogin()}>
                {loading ? "Ingresando…" : "Entrar al entorno demo"}
              </button>
              {error && <p className="form-error">{error}</p>}
            </div>
          )}
          {guestDemoEnabled && (
            <div className="demo-access">
              <div className="demo-caption"><span className="demo-dot" /> Vista de invitado <span>· cuenta ficticia</span></div>
              <button className="button button-secondary button-full" disabled={loading} onClick={() => void guestDemoLogin()}>
                {loading ? "Ingresando…" : "Entrar como invitado"}
              </button>
              {error && <p className="form-error" role="alert">{error}</p>}
            </div>
          )}
          <p className="login-footnote"><ShieldCheck size={15} /> Acceso protegido · tus datos se gestionan de forma segura</p>
        </div>
      </section>
      <div className="login-footer">Universidad Nacional de Catamarca <span>•</span> Catamarca, Argentina</div>
    </main>
  );
}

function QuickAccessQr() {
  const [image, setImage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);

  async function generateQr() {
    setGenerating(true);
    setFailed(false);
    setImage("");
    try {
      let accessUrl = window.location.origin;
      if (import.meta.env.DEV) {
        const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
        const response = await fetch(`/api/access-url?port=${encodeURIComponent(port)}`, { credentials: "include" });
        const result = await response.json() as { url?: string };
        if (!response.ok || !result.url) throw new Error("No se pudo determinar la dirección de red.");
        accessUrl = result.url;
      }
      const qr = await import("qrcode");
      setImage(await qr.default.toDataURL(accessUrl, {
        width: 180,
        margin: 2,
        color: { dark: "#14352d", light: "#ffffff" }
      }));
    } catch {
      setFailed(true);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="quick-access-content">
      {image
        ? <img className="quick-access-qr" src={image} alt="Código QR para abrir el Comedor Universitario" />
        : generating
          ? <span className="spinner" aria-label="Generando código QR de acceso" />
          : failed
            ? <span className="quick-access-error" role="alert">No se pudo generar el código QR. Intentá nuevamente.</span>
            : <span className="quick-access-prompt">Generá un QR para abrir el Comedor Universitario desde otro dispositivo.</span>}
      <button className="button button-secondary" type="button" onClick={() => void generateQr()} disabled={generating}>
        {generating ? "Generando QR…" : image ? "Regenerar QR" : "Generar QR"}
      </button>
    </div>
  );
}

function TwoFactorGate() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/auth/2fa/status", { credentials: "include" })
      .then(async (response) => {
        const result = await response.json() as TwoFactorStatus & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "No se pudo comprobar la verificación.");
        return result;
      })
      .then(async (result) => {
        if (!active) return;
        setStatus(result);
        if (result.otpauthUrl) {
          const { default: QRCode } = await import("qrcode");
          setQrImage(await QRCode.toDataURL(result.otpauthUrl, { width: 180, margin: 1 }));
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar la configuración.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(status?.step === "enroll" ? "/auth/2fa/enroll" : "/auth/2fa/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const result = await response.json() as { error?: string; recoveryCodes?: string[] };
      if (!response.ok) throw new Error(result.error ?? "No se pudo verificar el código.");
      if (result.recoveryCodes) {
        setRecoveryCodes(result.recoveryCodes);
      } else {
        window.location.reload();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo conectar con el servidor.");
      setSubmitting(false);
    }
  }

  async function logout() {
    const response = await fetch("/auth/logout", { method: "POST", credentials: "include" });
    if (!response.ok) {
      setError("No se pudo cerrar la sesión. Intentá nuevamente.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <img className="brand-seal" src={brandAssets.comedorLogo} alt="Comedor Universitario de la Universidad Nacional de Catamarca" width="145" height="119" />
          <span className="brand-kicker">SEGURIDAD DE LA CUENTA</span>
          <h1>Verificación en dos pasos</h1>
          <p>Protección adicional para las cuentas con permisos de administración.</p>
          <a className="unca-logo-link" href="https://www.unca.edu.ar/" target="_blank" rel="noopener noreferrer" aria-label="Visitar el sitio oficial de la Universidad Nacional de Catamarca (se abre en una pestaña nueva)">
            <img className="unca-wordmark" src={brandAssets.uncaWordmark} alt="Universidad Nacional de Catamarca — UNCA" width="190" height="44" />
          </a>
        </div>
        <div className="login-action two-factor-action">
          <span className="eyebrow">ACCESO PRIVILEGIADO</span>
          {recoveryCodes ? (
            <>
              <h2>Guardá tus códigos de recuperación</h2>
              <p>Se muestran una sola vez. Guardalos fuera de este dispositivo; cada código permite un único acceso.</p>
              <div className="recovery-code-list">{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div>
              <button className="button button-primary button-full" onClick={() => window.location.reload()}>Ya los guardé · continuar</button>
            </>
          ) : loading ? (
            <div className="two-factor-loading"><span className="spinner" /> Cargando verificación…</div>
          ) : status?.step === "enroll" ? (
            <>
              <h2>Configurá tu app autenticadora</h2>
              <p>Escaneá el QR con una app compatible (por ejemplo, Google Authenticator o Microsoft Authenticator). Si no podés escanearlo, ingresá la clave manualmente.</p>
              {qrImage && <img className="two-factor-qr" src={qrImage} alt="QR para configurar la app autenticadora" />}
              <label className="field">Clave de configuración<input readOnly value={status.setupSecret ?? ""} /></label>
              <p className="two-factor-account">{status.accountLabel}</p>
              <form className="local-account-form" onSubmit={(event) => void submitCode(event)}>
                <label>Código de verificación<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} /></label>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="button button-primary button-full" disabled={submitting}>{submitting ? "Verificando…" : "Activar y continuar"}</button>
              </form>
            </>
          ) : status?.step === "verify" ? (
            <>
              <h2>Confirmá tu identidad</h2>
              <p>Ingresá el código actual de tu app autenticadora o uno de tus códigos de recuperación.</p>
              <form className="local-account-form" onSubmit={(event) => void submitCode(event)}>
                <label>Código de acceso<input required autoFocus autoComplete="one-time-code" inputMode="text" maxLength={32} value={code} onChange={(event) => setCode(event.target.value)} /></label>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="button button-primary button-full" disabled={submitting}>{submitting ? "Verificando…" : "Verificar y continuar"}</button>
              </form>
            </>
          ) : (
            <>
              <h2>No hay una verificación pendiente</h2>
              <p>{error || "Actualizá la página o volvé a iniciar sesión para continuar."}</p>
              <button className="button button-secondary button-full" onClick={() => window.location.reload()}>Actualizar</button>
            </>
          )}
          {!recoveryCodes && <button className="text-button two-factor-logout" onClick={() => void logout()}>Cerrar sesión</button>}
        </div>
      </section>
      <div className="login-footer">Universidad Nacional de Catamarca <span>•</span> Catamarca, Argentina</div>
    </main>
  );
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" className="google-mark"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.74 7.18l7.27 5.64c4.24-3.91 6.69-9.68 6.69-17.29Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.75-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.79l-7.27-5.64c-2.02 1.36-4.61 2.17-8.64 2.17-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}

function App() {
  const me = trpc.auth.me.useQuery();
  const system = trpc.system.status.useQuery();
  const [accessibilityPreferences, setAccessibilityPreferences] = useState(readAccessibilityPreferences);

  useEffect(() => {
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const highContrastQuery = window.matchMedia("(prefers-contrast: more)");
    const applyPreferences = () => {
      const body = document.body;
      body.dataset.accessibilityText = accessibilityPreferences.textSize;
      body.dataset.highContrast = String(accessibilityPreferences.highContrast || highContrastQuery.matches);
      body.dataset.simplified = String(accessibilityPreferences.simplifiedInterface);
      body.dataset.reduceMotion = String(accessibilityPreferences.reduceMotion || reducedMotionQuery.matches);
      body.dataset.colorDifferentiation = String(accessibilityPreferences.colorDifferentiation);
      body.dataset.keyboardOptimized = String(accessibilityPreferences.keyboardOptimized);
      body.dataset.readingAssistance = String(accessibilityPreferences.readingAssistance);
      body.dataset.largeControls = String(accessibilityPreferences.largerControls);
      try {
        window.localStorage.setItem(accessibilityStorageKey, JSON.stringify(accessibilityPreferences));
      } catch (error) {
        console.warn("No se pudieron guardar las preferencias locales de accesibilidad.", error);
      }
    };
    applyPreferences();
    reducedMotionQuery.addEventListener("change", applyPreferences);
    highContrastQuery.addEventListener("change", applyPreferences);
    return () => {
      reducedMotionQuery.removeEventListener("change", applyPreferences);
      highContrastQuery.removeEventListener("change", applyPreferences);
    };
  }, [accessibilityPreferences]);

  if (me.isLoading) return <div className="boot"><span className="spinner" /> Cargando tu espacio…</div>;
  if (me.error) return <SystemUnavailable error={friendlyError(me.error)} />;
  if (!me.data) return <Login
    demoEnabled={system.data?.demoMode ?? false}
    guestDemoEnabled={system.data?.guestDemoMode ?? false}
    googleEnabled={system.data?.googleLoginAvailable ?? false}
    accessibilityPreferences={accessibilityPreferences}
    onAccessibilityChange={setAccessibilityPreferences}
  />;
  if (["ADMINISTRADOR_LOCAL", "SUPERVISOR"].includes(me.data.role) &&
      (!me.data.twoFactorEnabled || !me.data.twoFactorVerified)) return <TwoFactorGate />;
  return <Shell user={me.data} accessibilityPreferences={accessibilityPreferences} onAccessibilityChange={setAccessibilityPreferences} />;
}

type User = AuthUser;

function Shell({
  user,
  accessibilityPreferences,
  onAccessibilityChange
}: {
  user: User;
  accessibilityPreferences: AccessibilityPreferences;
  onAccessibilityChange: (preferences: AccessibilityPreferences) => void;
}) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const changedBeforePreferencesLoaded = useRef(false);
  const accessibilitySaveQueue = useRef<Promise<void>>(Promise.resolve());
  const [profilePhotoVersion, setProfilePhotoVersion] = useState(0);
  useEffect(() => {
    const refreshPhoto = () => setProfilePhotoVersion(Date.now());
    window.addEventListener("comedor-profile-photo-updated", refreshPhoto);
    return () => window.removeEventListener("comedor-profile-photo-updated", refreshPhoto);
  }, []);
  type ThemeMode = "light" | "dark" | "life";
  const themeOptions: Array<{ id: ThemeMode; label: string; accent: string }> = [
    { id: "light", label: "Claro", accent: "#dfeee7" },
    { id: "dark", label: "Oscuro", accent: "#0d1f2d" },
    { id: "life", label: "Life", accent: "#47a96d" }
  ];
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    const saved = window.localStorage.getItem("comedor-theme");
    return themeOptions.some((option) => option.id === saved) ? (saved as ThemeMode) : "light";
  });
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem("comedor-theme", theme);
  }, [theme]);

  const permissions = trpc.auth.permissions.useQuery();
  const notices = trpc.notifications.mine.useQuery();
  const savedAccessibility = trpc.profile.accessibility.useQuery();
  const updateAccessibility = trpc.profile.updateAccessibility.useMutation();
  useEffect(() => {
    if (savedAccessibility.data?.configured && !changedBeforePreferencesLoaded.current) {
      onAccessibilityChange(savedAccessibility.data.preferences);
    }
  }, [savedAccessibility.data, onAccessibilityChange]);
  function changeAccessibility(preferences: AccessibilityPreferences) {
    changedBeforePreferencesLoaded.current = true;
    onAccessibilityChange(preferences);
    accessibilitySaveQueue.current = accessibilitySaveQueue.current
      .catch(() => undefined)
      .then(async () => { await updateAccessibility.mutateAsync(preferences); })
      .catch((error: unknown) => {
        console.error("No se pudieron guardar las preferencias de accesibilidad.", error);
      });
  }
  const allowed = useMemo(() => new Set(permissions.data ?? []), [permissions.data]);
  const links = navItems.filter((item) => item.href === "/creditos"
      ? canAccessFoodCredits(user.role)
      : (!("role" in item) || item.role === user.role) &&
        (!item.permission ||
          allowed.has(item.permission) ||
          (item.href === "/reservas" && allowed.has("reservations:read:all")) ||
          (item.href === "/becas" && (allowed.has("scholarships:manage") || user.role === "ALUMNO")))
  );
  const pageTitle = location === "/defensa"
    ? "Defensa y Seguridad"
    : navItems.find((item) => item.href === location)?.label ?? "Comedor UNCA";
  const accessibilitySaveError = updateAccessibility.error ? friendlyError(updateAccessibility.error) : "";
  const primarySimplePaths = new Set(["/", "/reservas", "/eventos-especiales", "/tickets", "/menu", "/perfil", "/accesibilidad"]);
  const primaryLinks = accessibilityPreferences.simplifiedInterface
    ? links.filter((item) => primarySimplePaths.has(item.href))
    : links;
  const additionalLinks = accessibilityPreferences.simplifiedInterface
    ? links.filter((item) => !primarySimplePaths.has(item.href))
    : [];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Saltar al contenido principal</a>
      {mobileOpen && <button aria-label="Cerrar menú" className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <Link href="/" className="sidebar-brand" onClick={() => setMobileOpen(false)}>
          <img src={brandAssets.comedorLogo} alt="" width="43" height="43" />
          <span><strong>Comedor Universitario</strong><small>UNCA · Plataforma institucional</small></span>
        </Link>
        <div className="sidebar-label">MENÚ PRINCIPAL</div>
        <nav className="side-nav" aria-label="Navegación principal">
          {primaryLinks.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={location === href ? "page" : undefined} className={`nav-link ${location === href ? "nav-active" : ""}`} onClick={() => setMobileOpen(false)}>
              <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
              {location === href && <span className="nav-indicator" aria-hidden="true" />}
            </Link>
          ))}
          {additionalLinks.length > 0 && <details className="side-nav-more">
            <summary>Más secciones</summary>
            {additionalLinks.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-current={location === href ? "page" : undefined} className={`nav-link ${location === href ? "nav-active" : ""}`} onClick={() => setMobileOpen(false)}>
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
              </Link>
            ))}
          </details>}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-help"><div className="help-icon"><ShieldCheck size={18} /></div><strong>Un espacio seguro</strong><p>Tu información está protegida con acceso institucional.</p></div>
        <button className="profile-button" disabled={logoutPending} onClick={async () => {
          setLogoutPending(true);
          setLogoutError("");
          try {
            const response = await fetch("/auth/logout", { method: "POST", credentials: "include" });
            if (!response.ok) throw new Error("No se pudo cerrar la sesión. Intentá nuevamente.");
            window.location.href = "/";
          } catch (error) {
            setLogoutError(error instanceof Error ? error.message : "No se pudo cerrar la sesión.");
            setLogoutPending(false);
          }
        }}>
          <Avatar firstName={user.firstName} lastName={user.lastName} photoVersion={profilePhotoVersion} />
          <span className="profile-copy"><strong>{user.firstName} {user.lastName}</strong><small>{roleNames[user.role]}</small></span>
          <LogOut size={17} className="logout-icon" />
        </button>
        {logoutError && <span className="logout-error" role="alert">{logoutError}</span>}
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button className="icon-button menu-toggle" aria-label="Abrir menú" onClick={() => setMobileOpen(true)}><MenuIcon size={20} /></button>
          <div className="breadcrumb"><span>Comedor UNCA</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            {user.isDemo && <span className="demo-pill"><span className="demo-dot" /> ENTORNO DEMO</span>}
            <Link href="/accesibilidad" className="icon-button accessibility-shortcut" aria-label="Abrir opciones de accesibilidad" title="Accesibilidad">
              <Accessibility size={19} aria-hidden="true" />
            </Link>
            <div className="theme-picker" role="group" aria-label="Selector de tema visual">
              {themeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`theme-option ${theme === option.id ? "theme-option-active" : ""}`}
                  aria-label={`Activar modo ${option.label}`}
                  aria-pressed={theme === option.id}
                  title={`Modo ${option.label}`}
                  onClick={() => setTheme(option.id)}
                >
                  <span className="theme-swatch" style={{ background: option.accent }} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <Link href="/avisos" className="icon-button notification-button" aria-label="Notificaciones">
              <Bell size={19} />
              {notices.data?.some((notice) => !notice.readAt) && <i />}
            </Link>
            <div className="topbar-avatar"><Avatar firstName={user.firstName} lastName={user.lastName} photoVersion={profilePhotoVersion} /></div>
          </div>
        </header>
        <main className="page-content" id="main-content" tabIndex={-1}>
          <ClockWeather />
          {user.status === "PENDING" && user.role === "INVITADO_ESPECIAL" && <div className="notice-message guest-pending-notice" role="status">Entraste como invitado mientras se valida tu cuenta. Podés consultar la aplicación; un Supervisor o Administrador Local habilitará las reservas cuando apruebe tu rol.</div>}
          <Suspense fallback={<div className="boot" role="status"><span className="spinner" /> Cargando sección…</div>}>
            <Switch>
            <Route path="/"><Dashboard user={user} /></Route>
            <Route path="/reservas"><Reservations user={user} /></Route>
            <Route path="/eventos-especiales"><EventsNews canManage={user.role === "ADMINISTRADOR_LOCAL"} canViewPrivate={["ADMINISTRADOR_LOCAL", "SUPERVISOR"].includes(user.role) && !user.isDemo} demoMode={user.isDemo} /></Route>
            <Route path="/menu"><MenuPage user={user} /></Route>
            <Route path="/cocina">{allowed.has("kitchen:read") ? <KitchenPage /> : <AccessDenied />}</Route>
            <Route path="/tickets"><Tickets user={user} /></Route>
            <Route path="/avisos"><Notifications /></Route>
            <Route path="/incidentes"><Incidents user={user} canManage={allowed.has("incidents:manage")} /></Route>
            <Route path="/operacion">{allowed.has("statistics:read") ? <Operations /> : <AccessDenied />}</Route>
            <Route path="/seguridad">{allowed.has("audit:read") ? <SecurityPage /> : <AccessDenied />}</Route>
            <Route path="/defensa">{allowed.has("audit:read") ? <SecurityPage /> : <AccessDenied />}</Route>
            <Route path="/auditoria">{allowed.has("audit:read") ? <AuditPage /> : <AccessDenied />}</Route>
            <Route path="/pagos"><PaymentsPage canReview={allowed.has("payments:manage")} canViewAll={allowed.has("payments:read")} canReconcile={allowed.has("payments:reconcile")} /></Route>
            <Route path="/turnos">{allowed.has("reservations:read:all") ? <TurnRosterPage canPrint={user.role === "ADMINISTRADOR_LOCAL"} /> : <AccessDenied />}</Route>
            <Route path="/finanzas">{allowed.has("payments:read") ? <FinancePage user={user} canCashManage={allowed.has("payments:cash:manage")} canReconcile={allowed.has("payments:reconcile")} canExport={allowed.has("payments:export")} canAdjust={allowed.has("payments:adjustments:manage")} /> : <AccessDenied />}</Route>
            <Route path="/becas"><ScholarshipsPage user={user} canManage={allowed.has("scholarships:manage")} /></Route>
            <Route path="/creditos">{canAccessFoodCredits(user.role) ? <FoodCreditsPage user={user} canManage={allowed.has("scholarships:manage")} /> : <AccessDenied />}</Route>
            <Route path="/perfil"><ProfilePage user={user} /></Route>
            <Route path="/accesibilidad"><AccessibilityPage preferences={accessibilityPreferences} onChange={changeAccessibility} saveError={accessibilitySaveError} saving={updateAccessibility.isPending} loadError={savedAccessibility.error ? friendlyError(savedAccessibility.error) : ""} /></Route>
            <Route path="/sesiones"><SessionManagement /></Route>
            <Route path="/usuarios">{allowed.has("users:read") || allowed.has("users:create") ? <UsersPage actorRole={user.role} canManage={allowed.has("users:manage")} canCreate={allowed.has("users:create")} /> : <AccessDenied />}</Route>
            <Route path="/informes-usuarios">{allowed.has("users:read") ? <UsersReportPage /> : <AccessDenied />}</Route>
            <Route path="/tarifas">{allowed.has("prices:manage") ? <PricingPage /> : <AccessDenied />}</Route>
            <Route path="/configuracion">{allowed.has("settings:manage") ? <ConfigurationPage /> : <AccessDenied />}</Route>
            <Route><NotFound /></Route>
            </Switch>
          </Suspense>
        </main>
        <footer className="app-footer"><span className="footer-institution"><a className="unca-logo-link footer-unca-link" href="https://www.unca.edu.ar/" target="_blank" rel="noopener noreferrer" aria-label="Visitar el sitio oficial de la Universidad Nacional de Catamarca (se abre en una pestaña nueva)"><img src={brandAssets.uncaWordmark} alt="" width="78" height="40" /></a><span>Universidad Nacional de Catamarca</span></span><span>Sistema del Comedor Universitario <i>·</i> v1.0</span></footer>
      </div>
    </div>
  );
}

function Avatar({ firstName, lastName, photoVersion = 0 }: { firstName: string; lastName: string; photoVersion?: number }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setPhotoUrl(null);
    void fetch(`/api/profile/photo?v=${photoVersion}`, { credentials: "include" })
      .then((response) => response.ok && response.status !== 204 ? response.blob() : null)
      .then((photo) => {
        if (!active || !photo?.size) return;
        objectUrl = URL.createObjectURL(photo);
        setPhotoUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoVersion]);
  return <span className="avatar" aria-label={`${firstName} ${lastName}`}>
    {photoUrl ? <img className="avatar-photo" src={photoUrl} alt="" /> : <>{firstName[0]}{lastName[0]}</>}
  </span>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-intro"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Dashboard({ user }: { user: User }) {
  const reservations = trpc.reservations.mine.useQuery(undefined, { refetchInterval: 30_000 });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const isOperator = user.role === "ADMINISTRADOR_LOCAL" || user.role === "SUPERVISOR";
  const bookingWindows = trpc.reservations.capacity.useQuery({ date: today }, { refetchInterval: 30_000 });
  const todayMenu = trpc.menu.list.useQuery({ from: today, to: today }, { refetchInterval: 60_000 });
  const price = trpc.pricing.mine.useQuery(undefined, { enabled: !isOperator });
  const upcoming = (reservations.data ?? [])
    .filter((item) => String(item.serviceDate).slice(0, 10) >= today && !["CANCELADA", "VENCIDA", "UTILIZADA"].includes(String(item.status)))
    .sort((a, b) => {
      const dateOrder = String(a.serviceDate).localeCompare(String(b.serviceDate));
      return dateOrder || String(a.service).localeCompare(String(b.service));
    });
  const weekStart = startOfLocalWeek(today);
  const nextWeek = new Date(`${weekStart}T12:00:00.000Z`);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const thisWeekCount = (reservations.data ?? []).filter((item) => {
    const itemDate = String(item.serviceDate).slice(0, 10);
    return itemDate >= weekStart && itemDate < nextWeek.toISOString().slice(0, 10) &&
      !["CANCELADA", "VENCIDA", "UTILIZADA"].includes(String(item.status));
  }).length;
  const next = upcoming[0];
  const stats = trpc.administration.summary.useQuery(undefined, { enabled: isOperator });
  const incidents = trpc.incidents.list.useQuery(undefined, { enabled: isOperator });

  return (
    <>
      <PageIntro eyebrow={isOperator ? "CENTRO DE OPERACIONES" : "COMEDOR UNIVERSITARIO"} title={`Buen día, ${user.firstName}`} description={isOperator ? "El comedor, sus servicios y la operación de hoy en un solo lugar." : "Organizá tus comidas en el campus, de forma simple y a tu ritmo."} />
      {user.isDemo && <div className="demo-banner"><span className="demo-banner-icon"><Activity size={18} /></span><div><strong>Estás en el entorno de demostración</strong><p>Los cambios afectan datos de prueba. No se utilizan cuentas ni datos personales reales.</p></div></div>}
      {!isOperator && bookingWindows.data?.filter((item) =>
        item.bookingOpen && item.minutesToClose != null && Number(item.minutesToClose) <= 30
      ).map((item) => <div className="notice-message notice-warning" role="status" key={String(item.service)}>
        <Clock3 size={15} /> Faltan {Number(item.minutesToClose)} minutos para cerrar las reservas de {serviceName(String(item.service))}.
      </div>)}
      {isOperator ? <OperatorDashboard stats={stats.data} loading={stats.isLoading} incidents={incidents.data?.length ?? 0} canManagePhotos={user.role === "ADMINISTRADOR_LOCAL" && !user.isDemo} /> : (
        <>
          <div className="welcome-banner dashboard-hero">
            <div className="welcome-text"><div className="welcome-label"><span /> TU ESPACIO UNIVERSITARIO</div><h2>Una pausa rica también<br className="desktop-only" /> es parte del día.</h2><p>Consultá el menú y reservá con anticipación para disfrutar tu comida en el campus.</p><Link href="/menu" className="welcome-link">Descubrir el menú <ArrowRight size={17} /></Link></div>
            <ComedorPhotoCarousel canManagePhotos={user.role === "ADMINISTRADOR_LOCAL" && !user.isDemo} />
          </div>
          <div className="section-heading"><div><span className="eyebrow">TU ACTIVIDAD</span><h2>Un vistazo a tu semana</h2></div><Link href="/reservas" className="text-link">Ver mis reservas <ArrowRight size={15} /></Link></div>
          {reservations.isLoading ? <LoadingRows /> : reservations.error ? <InlineError error={reservations.error} /> : (
            <div className="overview-grid">
              <div className="overview-card next-meal-card">
                <div className="card-top"><span className="card-icon card-icon-green"><CalendarDays size={19} /></span><span className="card-meta">PRÓXIMA COMIDA</span><span className="card-status"><i /> {next ? String(next.approvalStatus) : "Sin reserva"}</span></div>
                {next ? <><h3>{serviceName(String(next.service))}</h3><p className="card-date">{formatDate(String(next.serviceDate))}</p><Status status={String(next.approvalStatus)} /><DeadlineCountdown deadline={next.presentationDeadline as string | Date | null} /><div className="next-card-bottom"><span><TicketCheck size={16} /> Ticket {formatTicketIdentifier(String(next.serviceDate), next.service as "ALMUERZO" | "CENA", Number(next.ticketNumber ?? 0))}</span><Link href="/tickets" aria-label="Ver ticket"><ArrowRight size={19} /></Link></div></> : <><h3>Tu próxima comida</h3><p className="empty-copy">Todavía no tenés una reserva.</p><Link href="/reservas" className="inline-action">Reservar ahora <ArrowRight size={15} /></Link></>}
              </div>
              <div className="overview-card mini-stat-card"><div className="card-top"><span className="card-icon card-icon-peach"><Utensils size={19} /></span><span className="card-meta">RESERVAS PRÓXIMAS</span></div><strong className="mini-stat-value">{upcoming.length}</strong><span className="mini-stat-caption">En tu historial personal</span><Link href="/reservas" className="mini-card-link">Consultar detalle <ArrowRight size={14} /></Link></div>
              <div className="overview-card mini-stat-card"><div className="card-top"><span className="card-icon card-icon-blue"><Clock3 size={19} /></span><span className="card-meta">CUPO SEMANAL</span></div><strong className="mini-stat-value">{Math.max(0, 5 - thisWeekCount)}<small> / 5</small></strong><span className="mini-stat-caption">Reservas disponibles esta semana</span><div className="progress-track"><span style={{ width: `${Math.min(100, (thisWeekCount / 5) * 100)}%` }} /></div></div>
              <div className="overview-card mini-stat-card"><div className="card-top"><span className="card-icon card-icon-green"><CreditCard size={18} /></span><span className="card-meta">TARIFA VIGENTE</span></div><strong className="mini-stat-value price-value">{price.isLoading ? "…" : price.error || !price.data ? "—" : `${String(price.data.currency)} ${Number(price.data.amount).toFixed(2)}`}</strong><span className="mini-stat-caption">{price.data?.scholarshipType ? String(price.data.scholarshipType).replaceAll("_", " ") : price.error ? "No se pudo consultar" : "Según tu categoría"}</span><Link href="/pagos" className="mini-card-link">Ver pagos y referencias <ArrowRight size={14} /></Link></div>
            </div>
          )}
          <div className="bottom-grid">
            <section className="surface-card today-card"><div className="surface-heading"><div><span className="eyebrow">PARA HOY</span><h3>Comé rico en el campus</h3></div><span className="today-date">{formatDate(today)}</span></div><p className="section-copy">Menú, horarios de reserva y disponibilidad del comedor para hoy.</p>{bookingWindows.isLoading || todayMenu.isLoading ? <LoadingRows /> : bookingWindows.error ? <InlineError error={bookingWindows.error} /> : todayMenu.error ? <InlineError error={todayMenu.error} /> : <div className="meal-shortcuts">{(["ALMUERZO", "CENA"] as const).map((service) => {
              const availability = bookingWindows.data?.find((item) => item.service === service);
              const meal = todayMenu.data?.find((item) => item.service === service);
              const spots = availability ? Math.max(0, Number(availability.capacity) - Number(availability.booked)) : null;
              return <Link href={user.role === "ALUMNO" || user.role === "DOCENTE" || user.role === "NO_DOCENTE" || user.role === "INVITADO_ESPECIAL" ? "/reservas" : "/menu"} className="meal-shortcut" key={service}>
                <span className={`meal-shortcut-icon ${service === "CENA" ? "dinner" : ""}`}>{service === "CENA" ? <Moon size={18} /> : <SunIcon />}</span>
                <span><strong>{serviceName(service)}</strong><small>{meal?.title ? String(meal.title) : "Menú aún no publicado"}</small><small>{availability ? availability.closureReason ? `Servicio cerrado: ${String(availability.closureReason)}` : !availability.businessDay ? "Sin servicio los fines de semana" : `${availability.bookingOpen ? "Reservas abiertas" : "Reservas cerradas"} · ${availability.bookingOpensAt}–${availability.bookingClosesAt} · ${spots} cupos` : "Horario de reserva no disponible"}</small><small>Horario físico: pendiente de confirmación institucional</small></span>
                <ArrowRight size={17} />
              </Link>;
            })}</div>}</section>
            <section className="surface-card steps-card"><span className="eyebrow">RÁPIDO Y FÁCIL</span><h3>Tu comida, en tres pasos</h3><div className="steps-list"><Step number="01" title="Elegí" text="Consultá el menú de la semana." /><Step number="02" title="Reservá" text="Asegurá tu lugar en el comedor." /><Step number="03" title="Disfrutá" text="Mostrá tu QR al llegar." /></div></section>
          </div>
        </>
      )}
    </>
  );
}

function ComedorPhotoCarousel({ canManagePhotos }: { canManagePhotos: boolean }) {
  const [activePhoto, setActivePhoto] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoMessage, setPhotoMessage] = useState("");
  const [photoError, setPhotoError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const touchStartX = useRef<number | null>(null);
  const utils = trpc.useUtils();
  const uploadedPhotos = trpc.carousel.list.useQuery(undefined, { refetchInterval: 30_000 });
  const removePhoto = trpc.carousel.remove.useMutation({
    onSuccess: async () => {
      setPhotoMessage("La foto se quitó del carrusel.");
      await utils.carousel.list.invalidate();
    },
    onError: (error) => setPhotoError(friendlyError(error))
  });
  const photos = [
    ...comedorPhotos.map((photo) => ({ ...photo, uploadedId: null as string | null })),
    ...(uploadedPhotos.data ?? []).map((photo) => ({
      src: `/api/carousel/photos/${photo.id}`,
      alt: `Fotografía del Comedor Universitario: ${photo.caption}`,
      caption: photo.caption,
      width: undefined,
      height: undefined,
      uploadedId: photo.id
    }))
  ];
  const activeComedorPhoto = photos[activePhoto] ?? photos[0]!;
  const listError = uploadedPhotos.error ? friendlyError(uploadedPhotos.error) : "";
  const statusError = photoError || listError;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion || photos.length < 2) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setActivePhoto((current) => (current + 1) % photos.length);
      }
    }, 6000);
    return () => window.clearInterval(interval);
  }, [prefersReducedMotion, photos.length]);

  function showPhoto(index: number) {
    setActivePhoto((index + photos.length) % photos.length);
  }

  function handleCarouselKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPhoto(activePhoto - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      showPhoto(activePhoto + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      showPhoto(0);
    } else if (event.key === "End") {
      event.preventDefault();
      showPhoto(photos.length - 1);
    }
  }

  function finishSwipe(touchX: number) {
    if (touchStartX.current === null) return;
    const distance = touchX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 42) return;
    showPhoto(activePhoto + (distance < 0 ? 1 : -1));
  }

  const visibleSlides = [-2, -1, 0, 1, 2].map((offset) => {
    const index = (activePhoto + offset + photos.length) % photos.length;
    return { offset, index, photo: photos[index]! };
  });
  const paginationSlides = [-1, 0, 1].map((offset) => {
    const index = (activePhoto + offset + photos.length) % photos.length;
    return { offset, index };
  });

  async function uploadPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    if (photos.length + files.length > 20) {
      setPhotoError(`El carrusel admite hasta 20 fotos. Podés agregar ${Math.max(0, 20 - photos.length)} más.`);
      setPhotoMessage("");
      return;
    }
    const invalidFile = files.find((file) =>
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024
    );
    if (invalidFile) {
      setPhotoError("Usá imágenes PNG, JPEG o WebP de hasta 5 MB cada una.");
      setPhotoMessage("");
      return;
    }

    setUploadingPhotos(true);
    setPhotoError("");
    setPhotoMessage("");
    let uploadedCount = 0;
    try {
      for (const file of files) {
        const caption = file.name.replace(/\.[^.]+$/, "").trim().slice(0, 100) || "Foto del comedor";
        const response = await fetch(`/api/carousel/photos?caption=${encodeURIComponent(caption)}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": file.type },
          body: file
        });
        if (!response.ok) {
          const result = await response.json() as { error?: unknown };
          throw new Error(typeof result.error === "string" ? result.error : "No se pudo subir la fotografía.");
        }
        uploadedCount += 1;
      }
      setPhotoMessage(`${uploadedCount} ${uploadedCount === 1 ? "foto agregada" : "fotos agregadas"} al carrusel.`);
      await utils.carousel.list.invalidate();
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "No se pudo subir la fotografía.");
      if (uploadedCount) {
        setPhotoMessage(`${uploadedCount} ${uploadedCount === 1 ? "foto se agregó" : "fotos se agregaron"} antes del error.`);
        await utils.carousel.list.invalidate();
      }
    } finally {
      setUploadingPhotos(false);
    }
  }

  return (
    <section
      className="welcome-art"
      role="region"
      aria-roledescription="carrusel"
      aria-label="Fotografías del Comedor Universitario"
      tabIndex={0}
      onKeyDown={handleCarouselKeyDown}
    >
      <div
        className="carousel-image-stage"
        onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => { const touch = event.changedTouches[0]; if (touch) finishSwipe(touch.clientX); }}
        onTouchCancel={() => { touchStartX.current = null; }}
      >
        <div className="carousel-coverflow" aria-live="off">
          {visibleSlides.map(({ offset, index, photo }) => (
            <button
              key={`${offset}-${photo.src}`}
              type="button"
              className={`carousel-slide carousel-slide-${offset === 0 ? "center" : `offset-${offset}`}`}
              aria-label={`Mostrar fotografía ${index + 1}: ${photo.caption}`}
              aria-current={offset === 0 ? "true" : undefined}
              onClick={() => showPhoto(index)}
            >
              <img
                src={photo.src}
                alt={offset === 0 ? photo.alt : ""}
                width={photo.width}
                height={photo.height}
                loading={offset === 0 ? "eager" : "lazy"}
                decoding="async"
              />
            </button>
          ))}
        </div>
        <div className="carousel-image-label">
          <span>COMEDOR UNIVERSITARIO</span>
          <strong>{String(activePhoto + 1).padStart(2, "0")} <i>/</i> {String(photos.length).padStart(2, "0")}</strong>
        </div>
      </div>
      <div className="carousel-pagination" role="group" aria-label="Elegir foto anterior, actual o siguiente">
        {paginationSlides.map(({ offset, index }) => (
          <button
            key={offset}
            type="button"
            className={`carousel-pagination-dot ${offset === 0 ? "carousel-pagination-dot-active" : ""}`}
            aria-label={`${offset === 0 ? "Foto actual" : offset < 0 ? "Foto anterior" : "Foto siguiente"}: ${index + 1} de ${photos.length}`}
            aria-current={offset === 0 ? "true" : undefined}
            onClick={() => showPhoto(index)}
          />
        ))}
      </div>
      <div className="carousel-information">
        <div className="carousel-copy" aria-live="polite" aria-atomic="true">
          <span className="carousel-copy-kicker">EN FOCO</span>
          <strong>{activeComedorPhoto.caption}</strong>
        </div>
        {canManagePhotos && (
          <div className="carousel-controls" role="group" aria-label="Gestión de fotografías">
            <input ref={photoInput} className="carousel-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void uploadPhotos(event)} />
            <button
              className="carousel-add-photo"
              type="button"
              aria-label={`Agregar fotos (${photos.length} de 20)`}
              title={`Agregar fotos · ${photos.length}/20`}
              disabled={uploadingPhotos || photos.length >= 20}
              onClick={() => photoInput.current?.click()}
            >
              {uploadingPhotos ? <span className="carousel-upload-spinner" /> : <Plus size={17} />}
              <span>Agregar</span>
            </button>
            {activeComedorPhoto.uploadedId && (
              <button
                className="carousel-remove-photo"
                type="button"
                aria-label="Quitar esta foto del carrusel"
                title="Quitar foto"
                disabled={removePhoto.isPending}
                onClick={() => {
                  if (!window.confirm("¿Querés quitar esta foto del carrusel?")) return;
                  setActivePhoto((index) => Math.max(0, index - 1));
                  removePhoto.mutate({ id: activeComedorPhoto.uploadedId! });
                }}
              >
                <Trash2 size={15} /><span>Quitar</span>
              </button>
            )}
          </div>
        )}
      </div>
      {(statusError || photoMessage) && <span className={`carousel-admin-message ${statusError ? "carousel-admin-error" : ""}`} role={statusError ? "alert" : "status"}>{statusError || photoMessage}</span>}
    </section>
  );
}

function OperatorDashboard({ stats, loading, incidents, canManagePhotos }: { stats?: Record<string, unknown>; loading: boolean; incidents: number; canManagePhotos: boolean }) {
  const capacity = (stats?.capacity as Array<{ service: string; capacity: number; booked: number }> | undefined) ?? [];
  return <>
    <div className="operator-hero dashboard-hero">
      <div className="operator-hero-copy">
        <span className="operator-kicker"><Activity size={15} /> ESTADO OPERATIVO · HOY</span>
        <h2>Una operación clara,<br />un comedor en marcha.</h2>
        <p>Seguimiento en tiempo real de reservas, consumos y atención institucional.</p>
        <div className="operator-seal"><img src={brandAssets.comedorLogo} alt="" width="112" height="112" /></div>
      </div>
      <ComedorPhotoCarousel canManagePhotos={canManagePhotos} />
    </div>
    <div className="metric-grid">
      <MetricCard label="Reservas de hoy" value={loading ? "—" : String(stats?.todayReservations ?? 0)} icon={<CalendarDays size={19} />} tone="green" note="Almuerzo y cena" />
      <MetricCard label="Consumos registrados" value={loading ? "—" : String(stats?.todayConsumed ?? 0)} icon={<TicketCheck size={19} />} tone="blue" note="Tickets validados" />
      <MetricCard label="Usuarios activos" value={loading ? "—" : String(stats?.activeUsers ?? 0)} icon={<Activity size={19} />} tone="peach" note="Cuentas habilitadas" />
      <MetricCard label="Incidentes abiertos" value={loading ? "—" : String(incidents)} icon={<CircleHelp size={19} />} tone="violet" note="Requieren seguimiento" />
    </div>
    <div className="bottom-grid operations-bottom">
      <section className="surface-card"><div className="surface-heading"><div><span className="eyebrow">CONTROL DE AFORO</span><h3>Disponibilidad por servicio</h3></div><span className="tiny-live"><i /> HOY</span></div>{loading ? <LoadingRows /> : capacity.map((item) => <div className="capacity-row" key={item.service}><div className="capacity-label"><span>{serviceName(item.service)}</span><strong>{Number(item.booked)} <small>/ {Number(item.capacity)}</small></strong></div><div className="capacity-track"><span style={{ width: `${Math.min(100, Number(item.capacity) ? Number(item.booked) / Number(item.capacity) * 100 : 0)}%` }} /></div></div>)}</section>
      <section className="surface-card"><span className="eyebrow">HERRAMIENTAS OPERATIVAS</span><h3>¿Qué necesitás hacer?</h3><div className="quick-actions"><Link href="/reservas" className="quick-action"><span className="quick-action-icon"><ClipboardList size={18} /></span><span><strong>Gestionar reservas</strong><small>Consultar listado por fecha</small></span><ArrowRight size={16} /></Link><Link href="/menu" className="quick-action"><span className="quick-action-icon"><Soup size={18} /></span><span><strong>Actualizar el menú</strong><small>Publicar las comidas del día</small></span><ArrowRight size={16} /></Link><Link href="/incidentes" className="quick-action"><span className="quick-action-icon"><CircleHelp size={18} /></span><span><strong>Revisar incidentes</strong><small>Seguimiento y resolución</small></span><ArrowRight size={16} /></Link></div></section>
    </div>
  </>;
}

function MetricCard({ label, value, icon, tone, note }: { label: string; value: string; icon: React.ReactNode; tone: string; note: string }) {
  return <div className="metric-card"><div className={`metric-icon metric-${tone}`}>{icon}</div><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-note">{note}</span></div>;
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="step-row"><span>{number}</span><div><strong>{title}</strong><small>{text}</small></div><Check size={16} /></div>;
}

function SunIcon() {
  return <span className="sun-icon">☼</span>;
}

type CreatedReservation = {
  date: string;
  service: string;
  approvalStatus: string;
  paymentStatus: string;
};

type ReservationCreationIssue = { date: string; service: string; message: string };

function Reservations({ user }: { user: User }) {
  const canReviewAll = user.role === "ADMINISTRADOR_LOCAL" || user.role === "SUPERVISOR";
  const isDemoGuest = user.isDemo && user.role === "INVITADO_ESPECIAL";
  const approvalPending = user.status === "PENDING" && user.role === "INVITADO_ESPECIAL";
  const [filterDate, setFilterDate] = useState("");
  const [filterService, setFilterService] = useState<"" | "ALMUERZO" | "CENA">("");
  const [filterSearch, setFilterSearch] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
  const [service, setService] = useState<"ALMUERZO" | "CENA">("ALMUERZO");
  const [selection, setSelection] = useState<Array<{ date: string; service: "ALMUERZO" | "CENA" }>>([]);
  const [message, setMessage] = useState("");
  const [accountPromptOpen, setAccountPromptOpen] = useState(false);
  const [accountPromptError, setAccountPromptError] = useState("");
  const [createdReservations, setCreatedReservations] = useState<CreatedReservation[]>([]);
  const [creationIssues, setCreationIssues] = useState<ReservationCreationIssue[]>([]);
  const list = trpc.reservations.mine.useQuery(undefined, { enabled: !canReviewAll, refetchInterval: 30_000 });
  const operationalList = trpc.reservations.adminList.useQuery(
    { date: filterDate || undefined, service: filterService || undefined, search: filterSearch || undefined, limit: 100 },
    { enabled: canReviewAll, refetchInterval: 30_000 }
  );
  const utils = trpc.useUtils();
  const reviewApproval = trpc.reservations.reviewApproval.useMutation({
    onSuccess: async () => {
      await utils.reservations.adminList.invalidate();
      await utils.reservations.mine.invalidate();
    }
  });
  const add = trpc.reservations.createMany.useMutation({
    onSuccess: async (results) => {
      const ok = results.filter((item) => item.success).length;
      setMessage(`${ok} de ${results.length} reservas registradas.${results.filter((item) => !item.success)[0]?.message ? ` ${results.find((item) => !item.success)?.message}` : ""}`);
      setCreatedReservations(results.flatMap((item) =>
        item.success
          ? [{
              date: item.date,
              service: item.service,
              approvalStatus: item.approvalStatus ?? "PENDIENTE",
              paymentStatus: item.paymentStatus ?? "PENDIENTE"
            }]
          : []
      ));
      setCreationIssues(results.flatMap((item) =>
        !item.success ? [{ date: item.date, service: item.service, message: item.message ?? "No se pudo procesar la reserva." }] : []
      ));
      setSelection([]);
      await utils.reservations.mine.invalidate();
    },
    onError: (error) => setMessage(friendlyError(error))
  });
  const cancel = trpc.reservations.cancel.useMutation({
    onSuccess: () => { setMessage("La reserva fue cancelada."); void utils.reservations.mine.invalidate(); },
    onError: (error) => setMessage(friendlyError(error))
  });
  const waitlist = trpc.reservations.waitlistMine.useQuery(undefined, {
    enabled: !canReviewAll, refetchInterval: 15_000
  });
  const joinWaitlist = trpc.reservations.waitlistJoin.useMutation({
    onSuccess: async (result) => {
      setMessage(`Te anotaste en la lista de espera. Tu lugar es el ${result.position}.`);
      await utils.reservations.waitlistMine.invalidate();
      await utils.reservations.capacity.invalidate();
    },
    onError: (error) => setMessage(friendlyError(error))
  });
  const confirmWaitlist = trpc.reservations.waitlistConfirm.useMutation({
    onSuccess: async () => {
      setMessage("El cupo fue confirmado y tu reserva quedó registrada.");
      await utils.reservations.mine.invalidate();
      await utils.reservations.waitlistMine.invalidate();
      await utils.reservations.capacity.invalidate();
    },
    onError: (error) => setMessage(friendlyError(error))
  });
  const cancelWaitlist = trpc.reservations.waitlistCancel.useMutation({
    onSuccess: async () => {
      setMessage("Saliste de la lista de espera.");
      await utils.reservations.waitlistMine.invalidate();
      await utils.reservations.capacity.invalidate();
    },
    onError: (error) => setMessage(friendlyError(error))
  });

  if (canReviewAll) {
    return <OperationalReservations
      date={filterDate}
      onDateChange={setFilterDate}
      service={filterService}
      onServiceChange={setFilterService}
      search={filterSearch}
      onSearchChange={setFilterSearch}
      list={operationalList.data}
      loading={operationalList.isLoading}
      error={operationalList.error}
      onReview={(id, decision) => void reviewApproval.mutate({ id, decision })}
      reviewing={reviewApproval.isPending}
      reviewError={reviewApproval.error}
    />;
  }
  const capacities = trpc.reservations.capacity.useQuery({ date }, { refetchInterval: 30_000 });
  const selectedCapacity = capacities.data?.find((item) => item.service === service);
  const bookingWindowOpen = Boolean(selectedCapacity?.bookingOpen);
  const hasAvailableCapacity = Number(selectedCapacity?.booked ?? 0) < Number(selectedCapacity?.capacity ?? 0);
  const serviceWindowOpen = bookingWindowOpen && hasAvailableCapacity;
  const selectedWaitlistEntry = waitlist.data?.find((item) =>
    String(item.serviceDate).slice(0, 10) === date && item.service === service &&
    ["WAITING", "OFFERED"].includes(String(item.status))
  );
  const localDateTime = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const localNow = Object.fromEntries(localDateTime.map((part) => [part.type, part.value]));
  const today = `${localNow.year}-${localNow.month}-${localNow.day}`;
  const currentTime = `${localNow.hour}:${localNow.minute}`;

  function addSelection() {
    if (isDemoGuest) return setAccountPromptOpen(true);
    if (approvalPending) return setMessage("Tu cuenta debe ser aprobada antes de poder reservar.");
    if (selection.some((item) => item.date === date && item.service === service)) return setMessage("Ese servicio ya está en tu selección.");
    if (selection.length >= 5) return setMessage("Podés agregar hasta 5 reservas por envío.");
    if (!serviceWindowOpen) return setMessage("La ventana de reservas de ese servicio está cerrada o no quedan cupos.");
    setMessage("");
    setSelection((current) => [...current, { date, service }]);
  }

  async function continueWithAccount(mode: "login" | "register") {
    setAccountPromptError("");
    try {
      const response = await fetch("/auth/logout", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("No se pudo cerrar la sesión de invitado. Intentá nuevamente.");
      window.location.assign(`/?account=${mode}`);
    } catch (cause) {
      setAccountPromptError(cause instanceof Error ? cause.message : "No se pudo abrir el acceso a tu cuenta.");
    }
  }

  return <>
    <PageIntro eyebrow="ORGANIZÁ TU SEMANA" title="Mis reservas" description="Asegurá tu lugar para almorzar o cenar en el comedor universitario." />
    <div className="booking-grid">
      <section className="surface-card booking-card"><div className="surface-heading"><div><span className="eyebrow">NUEVA RESERVA</span><h3>Elegí cuándo querés venir</h3></div><span className="booking-icon"><CalendarDays size={20} /></span></div><p className="section-copy">Cada reserva es individual. Podés planificar hasta cinco comidas por semana.</p>
        <div className="form-grid"><label className="field">Fecha<input type="date" min={new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })} value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="field">Servicio<select value={service} onChange={(event) => setService(event.target.value as "ALMUERZO" | "CENA")}><option value="ALMUERZO">Almuerzo</option><option value="CENA">Cena</option></select></label></div>
        <p className="section-copy">{selectedCapacity ? selectedCapacity.closureReason
          ? `Servicio cerrado: ${String(selectedCapacity.closureReason)}`
          : !selectedCapacity.businessDay
            ? "El comedor atiende de lunes a viernes."
            : !bookingWindowOpen
              ? `Ventana de reserva cerrada · ${selectedCapacity.bookingOpensAt} a ${selectedCapacity.bookingClosesAt}`
              : hasAvailableCapacity
                ? `Ventana de reserva abierta · ${selectedCapacity.bookingOpensAt} a ${selectedCapacity.bookingClosesAt} · ${Math.max(0, Number(selectedCapacity.capacity) - Number(selectedCapacity.booked))} cupos disponibles`
                : `Servicio completo · ${selectedCapacity.bookingOpensAt} a ${selectedCapacity.bookingClosesAt}`
          : "Consultando horarios y cupos desde el servidor…"} · Horario físico de atención: pendiente de confirmación institucional.</p>
        <button className="button button-secondary add-reservation" disabled={approvalPending || !serviceWindowOpen} onClick={addSelection}><Plus size={17} /> Agregar a la selección</button>
        {bookingWindowOpen && !hasAvailableCapacity && (selectedWaitlistEntry
          ? <p className="notice-message" role="status">{selectedWaitlistEntry.status === "OFFERED"
            ? "Tenés un cupo ofrecido. Confirmalo desde tu lista de espera."
            : `Ya estás en la lista de espera, lugar ${selectedWaitlistEntry.position}.`}</p>
          : <button className="button button-secondary add-reservation" disabled={approvalPending || joinWaitlist.isPending}
              onClick={() => isDemoGuest ? setAccountPromptOpen(true) : void joinWaitlist.mutateAsync({ date, service })}>
              {joinWaitlist.isPending ? "Anotándote…" : "Unirme a lista de espera"}
            </button>
        )}
        {selection.length > 0 && <div className="selection-list"><div className="selection-heading">A reservar <span>{selection.length} / 5</span></div>{selection.map((item) => <div className="selection-item" key={`${item.date}-${item.service}`}><span>{formatDate(item.date)} · {serviceName(item.service)}</span><button aria-label="Quitar selección" onClick={() => setSelection((current) => current.filter((row) => row !== item))}><X size={15} /></button></div>)}</div>}
        {message && <div className="notice-message" role="status">{message}</div>}
        <button className="button button-primary button-full" disabled={approvalPending || !selection.length || add.isPending} onClick={() => void add.mutateAsync({ items: selection })}>{add.isPending ? "Procesando…" : `Enviar ${selection.length || ""} ${selection.length === 1 ? "solicitud" : "solicitudes"}`} <ArrowRight size={17} /></button>
      </section>
      <section className="surface-card booking-aside"><span className="eyebrow">INFORMACIÓN IMPORTANTE</span><h3>Antes de reservar</h3><div className="policy-item"><span>01</span><p>El máximo es de <strong>5 reservas por semana</strong>, contando almuerzos y cenas.</p></div><div className="policy-item"><span>02</span><p>Los cupos se confirman al completar la operación. Si un servicio está lleno, te lo indicamos.</p></div><div className="policy-item"><span>03</span><p>Podés cancelar una reserva futura desde el listado de abajo.</p></div><div className="policy-contact"><ShieldCheck size={17} /><span>La reserva y el cupo se verifican en forma segura.</span></div></section>
    </div>
    {(waitlist.isLoading || waitlist.error || waitlist.data?.length) && <section className="surface-card table-card">
      <div className="surface-heading"><div><span className="eyebrow">CUPOS LIBERADOS</span><h3>Mi lista de espera</h3></div><span className="row-count">{waitlist.data?.length ?? 0} {(waitlist.data?.length ?? 0) === 1 ? "lugar activo" : "lugares activos"}</span></div>
      {waitlist.isLoading ? <LoadingRows /> : waitlist.error ? <InlineError error={waitlist.error} /> : <div className="selection-list">
        {waitlist.data?.map((item) => <div className="selection-item waitlist-entry" key={String(item.id)}>
          <span className="waitlist-item-copy"><strong>{formatDate(String(item.serviceDate))} · {serviceName(String(item.service))}</strong>
            {item.status === "OFFERED"
              ? <small>Confirmá antes de {new Intl.DateTimeFormat("es-AR", {
                timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit"
              }).format(new Date(String(item.expiresAt)))} (hora local).</small>
              : <small>Lugar {Number(item.position)} · te avisaremos en la aplicación si se libera un cupo.</small>}
          </span>
          <span className="table-actions waitlist-item-actions">
            {item.status === "OFFERED" && <button className="table-action" disabled={approvalPending || confirmWaitlist.isPending}
              onClick={() => void confirmWaitlist.mutateAsync({ id: String(item.id) })}>Confirmar cupo</button>}
            <button className="table-action danger-action" disabled={approvalPending || cancelWaitlist.isPending}
              onClick={() => { if (window.confirm("¿Querés salir de esta lista de espera?")) void cancelWaitlist.mutateAsync({ id: String(item.id) }); }}>
              Salir
            </button>
          </span>
        </div>)}
      </div>}
    </section>}
    <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">TU HISTORIAL</span><h3>Reservas realizadas</h3></div><span className="row-count">{list.data?.length ?? 0} registros</span></div>{list.isLoading ? <LoadingRows /> : list.error ? <InlineError error={list.error} /> : !list.data?.length ? <EmptyState icon={<CalendarDays size={22} />} title="Todavía no tenés reservas" text="Cuando envíes una solicitud, la vas a encontrar acá." /> : <div className="table-wrap"><table><thead><tr><th>FECHA</th><th>SERVICIO</th><th>TURNO</th><th>IMPORTE</th><th>ESTADO / APROBACIÓN</th><th>ACCIONES</th></tr></thead><tbody>    {list.data.map((item) => {
      const serviceDate = String(item.serviceDate).slice(0, 10);
      const cancelAllowed = isCancellationAllowed(serviceDate, String(item.bookingClosesAt), today, currentTime);
      const canCancelStatus = ["CONFIRMADA", "PENDIENTE"].includes(String(item.status));
      const turnNumber = Number(item.ticketNumber ?? item.queueNumber ?? 0);
      const displayedApproval = item.paymentStatus === "PAGADO" ? "APROBADA" : String(item.approvalStatus);
      return <tr key={String(item.id)}><td><strong>{formatDate(serviceDate)}</strong><small>{new Date(String(item.createdAt)).toLocaleDateString("es-AR")}</small></td><td><span className="meal-type"><span className={item.service === "CENA" ? "dinner-dot" : ""} />{serviceName(String(item.service))}</span></td><td>{turnNumber > 0 ? formatTicketIdentifier(serviceDate, item.service as "ALMUERZO" | "CENA", turnNumber) : "—"}</td><td>{String(item.priceCurrency)} {Number(item.priceAmount).toFixed(2)}</td><td><Status status={String(item.paymentStatus === "PENDIENTE" ? "PAGO_PENDIENTE" : item.status)} /><Status status={displayedApproval} />{canCancelStatus && item.ticketStatus === "DISPONIBLE" && <DeadlineCountdown deadline={item.presentationDeadline as string | Date | null} />}</td><td>{cancelAllowed && canCancelStatus && <button className="table-action" disabled={approvalPending || cancel.isPending} onClick={() => { if (window.confirm(`¿Cancelar tu reserva de ${serviceName(String(item.service)).toLowerCase()} para el ${formatDate(serviceDate)}?`)) void cancel.mutateAsync({ id: String(item.id) }); }}>Cancelar</button>}{!cancelAllowed && canCancelStatus && serviceDate === today && <small>Cancelación hasta {String(item.bookingClosesAt)}</small>}{displayedApproval === "APROBADA" && <a className="table-action" href={googleCalendarEventUrl(serviceDate, String(item.service))} target="_blank" rel="noreferrer">Añadir a Calendar manualmente</a>}</td></tr>;
    })}</tbody></table></div>}</section>
    {createdReservations.length > 0 && <ReservationResultDialog reservations={createdReservations} issues={creationIssues} onClose={() => { setCreatedReservations([]); setCreationIssues([]); }} />}
    {accountPromptOpen && <Modal title="Registrarse o ingresar" onClose={() => setAccountPromptOpen(false)}>
      <div className="modal-form">
        <p className="section-copy">El acceso de invitado permite explorar la aplicación, pero para reservar necesitás una cuenta personal. Las cuentas nuevas requieren validación institucional antes de poder reservar.</p>
        <button className="button button-primary button-full" onClick={() => void continueWithAccount("register")}>Registrarme</button>
        <button className="button button-secondary button-full" onClick={() => void continueWithAccount("login")}>Ingresar con cuenta</button>
        {accountPromptError && <p className="form-error" role="alert">{accountPromptError}</p>}
      </div>
    </Modal>}
  </>;
}

function ReservationResultDialog({
  reservations, issues, onClose
}: {
  reservations: CreatedReservation[];
  issues: ReservationCreationIssue[];
  onClose: () => void;
}) {
  return <Modal title="Solicitud de reserva registrada" onClose={onClose}>
    <div className="reservation-qr-list">
      {reservations.map((reservation) => <article className="reservation-qr-ticket" key={`${reservation.date}-${reservation.service}`}>
        <div className="reservation-qr-details">
          <strong>{serviceName(reservation.service)} · {formatDate(reservation.date)}</strong>
          <small>Aprobación: {reservation.approvalStatus} · Pago: {reservation.paymentStatus}</small>
        </div>
      </article>)}
      <p className="section-copy">Tu número de orden se reserva al enviar la solicitud. El ticket y el código QR estarán disponibles cuando la reserva se apruebe y, si corresponde, el pago esté confirmado. Podrás consultarlos desde “Mis tickets”.</p>
      {issues.length > 0 && <div className="reservation-qr-issues" role="status"><strong>No se completaron {issues.length} reservas</strong>{issues.map((issue) => <span key={`${issue.date}-${issue.service}`}>{formatDate(issue.date)} · {serviceName(issue.service)}: {issue.message}</span>)}</div>}
      <button className="button button-primary button-full" onClick={onClose}>Entendido <ArrowRight size={16} /></button>
    </div>
  </Modal>;
}

function OperationalReservations({
  date, onDateChange, service, onServiceChange, search, onSearchChange,
  list, loading, error, onReview, reviewing, reviewError
}: {
  date: string;
  onDateChange: (value: string) => void;
  service: "" | "ALMUERZO" | "CENA";
  onServiceChange: (value: "" | "ALMUERZO" | "CENA") => void;
  search: string;
  onSearchChange: (value: string) => void;
  list?: Array<Record<string, unknown>>;
  loading: boolean;
  error: { message: string; data?: { code?: string | null } | null } | null;
  onReview: (id: string, decision: "APROBADA" | "RECHAZADA") => void;
  reviewing: boolean;
  reviewError: { message: string; data?: { code?: string | null } | null } | null;
}) {
  return <>
    <PageIntro eyebrow="OPERACIÓN DEL COMEDOR" title="Reservas del servicio" description="Buscá por fecha, servicio, DNI o número de ticket. Las decisiones quedan auditadas." />
    <section className="surface-card form-panel"><div className="form-grid"><label className="field">Fecha<input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} /></label><label className="field">Servicio<select value={service} onChange={(event) => onServiceChange(event.target.value as typeof service)}><option value="">Todos</option><option value="ALMUERZO">Almuerzo</option><option value="CENA">Cena</option></select></label><label className="field">Buscar persona o ticket<input maxLength={100} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="DNI, nombre o ticket" /></label></div></section>
    <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">REGISTRO DE RESERVAS</span><h3>{date ? formatDate(date) : "Últimas reservas"}</h3></div><span className="row-count">Máximo 100 registros · orden numérico por servicio</span></div>{loading ? <LoadingRows /> : error ? <InlineError error={error} /> : !list?.length ? <EmptyState icon={<CalendarDays size={22} />} title="No hay reservas para mostrar" text="No encontramos reservas para los criterios seleccionados." /> : <div className="table-wrap"><table><thead><tr><th>PERSONA</th><th>FECHA</th><th>SERVICIO</th><th>TURNO</th><th>ESTADO</th><th>APROBACIÓN</th></tr></thead><tbody>{list.map((item) => { const turnNumber = item.ticketNumber ?? item.queueNumber; const paid = item.paymentStatus === "PAGADO"; const approvalStatus = paid ? "APROBADA" : String(item.approvalStatus); return <tr key={String(item.id)}><td><strong>{String(item.firstName)} {String(item.lastName)}</strong><small>DNI {String(item.dni ?? "—")} · {String(item.email)}</small></td><td>{formatDate(String(item.serviceDate))}</td><td>{serviceName(String(item.service))}</td><td>{turnNumber ? formatTicketIdentifier(String(item.serviceDate), item.service as "ALMUERZO" | "CENA", Number(turnNumber)) : "—"}</td><td><Status status={String(item.paymentStatus === "PENDIENTE" ? "PAGO_PENDIENTE" : item.status)} /></td><td>{approvalStatus === "PENDIENTE" && !paid ? <div className="table-actions"><button className="table-action" disabled={reviewing} onClick={() => onReview(String(item.id), "APROBADA")}><Check size={14} /> Aprobar</button><button className="table-action danger-action" disabled={reviewing} onClick={() => onReview(String(item.id), "RECHAZADA")}>Rechazar</button></div> : <Status status={approvalStatus} />}</td></tr>; })}</tbody></table></div>}{reviewError && <div className="inline-error">{friendlyError(reviewError)}</div>}</section>
  </>;
}

type TurnRosterPrintReport = {
  date: string;
  service: string;
  turns: Array<{
    id: string;
    turnNumber: number | null;
    serviceDate: string;
    firstName: string;
    lastName: string;
  }>;
};

function TurnRosterPage({ canPrint }: { canPrint: boolean }) {
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
  const [service, setService] = useState<"ALMUERZO" | "CENA">("ALMUERZO");
  const [printReport, setPrintReport] = useState<TurnRosterPrintReport | null>(null);
  const [message, setMessage] = useState("");
  const roster = trpc.reservations.turnRoster.useQuery({ date, service }, { refetchInterval: 30_000 });
  const print = trpc.reservations.printTurnRoster.useMutation({
    onSuccess: (report) => {
      if (!report.turns.length) {
        setPrintReport(null);
        setMessage("No hay reservas vigentes para imprimir en esa fecha y servicio.");
        return;
      }
      setMessage("");
      setPrintReport(report);
    },
    onError: (error) => setMessage(friendlyError(error))
  });
  const turns = roster.data ?? [];
  return <>
    <PageIntro eyebrow="OPERACIÓN DEL COMEDOR" title="Turnos" description="Consultá las reservas ordenadas por turno y prepará la planilla del servicio para cocina." />
    <section className="surface-card form-panel">
      <div className="form-grid">
        <label className="field">Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="field">Servicio<select value={service} onChange={(event) => setService(event.target.value as typeof service)}><option value="ALMUERZO">Almuerzo</option><option value="CENA">Cena</option></select></label>
      </div>
      <p className="section-copy">Se muestran los turnos de reservas con pago confirmado o que no requieren pago, ordenados por fecha y servicio. Cada reserva tiene su propio número de turno para ese día.</p>
      {canPrint && <div className="ticket-print-actions"><button className="button button-secondary" type="button" disabled={!turns.length || print.isPending} onClick={() => { setMessage(""); void print.mutate({ date, service }); }}>{print.isPending ? "Preparando planilla…" : <><Printer size={16} /> Imprimir planilla de turnos</>}</button><span className="section-copy">La planilla contiene únicamente turno, nombre y apellido para entregar en cocina.</span></div>}
      {message && <div className={print.error ? "inline-error" : "notice-message"} role={print.error ? "alert" : "status"}>{message}</div>}
    </section>
    <section className="surface-card table-card">
      <div className="surface-heading"><div><span className="eyebrow">PLANILLA DE RESERVAS</span><h3>{formatDate(date)} · {serviceName(service)}</h3></div><span className="row-count">{roster.data?.length ?? 0} turnos</span></div>
      {roster.isLoading ? <LoadingRows /> : roster.error ? <InlineError error={roster.error} /> : !turns.length ? <EmptyState icon={<TicketCheck size={22} />} title="No hay turnos confirmados para esta fecha" text="Cuando se confirme un pago, el turno aparecerá aquí." /> : <div className="table-wrap turn-roster-table-wrap"><table className="turn-roster-table"><thead><tr><th>TURNO</th><th>NOMBRE</th><th>APELLIDO</th></tr></thead><tbody>{turns.map((item) => <tr key={item.id}><td><strong>{item.turnNumber ?? "—"}</strong></td><td>{item.firstName}</td><td>{item.lastName}</td></tr>)}</tbody></table></div>}
    </section>
    {printReport && <Modal title="Vista previa de la planilla" className="ticket-preview-modal turn-roster-preview-modal" onClose={() => setPrintReport(null)}>
      <div className="ticket-preview-content">
        <section className="ticket-print-sheet turn-roster-print-sheet" aria-label="Planilla de turnos">
          <header><strong>COMEDOR UNIVERSITARIO · UNCA</strong><h1>Planilla de turnos</h1><p>{serviceName(printReport.service)} · {formatDate(printReport.date)}</p></header>
          <table className="turn-roster-table"><thead><tr><th>Turno</th><th>Nombre</th><th>Apellido</th></tr></thead><tbody>{printReport.turns.map((item) => <tr key={item.id}><td>{item.turnNumber ?? "—"}</td><td>{item.firstName}</td><td>{item.lastName}</td></tr>)}</tbody></table>
        </section>
        <div className="ticket-preview-actions">
          <span>{printReport.turns.length} {printReport.turns.length === 1 ? "reserva incluida" : "reservas incluidas"}.</span>
          <button className="button button-secondary" type="button" onClick={() => setPrintReport(null)}>Cerrar</button>
          <button className="button button-primary" type="button" onClick={() => window.print()}><Printer size={16} /> Imprimir planilla</button>
        </div>
      </div>
    </Modal>}
  </>;
}

function MenuPage({ user }: { user: User }) {
  const canManage = user.role === "ADMINISTRADOR_LOCAL";
  const [week, setWeek] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  });
  const [editor, setEditor] = useState<{
    date: string; service: "ALMUERZO" | "CENA"; title: string; description: string; ingredients: string;
    mainDish: string; sideDish: string; salad: string; dessert: string; drink: string; bread: string;
    nutritionalInformation: string; notes: string; published: boolean
  } | null>(null);
  const utils = trpc.useUtils();
  const from = week.toISOString().slice(0, 10);
  const end = new Date(week);
  end.setUTCDate(end.getUTCDate() + 6);
  const to = end.toISOString().slice(0, 10);
  const menu = trpc.menu.list.useQuery({ from, to });
  const save = trpc.menu.save.useMutation({
    onSuccess: async () => { setEditor(null); await utils.menu.list.invalidate(); },
  });
  return <>
    <PageIntro eyebrow="COMÉ BIEN EN EL CAMPUS" title="Menú semanal" description="Consultá las comidas disponibles en el comedor de la universidad." />
    {canManage && <MenuCatalogTools canManage={canManage} defaultDate={from} />}
    <div className="week-toolbar"><div><span className="week-icon"><CalendarDays size={19} /></span><div><strong>{formatDate(from)} – {formatDate(to)}</strong><small>Zona horaria de Catamarca · Argentina</small></div></div><div className="week-controls"><button className="icon-button" aria-label="Semana anterior" onClick={() => setWeek((value) => { const next = new Date(value); next.setUTCDate(next.getUTCDate() - 7); return next; })}><ArrowDownRight className="rotate-left" size={17} /></button><button className="button button-secondary" onClick={() => setWeek(new Date())}>Esta semana</button><button className="icon-button" aria-label="Semana siguiente" onClick={() => setWeek((value) => { const next = new Date(value); next.setUTCDate(next.getUTCDate() + 7); return next; })}><ArrowUpRight className="rotate-right" size={17} /></button></div></div>
    {menu.isLoading ? <div className="menu-grid">{Array.from({ length: 4 }, (_, index) => <div className="surface-card skeleton-menu" key={index} />)}</div> : menu.error ? <InlineError error={menu.error} /> : !menu.data?.length ? <EmptyState icon={<Soup size={24} />} title="El menú todavía no está publicado" text="Volvé a consultar más adelante. El equipo del comedor actualiza las opciones semanalmente." /> : <div className="menu-grid">
      {menu.data.map((item) => <article className={`menu-card ${item.service === "CENA" ? "menu-card-dinner" : ""}`} key={String(item.id)}>
        <div className="menu-card-head"><span className="menu-date">{formatDay(String(item.serviceDate))}</span><span className="menu-service"><span className={item.service === "CENA" ? "dinner-dot" : ""} /> {serviceName(String(item.service))}</span></div>
        <div className="menu-illustration"><div className="menu-illustration-frame"><img src={brandAssets.comedorLogo} alt="" width="42" height="42" /><div><span>COMEDOR UNIVERSITARIO</span><small>UNCA · CATAMARCA</small></div></div></div>
        <div className="menu-card-content">
          <div className="menu-published"><span /> {item.published ? "MENÚ DISPONIBLE" : "BORRADOR · SOLO ADMINISTRACIÓN"}</div>
          <h3>{String(item.title)}</h3>
          {item.description && <p>{String(item.description)}</p>}
          {item.mainDish && <div className="menu-featured-dish"><Soup size={18} /><div><span>PLATO PRINCIPAL</span><strong>{String(item.mainDish)}</strong></div></div>}
          <div className="menu-course-list">{[["GUARNICIÓN", item.sideDish], ["ENSALADA", item.salad], ["POSTRE", item.dessert], ["BEBIDA", item.drink], ["PAN", item.bread], ["INGREDIENTES", item.ingredients], ["INFORMACIÓN NUTRICIONAL", item.nutritionalInformation], ["NOTAS", item.notes]].filter(([, value]) => Boolean(value)).map(([label, value]) => <div className="ingredients" key={String(label)}><span>{String(label)}</span><p>{String(value)}</p></div>)}</div>
          <MenuStructuredDetails items={item.items} />
        </div>
        <div className="menu-card-footer"><span><Utensils size={15} /> Comedor Universitario UNCA</span>{canManage && <button type="button" onClick={() => setEditor({ date: String(item.serviceDate).slice(0, 10), service: item.service as "ALMUERZO" | "CENA", title: String(item.title), description: String(item.description ?? ""), ingredients: String(item.ingredients ?? ""), mainDish: String(item.mainDish ?? ""), sideDish: String(item.sideDish ?? ""), salad: String(item.salad ?? ""), dessert: String(item.dessert ?? ""), drink: String(item.drink ?? ""), bread: String(item.bread ?? ""), nutritionalInformation: String(item.nutritionalInformation ?? ""), notes: String(item.notes ?? ""), published: Boolean(item.published) })}>Editar</button>}</div>
      </article>)}
    </div>}
    {editor && <Modal title="Publicar menú" onClose={() => setEditor(null)}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save.mutateAsync(editor); }}><label className="field">Fecha<input type="date" required value={editor.date} onChange={(event) => setEditor({ ...editor, date: event.target.value })} /></label><label className="field">Servicio<select value={editor.service} onChange={(event) => setEditor({ ...editor, service: event.target.value as "ALMUERZO" | "CENA" })}><option value="ALMUERZO">Almuerzo</option><option value="CENA">Cena</option></select></label><label className="field">Nombre del menú<input required minLength={3} maxLength={180} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label><label className="field">Descripción<textarea rows={3} value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label><label className="field">Plato principal<textarea rows={2} value={editor.mainDish} onChange={(event) => setEditor({ ...editor, mainDish: event.target.value })} /></label><label className="field">Guarnición<textarea rows={2} value={editor.sideDish} onChange={(event) => setEditor({ ...editor, sideDish: event.target.value })} /></label><label className="field">Ensalada<textarea rows={2} value={editor.salad} onChange={(event) => setEditor({ ...editor, salad: event.target.value })} /></label><label className="field">Postre<input maxLength={1000} value={editor.dessert} onChange={(event) => setEditor({ ...editor, dessert: event.target.value })} /></label><label className="field">Bebida<input maxLength={1000} value={editor.drink} onChange={(event) => setEditor({ ...editor, drink: event.target.value })} /></label><label className="field">Pan<input maxLength={500} value={editor.bread} onChange={(event) => setEditor({ ...editor, bread: event.target.value })} /></label><label className="field">Ingredientes<textarea rows={2} value={editor.ingredients} onChange={(event) => setEditor({ ...editor, ingredients: event.target.value })} /></label><label className="field">Información nutricional<textarea rows={2} value={editor.nutritionalInformation} onChange={(event) => setEditor({ ...editor, nutritionalInformation: event.target.value })} /></label><label className="field">Notas para la comunidad<textarea rows={2} value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} /></label><label className="checkbox-field"><input type="checkbox" checked={editor.published} onChange={(event) => setEditor({ ...editor, published: event.target.checked })} /> Publicar para usuarios</label>{save.error && <div className="form-error">{friendlyError(save.error)}</div>}<button className="button button-primary button-full" disabled={save.isPending}>{save.isPending ? "Guardando…" : "Guardar menú"} <ArrowRight size={16} /></button></form></Modal>}
  </>;
}

function Tickets({ user }: { user: User }) {
  const list = trpc.reservations.mine.useQuery(undefined, { refetchInterval: 30_000 });
  const [ticketId, setTicketId] = useState("");
  const [printTicket, setPrintTicket] = useState<{
    date: string;
    service: string;
    number: number;
  } | null>(null);
  const qr = trpc.reservations.ticketQr.useQuery({ ticketId }, { enabled: Boolean(ticketId) });
  const active = list.data?.filter((item) => !["CANCELADA", "VENCIDA", "UTILIZADA"].includes(String(item.status))) ?? [];
  return <>
    <PageIntro eyebrow="PRESENTÁ TU PASE EN EL COMEDOR" title="Mis tickets" description="Mostrá tu código QR en el acceso para validar el consumo de tu reserva." />
    {list.isLoading ? <LoadingRows /> : list.error ? <InlineError error={list.error} /> : active.length === 0 ? <EmptyState icon={<QrCode size={24} />} title="Todavía no tenés tickets" text="Cuando realices una reserva, el turno asignado aparecerá aquí. El ticket imprimible estará disponible después de la aprobación y confirmación del pago." /> : <div className="ticket-grid">{active.map((item) => {
      const enabled = Boolean(item.ticketId) && item.status === "CONFIRMADA" &&
        isTicketEligible(String(item.approvalStatus), String(item.paymentStatus)) && item.ticketStatus === "DISPONIBLE";
      const turnNumber = Number(item.ticketNumber ?? item.queueNumber ?? 0);
      const paidTurnAvailable = item.paymentStatus === "PAGADO" && turnNumber > 0;
      const displayedApproval = paidTurnAvailable ? "APROBADA" : String(item.approvalStatus);
      const ticketIdentifier = turnNumber > 0
        ? formatTicketIdentifier(String(item.serviceDate), item.service as "ALMUERZO" | "CENA", turnNumber)
        : "Turno pendiente";
      const pendingReason = paidTurnAvailable && !enabled
        ? "Pago confirmado · ya podés imprimir tu turno. El QR personal no está disponible para esta reserva."
        : item.approvalStatus !== "APROBADA"
        ? "Turno asignado · pendiente de aprobación institucional."
        : !["PAGADO", "NO_REQUIERE_PAGO"].includes(String(item.paymentStatus))
          ? "Turno asignado · pendiente de confirmación del pago."
          : "La reserva ya está aprobada y pagada; el ticket se está preparando. Actualizá en unos segundos.";
      return <article className="ticket-card" key={String(item.id)}>
        <div className="ticket-brand"><img src={brandAssets.comedorLogo} alt="" width="31" height="31" /><span>COMEDOR UNCA<small>{enabled ? "TICKET DE RETIRO" : "TURNO ASIGNADO"}</small></span><span className="ticket-status"><Status status={String(item.status)} /></span></div>
        <div className="ticket-main">
          <div className="ticket-summary">
            <span className="eyebrow">TITULAR DE LA RESERVA</span>
            <h3>{user.firstName} {user.lastName}</h3>
            <p>{serviceName(String(item.service))} · {formatDate(String(item.serviceDate))}</p>
            <div className="ticket-number">{enabled ? "Ticket" : "Turno asignado"} <strong>{ticketIdentifier}</strong></div>
            <div className="ticket-details">
              <span>Presentación hasta <strong>{String(item.configuredPresentationDeadlineAt ?? "—")}</strong></span>
              <span>Importe <strong>{String(item.priceCurrency)} {Number(item.priceAmount).toFixed(2)}</strong></span>
              <span>Estado <strong>{String(item.status)}</strong></span>
              <span>Aprobación <strong>{String(item.approvalStatus)}</strong></span>
              <span>Pago <strong>{String(item.paymentStatus)}</strong></span>
              {enabled && <span>Identificador <code>{String(item.ticketId)}</code></span>}
            </div>
            <Status status={displayedApproval} />
            <DeadlineCountdown deadline={item.presentationDeadline as string | Date | null} />
          </div>
          <div className="ticket-qr">{enabled && item.ticketId ? <QRCodeBox payload={ticketId === item.ticketId ? qr.data?.payload ?? "" : ""} label={ticketIdentifier} onClick={() => setTicketId(String(item.ticketId))} loading={ticketId === item.ticketId && qr.isLoading} /> : <span className="ticket-pending">{pendingReason}</span>}</div>
        </div>
        <div className="ticket-footer"><span><ShieldCheck size={15} /> {enabled ? "Código personal · uso único" : "Turno asignado a esta reserva"}</span>{enabled && <button type="button" onClick={() => setTicketId(String(item.ticketId))}>Mostrar QR <ArrowRight size={15} /></button>}{(enabled || paidTurnAvailable) && <button type="button" onClick={() => setPrintTicket({ date: String(item.serviceDate), service: String(item.service), number: turnNumber })}><Printer size={15} /> Imprimir turno</button>}{displayedApproval === "APROBADA" && <a className="text-link" href={googleCalendarEventUrl(String(item.serviceDate), String(item.service))} target="_blank" rel="noreferrer">Añadir manualmente a Calendar</a>}</div>
        {ticketId === item.ticketId && qr.data?.payload && <QRDialog payload={qr.data.payload} item={item} onClose={() => setTicketId("")} />}
      </article>;
    })}</div>}
    {printTicket && <Modal title="Vista previa del turno" className="ticket-preview-modal" onClose={() => setPrintTicket(null)}>
      <div className="ticket-preview-content">
        <section className="ticket-print-sheet" aria-label="Ticket personal de retiro">
          <header><strong>COMEDOR UNIVERSITARIO · UNCA</strong><h1>Turno de retiro</h1><p>{serviceName(printTicket.service)} · {formatDate(printTicket.date)}</p></header>
          <div className="ticket-print-grid"><article className="ticket-print-card">
            <span className="ticket-print-label">NÚMERO PARA RETIRAR</span>
            <strong className="ticket-print-number">{printTicket.number}</strong>
            <span className="ticket-print-identifier">{formatTicketIdentifier(printTicket.date, printTicket.service as "ALMUERZO" | "CENA", printTicket.number)}</span>
            <strong className="ticket-print-name">{user.firstName} {user.lastName}</strong>
            <small>{serviceName(printTicket.service)} · {formatDate(printTicket.date)}</small>
            <p>Presentá este turno en cocina. Te llamarán por este número para retirar tu comida.</p>
          </article></div>
        </section>
        <div className="ticket-preview-actions">
          <span>Presentá este turno en cocina; te llamarán por número.</span>
          <button className="button button-secondary" type="button" onClick={() => setPrintTicket(null)}>Cerrar</button>
          <button className="button button-primary" type="button" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>
        </div>
      </div>
    </Modal>}
  </>;
}

function QRCodeBox({ payload, onClick, loading, label }: { payload: string; onClick: () => void; loading: boolean; label: string }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    if (!payload) { setDataUrl(""); return; }
    let active = true;
    void import("qrcode")
      .then((qr) => qr.toDataURL(payload, { width: 180, margin: 1, color: { dark: "#153b32", light: "#ffffff" } }))
      .then((value) => { if (active) setDataUrl(value); });
    return () => { active = false; };
  }, [payload]);
  return <button className="qr-button" type="button" aria-label={`Mostrar QR del ticket ${label}`} onClick={onClick}>{loading ? <span className="spinner" /> : dataUrl ? <img src={dataUrl} alt={`Código QR del ticket ${label}`} /> : <span className="qr-placeholder" aria-hidden="true"><QrCode size={42} /></span>}</button>;
}

function QRDialog({ payload, item, onClose }: { payload: string; item: Record<string, string | number | boolean | Date | null>; onClose: () => void }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then((qr) => qr.toDataURL(payload, { width: 260, margin: 2, color: { dark: "#153b32", light: "#ffffff" } }))
      .then((value) => { if (active) setImage(value); });
    return () => { active = false; };
  }, [payload]);
  return <Modal title="Tu pase al comedor" onClose={onClose}><div className="qr-modal-content">{image ? <img src={image} alt={`Código QR del ticket ${String(item.ticketNumber).padStart(3, "0")}`} /> : <span className="spinner" aria-label="Generando código QR" />}<span className="qr-modal-service">{serviceName(String(item.service))} · {formatDate(String(item.serviceDate))}</span><p>Presentá este código al llegar. Si no podés mostrar el QR, indicá el número de ticket al personal.</p><dl className="qr-accessible-details"><div><dt>Número de ticket</dt><dd>{String(item.ticketNumber).padStart(3, "0")}</dd></div><div><dt>Estado</dt><dd>{String(item.status)}</dd></div><div><dt>Servicio</dt><dd>{serviceName(String(item.service))}</dd></div><div><dt>Fecha</dt><dd>{formatDate(String(item.serviceDate))}</dd></div></dl></div></Modal>;
}

function Notifications() {
  const list = trpc.notifications.mine.useQuery();
  const utils = trpc.useUtils();
  const read = trpc.notifications.markRead.useMutation({ onSuccess: () => { void utils.notifications.mine.invalidate(); } });
  return <>
    <PageIntro eyebrow="ACTUALIZACIONES DEL COMEDOR" title="Notificaciones" description="Información importante sobre tus reservas y la actividad del comedor." />
    <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">TU BANDEJA</span><h3>Mensajes recientes</h3></div><span className="row-count">{list.data?.filter((item) => !item.readAt).length ?? 0} sin leer</span></div>{list.isLoading ? <LoadingRows /> : list.error ? <InlineError error={list.error} /> : !list.data?.length ? <EmptyState icon={<Bell size={22} />} title="No tenés notificaciones" text="Acá vas a encontrar avisos sobre tus reservas y el servicio." /> : <div className="notification-list">{list.data.map((item) => <button className={`notification-item ${item.readAt ? "" : "notification-unread"}`} key={String(item.id)} onClick={() => !item.readAt && void read.mutateAsync({ id: String(item.id) })}><span className="notification-icon"><Bell size={18} /></span><span><strong>{String(item.title)}</strong><small>{String(item.body)}</small><time>{new Date(String(item.createdAt)).toLocaleString("es-AR")}</time></span>{!item.readAt && <i />}</button>)}</div>}</section>
  </>;
}

function Incidents({ user, canManage }: { user: User; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", severity: "MEDIA" as "BAJA" | "MEDIA" | "ALTA" | "CRITICA" });
  const canRead = user.role === "ADMINISTRADOR_LOCAL" || user.role === "SUPERVISOR";
  const list = trpc.incidents.list.useQuery(undefined, { enabled: canRead });
  const utils = trpc.useUtils();
  const create = trpc.incidents.create.useMutation({ onSuccess: async () => { setOpen(false); setForm({ title: "", description: "", severity: "MEDIA" }); await utils.incidents.list.invalidate(); } });
  const update = trpc.incidents.updateStatus.useMutation({ onSuccess: () => void utils.incidents.list.invalidate() });
  return <>
    <PageIntro eyebrow="ATENCIÓN Y SEGUIMIENTO" title="Incidentes" description="Reportá situaciones para que el equipo del comedor pueda darles seguimiento." action={!canRead ? <button className="button button-primary" onClick={() => setOpen(true)}><Plus size={17} /> Nuevo reporte</button> : undefined} />
    {canRead ? <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">REGISTRO OPERATIVO</span><h3>Incidentes recientes</h3></div><span className="row-count">{list.data?.length ?? 0} casos</span></div>{list.isLoading ? <LoadingRows /> : list.error ? <InlineError error={list.error} /> : !list.data?.length ? <EmptyState icon={<CircleHelp size={22} />} title="No hay incidentes registrados" text="Los reportes enviados aparecerán en este listado." /> : <div className="table-wrap"><table><thead><tr><th>INCIDENTE</th><th>REPORTADO POR</th><th>SEVERIDAD</th><th>ESTADO</th><th>ACTUALIZAR</th></tr></thead><tbody>{list.data.map((item) => <tr key={String(item.id)}><td><strong>{String(item.title)}</strong><small>{new Date(String(item.createdAt)).toLocaleDateString("es-AR")}</small></td><td>{String(item.firstName)} {String(item.lastName)}</td><td><Status status={String(item.severity)} /></td><td><Status status={String(item.status)} /></td><td>{canManage && <select className="status-select" value={String(item.status)} onChange={(event) => void update.mutateAsync({ id: String(item.id), status: event.target.value as "ABIERTO" | "EN_INVESTIGACION" | "RESUELTO" | "CERRADO" })}><option value="ABIERTO">Abierto</option><option value="EN_INVESTIGACION">En investigación</option><option value="RESUELTO">Resuelto</option><option value="CERRADO">Cerrado</option></select>}</td></tr>)}</tbody></table></div>}</section> : <section className="surface-card report-card"><div className="report-illustration"><CircleHelp size={32} /></div><div><span className="eyebrow">REPORTE CONFIDENCIAL</span><h3>¿Necesitás contarnos algo?</h3><p>Enviá un reporte al equipo responsable del comedor. La información queda asociada a tu cuenta para facilitar el seguimiento.</p><button className="button button-primary" onClick={() => setOpen(true)}><Plus size={16} /> Crear reporte</button></div></section>}
    {create.error && <div className="inline-error">{friendlyError(create.error)}</div>}
    {open && <Modal title="Nuevo reporte" onClose={() => setOpen(false)}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void create.mutateAsync(form); }}><p className="section-copy">Describí la situación con claridad. El equipo autorizado podrá revisar el reporte.</p><label className="field">Asunto<input minLength={4} maxLength={160} required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="field">Descripción<textarea minLength={10} maxLength={5000} rows={5} required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label className="field">Severidad<select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value as typeof form.severity })}><option value="BAJA">Baja</option><option value="MEDIA">Media</option><option value="ALTA">Alta</option><option value="CRITICA">Crítica</option></select></label>{create.error && <div className="form-error">{friendlyError(create.error)}</div>}<button className="button button-primary button-full" disabled={create.isPending}>{create.isPending ? "Enviando…" : "Enviar reporte"} <ArrowRight size={16} /></button></form></Modal>}
  </>;
}

function TicketCameraScanner({ onScan }: { onScan: (payload: string) => void }) {
  const containerId = `ticket-camera-${useId().replace(/:/g, "")}`;
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const mountedRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (!scanner) return;
      const stop = scanner.isScanning ? scanner.stop() : Promise.resolve();
      void stop.then(() => scanner.clear()).catch(() => {});
    };
  }, []);

  async function stopScanner() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    try {
      if (scanner?.isScanning) await scanner.stop();
      scanner?.clear();
    } catch {
      if (mountedRef.current) setError("No se pudo detener la cámara. Cerrá esta pantalla para liberar el dispositivo.");
    } finally {
      if (mountedRef.current) setScanning(false);
    }
  }

  async function startScanner() {
    setStarting(true);
    setError("");
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("La cámara requiere un contexto seguro. Usá localhost o HTTPS.");
      }
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      if (!mountedRef.current) return;
      scanner = new Html5Qrcode(containerId, {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
      });
      scannerRef.current = scanner;
      let handled = false;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          if (handled) return;
          handled = true;
          onScan(decodedText);
          void stopScanner();
        },
        () => {}
      );
      if (!mountedRef.current) {
        if (scanner.isScanning) await scanner.stop();
        scanner.clear();
        return;
      }
      if (!handled) setScanning(true);
    } catch (cause) {
      if (scannerRef.current === scanner) scannerRef.current = null;
      if (scanner) {
        try {
          if (scanner.isScanning) await scanner.stop();
          scanner.clear();
        } catch {
          // Keep the original camera error visible.
        }
      }
      if (mountedRef.current) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(/NotAllowed|Permission denied/i.test(message)
          ? "Permití el acceso a la cámara en el navegador e intentá nuevamente."
          : /NotFound|no camera/i.test(message)
            ? "No se encontró una cámara disponible en este dispositivo."
            : /NotReadable|Could not start/i.test(message)
              ? "La cámara está ocupada por otra aplicación. Cerrala e intentá nuevamente."
              : "No se pudo iniciar la cámara. Podés ingresar el código manualmente.");
      }
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }

  return <div className="ticket-camera">
    <div id={containerId} className="ticket-camera-view" aria-label="Vista del escáner QR" />
    <div className="ticket-camera-controls">
      {!scanning
        ? <button type="button" className="button button-secondary" onClick={() => void startScanner()} disabled={starting}>
          <Camera size={16} /> {starting ? "Iniciando cámara…" : "Escanear con cámara"}
        </button>
        : <button type="button" className="button button-secondary" onClick={() => void stopScanner()}>
          <CameraOff size={16} /> Detener cámara
        </button>}
      {scanning && <span className="camera-status" role="status">Cámara activa · enfocá el código QR</span>}
    </div>
    {error && <p className="camera-error" role="alert">{error}</p>}
  </div>;
}

type KitchenService = {
  service: "ALMUERZO" | "CENA";
  menuTitle: string | null;
  plannedPortions: number;
  consumedPortions: number;
  producedPortions: number;
  notes: string;
  updatedAt: Date | string | null;
};

function KitchenPage() {
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
  const board = trpc.kitchen.board.useQuery({ date });
  return <>
    <PageIntro eyebrow="PLANIFICACIÓN DE SERVICIO" title="Operación de cocina" description="Compará raciones previstas y consumo registrado; guardá la producción y las observaciones de cada servicio." />
    <section className="surface-card form-panel">
      <label className="field operational-filter">Fecha de servicio<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <p className="section-copy">La previsión cuenta reservas aprobadas y confirmadas. El consumo refleja tickets validados en el sistema; los datos son operativos y no sustituyen el conteo físico.</p>
    </section>
    {board.isLoading ? <LoadingRows /> : board.error ? <InlineError error={board.error} /> : <div className="kitchen-grid">
      {(board.data ?? []).map((service) => <KitchenServiceCard key={service.service} date={date} service={service as KitchenService} />)}
    </div>}
  </>;
}

function KitchenServiceCard({ date, service }: { date: string; service: KitchenService }) {
  const utils = trpc.useUtils();
  const [producedPortions, setProducedPortions] = useState(String(service.producedPortions));
  const [notes, setNotes] = useState(service.notes);
  useEffect(() => {
    setProducedPortions(String(service.producedPortions));
    setNotes(service.notes);
  }, [date, service.producedPortions, service.notes]);
  const save = trpc.kitchen.recordProduction.useMutation({
    onSuccess: () => void utils.kitchen.board.invalidate({ date })
  });
  const variance = Number(producedPortions || 0) - service.plannedPortions;
  const remaining = Number(producedPortions || 0) - service.consumedPortions;
  return <section className="surface-card form-panel kitchen-service">
    <div className="surface-heading"><div><span className="eyebrow">{serviceName(service.service).toUpperCase()}</span><h3>{service.menuTitle ?? "Menú no publicado"}</h3></div></div>
    <div className="kitchen-metrics">
      <div><small>Raciones previstas</small><strong>{service.plannedPortions}</strong></div>
      <div><small>Producción registrada</small><strong>{service.producedPortions}</strong></div>
      <div><small>Consumo real en sistema</small><strong>{service.consumedPortions}</strong></div>
      <div><small>Diferencia vs. previsión</small><strong>{variance < 0 ? `Faltan ${Math.abs(variance)}` : variance > 0 ? `Sobran ${variance}` : "En equilibrio"}</strong></div>
      <div><small>Producción no consumida</small><strong>{Math.max(0, remaining)}</strong></div>
    </div>
    <form className="admin-form" onSubmit={(event) => {
      event.preventDefault();
      void save.mutateAsync({
        date, service: service.service, producedPortions: Number(producedPortions),
        notes: notes.trim() || undefined
      });
    }}>
      <label className="field">Raciones producidas<input type="number" min="0" max="100000" step="1" required value={producedPortions} onChange={(event) => setProducedPortions(event.target.value)} /></label>
      <label className="field">Observaciones o incidencias<textarea rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Faltantes, sobrantes u observaciones del servicio" /></label>
      {save.error && <div className="form-error" role="alert">{friendlyError(save.error)}</div>}
      <button className="button button-primary" disabled={save.isPending}>{save.isPending ? "Guardando…" : "Guardar producción"}</button>
    </form>
    {service.updatedAt && <p className="section-copy">Último registro: {new Date(service.updatedAt).toLocaleString("es-AR")}</p>}
  </section>;
}

function Operations() {
  const stats = trpc.administration.summary.useQuery();
  const scans = trpc.administration.ticketScans.useQuery();
  const [period, setPeriod] = useState<"DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY">("DAILY");
  const [reportDate, setReportDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
  const report = trpc.administration.report.useQuery({ period, date: reportDate });
  const [payload, setPayload] = useState("");
  const [feedback, setFeedback] = useState("");
  const validate = trpc.reservations.validateTicket.useMutation({
    onSuccess: (result) => setFeedback(`Consumo validado · ${serviceName(result.service)} · ${formatDate(result.serviceDate)}`),
    onError: (error) => setFeedback(friendlyError(error))
  });
  const capacities = (stats.data?.capacity as Array<{ service: string; capacity: number; booked: number }> | undefined) ?? [];
  return <>
    <PageIntro eyebrow="GESTIÓN DEL COMEDOR" title="Operación del día" description="Monitoreá aforo, actividad y validación de tickets con información del sistema." />
    <button className="button button-secondary" type="button" disabled={!report.data} onClick={() => {
      if (!report.data) return;
      downloadCsv(`comedor-reporte-${report.data.from}-${report.data.to}.csv`, [
        ["Servicio", "Reservas", "Consumos", "Canceladas", "Rechazadas", "No asistencias", "Importe reservado ARS"],
        ...report.data.services.map((row) => [
          serviceName(String(row.service)), Number(row.reservations), Number(row.consumed),
          Number(row.cancelled), Number(row.rejected), Number(row.noShows), Number(row.reservedAmount)
        ])
      ]);
    }}><Download size={16} /> Exportar informe CSV</button>
    <p className="section-copy">No asistencias registradas hoy: {String(stats.data?.todayNoShows ?? "—")}. El registro es estadístico y no aplica sanciones automáticas.</p>
    <div className="metric-grid"><MetricCard label="Reservas de hoy" value={String(stats.data?.todayReservations ?? "—")} icon={<CalendarDays size={19} />} tone="green" note="Confirmadas para hoy" /><MetricCard label="Tickets utilizados" value={String(stats.data?.todayConsumed ?? "—")} icon={<TicketCheck size={19} />} tone="blue" note="Consumos registrados" /><MetricCard label="Usuarios habilitados" value={String(stats.data?.activeUsers ?? "—")} icon={<Activity size={19} />} tone="peach" note="Cuentas activas" /><MetricCard label="Incidentes abiertos" value={String(stats.data?.openIncidents ?? "—")} icon={<CircleHelp size={19} />} tone="violet" note="En seguimiento" /></div>
    <section className="surface-card form-panel"><div className="surface-heading"><div><span className="eyebrow">INFORME BASADO EN MYSQL</span><h3>Actividad por período</h3></div></div><div className="form-grid"><label className="field">Período<select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="DAILY">Diario</option><option value="WEEKLY">Semanal</option><option value="MONTHLY">Mensual</option><option value="YEARLY">Anual</option></select></label><label className="field">Fecha de referencia<input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} /></label></div>{report.isLoading ? <LoadingRows /> : report.error ? <InlineError error={report.error} /> : <><p className="section-copy">Período {String(report.data?.from)} — hasta {String(report.data?.to)} (exclusivo). Los pagos reflejan únicamente referencias aprobadas. No hay datos de costos operativos para calcular inversión, subsidios o ganancias.</p><p className="section-copy">No asistencias registradas en el período: {Number(report.data?.totals.noShows ?? 0)}. Este dato es estadístico y no implica sanciones.</p><div className="table-wrap"><table><thead><tr><th>SERVICIO</th><th>RESERVAS</th><th>CONSUMOS</th><th>CANCELADAS</th><th>RECHAZADAS</th><th>IMPORTE RESERVADO</th></tr></thead><tbody>{(report.data?.services ?? []).map((row) => <tr key={String(row.service)}><td>{serviceName(String(row.service))}</td><td>{Number(row.reservations)}</td><td>{Number(row.consumed)}</td><td>{Number(row.cancelled)}</td><td>{Number(row.rejected)}</td><td>ARS {Number(row.reservedAmount).toFixed(2)}</td></tr>)}</tbody><tfoot><tr><th>Total</th><th>{Number(report.data?.totals.reservations ?? 0)}</th><th>{Number(report.data?.totals.consumed ?? 0)}</th><th>{Number(report.data?.totals.cancelled ?? 0)}</th><th>{Number(report.data?.totals.rejected ?? 0)}</th><th>ARS {Number(report.data?.totals.reservedAmount ?? 0).toFixed(2)}</th></tr></tfoot></table></div><div className="capacity-breakdown" aria-label="Proporción de consumos registrados sobre reservas"><h4>Consumo registrado</h4>{(report.data?.services ?? []).map((row) => <div className="capacity-row" key={String(row.service)}><div className="capacity-label"><span>{serviceName(String(row.service))}</span><strong>{Number(row.consumed)} / {Number(row.reservations)}</strong></div><div className="capacity-track"><span style={{ width: `${Number(row.reservations) ? Math.min(100, Number(row.consumed) / Number(row.reservations) * 100) : 0}%` }} /></div></div>)}</div><p className="section-copy">Referencias de pago aprobadas en el período: ARS {Number(report.data?.verifiedPayments ?? 0).toFixed(2)}</p></>}</section>
    <div className="bottom-grid operations-bottom"><section className="surface-card"><div className="surface-heading"><div><span className="eyebrow">AFORO DE HOY</span><h3>Cupos por servicio</h3></div></div>{stats.isLoading ? <LoadingRows /> : stats.error ? <InlineError error={stats.error} /> : capacities.map((item) => <div className="capacity-row" key={item.service}><div className="capacity-label"><span>{serviceName(item.service)}</span><strong>{item.booked} <small>/ {item.capacity}</small></strong><small>{Math.max(0, item.capacity - item.booked)} disponibles · {item.capacity > 0 ? Math.round(item.booked / item.capacity * 100) : 0}% ocupado</small></div><div className="capacity-track"><span style={{ width: `${item.capacity > 0 ? Math.min(100, item.booked / item.capacity * 100) : 0}%` }} /></div></div>)}</section><section className="surface-card scanner-card"><span className="eyebrow">VALIDACIÓN ANTI-REPLAY</span><h3>Validar ticket</h3><p>Escaneá el QR con la cámara, usá un lector conectado o ingresá el contenido manualmente. Cada ticket puede utilizarse una sola vez.</p><TicketCameraScanner onScan={(scannedPayload) => { setPayload(scannedPayload); setFeedback(""); validate.mutate({ payload: scannedPayload }); }} /><form onSubmit={(event) => { event.preventDefault(); setFeedback(""); void validate.mutateAsync({ payload }); }}><label className="field">Código del ticket<input autoComplete="off" placeholder="unca:identificador:firma…" value={payload} onChange={(event) => setPayload(event.target.value)} required /></label><button className="button button-primary button-full" disabled={validate.isPending}>{validate.isPending ? "Verificando…" : "Verificar y registrar consumo"} <QrCode size={17} /></button></form>{feedback && <div className={`notice-message ${validate.isError ? "notice-error" : "notice-success"}`} role="status">{feedback}</div>}</section></div>
    <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">TRAZABILIDAD DE TICKETS</span><h3>Últimos escaneos</h3></div><span className="row-count">{scans.data?.length ?? 0} registros</span></div>{scans.isLoading ? <LoadingRows /> : scans.error ? <InlineError error={scans.error} /> : !scans.data?.length ? <EmptyState icon={<QrCode size={22} />} title="Sin escaneos registrados" text="Los intentos de validación aparecerán aquí." /> : <div className="table-wrap"><table><thead><tr><th>FECHA</th><th>OPERADOR</th><th>TICKET</th><th>RESULTADO</th></tr></thead><tbody>{scans.data.map((scan) => <tr key={String(scan.id)}><td>{new Date(String(scan.scannedAt)).toLocaleString("es-AR")}</td><td>{String(scan.firstName)} {String(scan.lastName)}</td><td>{scan.ticketId ? String(scan.ticketId).slice(0, 8) : "—"}</td><td><Status status={String(scan.result)} /></td></tr>)}</tbody></table></div>}</section>
  </>;
}

function SecurityPage() {
  const overview = trpc.system.securityOverview.useQuery();
  const events = trpc.system.securityEvents.useQuery();
  const status = trpc.system.status.useQuery();
  const action = trpc.system.securityAction.useMutation();
  const [actionMessage, setActionMessage] = useState("");
  const featureFlags = Object.entries(status.data?.featureFlags ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const riskLabels: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
  const riskTone = overview.data?.riskLevel === "CRITICAL" ? "danger" : overview.data?.riskLevel === "HIGH" ? "warning" : overview.data?.riskLevel === "MEDIUM" ? "warning" : "success";

  function requestAction(actionType: "REQUEST_REAUTH" | "CREATE_INCIDENT" | "REQUEST_REVIEW") {
    const reason = actionType === "REQUEST_REAUTH"
      ? "Se solicita reautenticación por riesgo operativo y validación reforzada del centro de seguridad."
      : actionType === "CREATE_INCIDENT"
        ? "Se registra un incidente de seguridad desde el centro de supervisión institucional."
        : "Se solicita revisión humana de la actividad sospechosa detectada por el sistema.";
    action.mutate({
      action: actionType,
      reason,
      severity: overview.data?.riskLevel === "CRITICAL" ? "CRITICA" : overview.data?.riskLevel === "HIGH" ? "ALTA" : "MEDIA",
    }, {
      onSuccess: (result) => setActionMessage(result.message),
      onError: (error) => setActionMessage(friendlyError(error))
    });
  }

  return <>
    <PageIntro
      eyebrow="SUPERVISIÓN DE SEGURIDAD"
      title="Defensa y Seguridad"
      description="Monitoreá el riesgo operativo del comedor, los accesos fallidos y el estado actual de los controles de seguridad."
    />
    {overview.isLoading ? <LoadingRows /> : overview.error ? <InlineError error={overview.error} /> : overview.data ? <>
      <div className="metric-grid">
        <MetricCard label="Riesgo operativo" value={`${overview.data.riskScore}/100`} icon={<ShieldCheck size={19} />} tone="blue" note={`Nivel ${riskLabels[overview.data.riskLevel] ?? overview.data.riskLevel}`} />
        <MetricCard label="Eventos auditoría" value={String(overview.data.metrics.recentAuditEvents)} icon={<FileClock size={19} />} tone="violet" note="Últimas 24 horas" />
        <MetricCard label="Fallidos de acceso" value={String(overview.data.metrics.failedLogins)} icon={<ShieldCheck size={19} />} tone="peach" note="Logins rechazados" />
        <MetricCard label="Sesiones activas" value={String(overview.data.metrics.activeSessions)} icon={<MonitorSmartphone size={19} />} tone="green" note="Conectadas al sistema" />
      </div>
      <section className="surface-card form-panel">
        <div className="surface-heading">
          <div><span className="eyebrow">ESTADO GENERAL</span><h3>Evaluación del sistema</h3></div>
          <span className={`status-chip status-${riskTone}`}><i />{riskLabels[overview.data.riskLevel] ?? overview.data.riskLevel}</span>
        </div>
        <p className="section-copy">La puntuación se calcula con eventos de auditoría, accesos fallidos, sesiones revocadas y actividad reciente del sistema. La ventana de observación es de 24 horas.</p>
        <div className="notice-message notice-warning">
          <ShieldCheck size={16} /> {overview.data.recommendation}
        </div>
        <p className="section-copy">Última actualización: {new Date(overview.data.generatedAt).toLocaleString("es-AR")}</p>
      </section>
      <section className="surface-card form-panel">
        <div className="surface-heading">
          <div><span className="eyebrow">ACCIONES DE SUPERVISIÓN</span><h3>Respuestas controladas</h3></div>
        </div>
        <div className="form-grid">
          <button className="button button-secondary" type="button" disabled={action.isPending} onClick={() => requestAction("REQUEST_REAUTH")}>Solicitar reautenticación</button>
          <button className="button button-secondary" type="button" disabled={action.isPending} onClick={() => requestAction("REQUEST_REVIEW")}>Solicitar revisión humana</button>
          <button className="button button-primary" type="button" disabled={action.isPending} onClick={() => requestAction("CREATE_INCIDENT")}>Crear incidente</button>
        </div>
        {actionMessage && <div className="notice-message" role="status">{actionMessage}</div>}
      </section>
      <section className="surface-card table-card">
        <div className="surface-heading">
          <div><span className="eyebrow">ACTIVIDAD RECIENTE</span><h3>Eventos de seguridad</h3></div>
        </div>
        {events.isLoading ? <LoadingRows /> : events.error ? <InlineError error={events.error} /> : !events.data?.length ? <EmptyState icon={<ShieldCheck size={22} />} title="Sin señales recientes" text="No se registraron eventos de seguridad en la última ventana." /> : <div className="table-wrap"><table><thead><tr><th>FECHA</th><th>TOPIC</th><th>EVENTO</th><th>ACTOR</th><th>ORIGEN</th></tr></thead><tbody>{events.data.map((entry) => <tr key={String(entry.id)}><td>{new Date(String(entry.occurredAt)).toLocaleString("es-AR")}</td><td><Status status={String(entry.topic)} /></td><td><strong>{String(entry.title)}</strong><small>{String(entry.description)}</small></td><td>{String(entry.actor)}</td><td><code>{String(entry.source)}</code></td></tr>)}</tbody></table></div>}
      </section>
      <section className="surface-card table-card">
        <div className="surface-heading">
          <div><span className="eyebrow">CONTROL DE FUNCIONALIDAD</span><h3>Banderas activas</h3></div>
          <span className="row-count">{featureFlags.length} configuraciones</span>
        </div>
        {!featureFlags.length ? <EmptyState icon={<ShieldCheck size={22} />} title="Sin banderas registradas" text="El listado de controles no devuelve datos para la instancia actual." /> : <div className="table-wrap"><table><thead><tr><th>BANDERA</th><th>ESTADO</th></tr></thead><tbody>{featureFlags.map(([flag, enabled]) => <tr key={flag}><td><code>{flag}</code></td><td><span className={`status-chip ${enabled ? "status-success" : "status-muted"}`}><i />{enabled ? "Activada" : "Desactivada"}</span></td></tr>)}</tbody></table></div>}
      </section>
      <section className="surface-card table-card">
        <div className="surface-heading">
          <div><span className="eyebrow">SEÑALES OPERATIVAS</span><h3>Indicadores clave</h3></div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>SEÑAL</th><th>VALOR</th></tr></thead><tbody>
          <tr><td>Sesiones revocadas</td><td>{overview.data.metrics.revokedSessions}</td></tr>
          <tr><td>Estado del sistema</td><td>{overview.data.status}</td></tr>
          <tr><td>Ventana de análisis</td><td>{overview.data.windowHours} horas</td></tr>
        </tbody></table></div>
      </section>
    </> : null}
  </>;
}

function AuditPage() {
  const [filters, setFilters] = useState({ from: "", to: "", user: "", role: "", module: "", action: "", resourceId: "" });
  const log = trpc.administration.audit.useQuery({
    from: filters.from || undefined, to: filters.to || undefined, user: filters.user || undefined,
    role: (filters.role || undefined) as Role | undefined,
    module: filters.module || undefined, action: filters.action || undefined, resourceId: filters.resourceId || undefined
  });
  return <>
    <PageIntro eyebrow="TRAZABILIDAD INSTITUCIONAL" title="Registro de auditoría" description="Consultá acciones registradas, actor, rol, resultado y metadatos disponibles." />
    <section className="surface-card form-panel"><div className="form-grid"><label className="field">Desde<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label><label className="field">Hasta<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label><label className="field">Usuario<input maxLength={100} value={filters.user} onChange={(event) => setFilters({ ...filters, user: event.target.value })} placeholder="Correo o nombre" /></label><label className="field">Rol<select value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}><option value="">Todos</option>{Object.entries(roleNames).map(([role, name]) => <option key={role} value={role}>{name}</option>)}</select></label><label className="field">Módulo<input maxLength={80} value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })} placeholder="reservation, user…" /></label><label className="field">Acción<input maxLength={100} value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} /></label><label className="field">Registro<input maxLength={36} value={filters.resourceId} onChange={(event) => setFilters({ ...filters, resourceId: event.target.value })} /></label></div></section>
    <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">ACTIVIDAD REGISTRADA</span><h3>Eventos del sistema</h3></div><span className="row-count">Máximo 200</span></div>{log.isLoading ? <LoadingRows /> : log.error ? <InlineError error={log.error} /> : !log.data?.length ? <EmptyState icon={<FileClock size={22} />} title="Sin eventos para mostrar" text="No encontramos registros para esos filtros." /> : <div className="table-wrap"><table><thead><tr><th>FECHA Y HORA</th><th>ACTOR / ROL</th><th>ACCIÓN</th><th>MÓDULO / REGISTRO</th><th>DETALLE</th><th>RESULTADO</th></tr></thead><tbody>{log.data.map((item) => <tr key={String(item.id)}><td>{new Date(String(item.createdAt)).toLocaleString("es-AR")}</td><td>{String(item.email ?? "Sistema")}<small>{String(item.actorRole ?? "Rol histórico no disponible")}</small></td><td><code>{String(item.action)}</code></td><td>{String(item.resourceType)}{item.resourceId ? ` · ${String(item.resourceId)}` : ""}</td><td><code>{item.metadata ? JSON.stringify(item.metadata) : "—"}</code></td><td><Status status={String(item.outcome)} /></td></tr>)}</tbody></table></div>}</section>
  </>;
}

function ProfilePage({ user }: { user: User }) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [dni, setDni] = useState(user.dni ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [photoVersion, setPhotoVersion] = useState(0);
  const [photoPending, setPhotoPending] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoMessage, setPhotoMessage] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const update = trpc.profile.update.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
    }
  });
  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setPhotoError("");
    setPhotoMessage("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) {
      setPhotoError("Elegí una imagen JPEG, PNG o WebP de hasta 5 MB.");
      input.value = "";
      return;
    }
    setPhotoPending(true);
    try {
      const response = await fetch("/api/profile/photo", {
        method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "No se pudo guardar la foto.");
      }
      const version = Date.now();
      setPhotoVersion(version);
      window.dispatchEvent(new Event("comedor-profile-photo-updated"));
      setPhotoMessage("Foto de perfil actualizada.");
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "No se pudo guardar la foto.");
    } finally {
      setPhotoPending(false);
      input.value = "";
    }
  }
  async function removeProfilePhoto() {
    setPhotoPending(true);
    setPhotoError("");
    setPhotoMessage("");
    try {
      const response = await fetch("/api/profile/photo", { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("No se pudo quitar la foto de perfil.");
      const version = Date.now();
      setPhotoVersion(version);
      window.dispatchEvent(new Event("comedor-profile-photo-updated"));
      setPhotoMessage("Foto de perfil quitada.");
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "No se pudo quitar la foto de perfil.");
    } finally {
      setPhotoPending(false);
    }
  }
  return <>
    <PageIntro eyebrow="DATOS PERSONALES" title="Mi perfil" description="Actualizá tus datos de contacto y consultá la información asociada a tu cuenta." />
    <section className="surface-card form-panel profile-panel">
      <div className="profile-summary"><Avatar firstName={user.firstName} lastName={user.lastName} photoVersion={photoVersion} /><div><strong>{user.firstName} {user.lastName}</strong><small>{roleNames[user.role]}</small></div></div>
      <div className="profile-photo-actions"><input ref={photoInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handlePhotoUpload(event)} /><button className="button button-secondary" type="button" disabled={photoPending} onClick={() => photoInput.current?.click()}><Camera size={16} />{photoPending ? "Guardando…" : "Cambiar foto"}</button><button className="button button-secondary" type="button" disabled={photoPending} onClick={() => void removeProfilePhoto()}><Trash2 size={15} />Quitar foto</button></div>
      {photoError && <div className="form-error" role="alert">{photoError}</div>}{photoMessage && <div className="notice-message" role="status">{photoMessage}</div>}
      <Link className="profile-accessibility-link" href="/accesibilidad"><Accessibility size={17} aria-hidden="true" /> Configurar accesibilidad</Link>
      <form className="admin-form profile-form" onSubmit={(event) => { event.preventDefault(); void update.mutateAsync({ firstName, lastName, dni: dni.trim() || null, phone: phone.trim() || null }); }}>
        <div className="form-grid"><label className="field">Nombre<input required maxLength={100} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label><label className="field">Apellido<input required maxLength={100} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} /></label></div>
        <label className="field">Correo electrónico<input value={user.email} readOnly /></label>
        <label className="field">DNI<input inputMode="numeric" pattern="[0-9]{7,10}" maxLength={10} autoComplete="off" value={dni} onChange={(event) => setDni(event.target.value.replace(/\D/g, ""))} /></label>
        <label className="field">Teléfono<input maxLength={30} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <button className="button button-primary" disabled={update.isPending}>{update.isPending ? "Guardando…" : "Guardar cambios"}</button>
      </form>
      {update.error && <div className="form-error">{friendlyError(update.error)}</div>}
    </section>
  </>;
}

type BooleanAccessibilityPreference = Exclude<keyof AccessibilityPreferences, "textSize">;

const accessibilityPreferenceOptions: Array<{
  key: BooleanAccessibilityPreference;
  label: string;
  description: string;
}> = [
  { key: "highContrast", label: "Alto contraste", description: "Refuerza texto, bordes y superficies para distinguir mejor cada elemento." },
  { key: "simplifiedInterface", label: "Interfaz simplificada", description: "Prioriza Inicio, Reservar, Tickets, Menú, Perfil y Accesibilidad; el resto queda en Más secciones." },
  { key: "reduceMotion", label: "Reducir movimiento", description: "Desactiva animaciones y transiciones no esenciales." },
  { key: "colorDifferentiation", label: "Mejorar diferenciación de colores", description: "Agrega indicadores y contornos a estados; los estados también se expresan con texto." },
  { key: "keyboardOptimized", label: "Navegación optimizada para teclado", description: "Resalta con mayor claridad el foco al recorrer controles con Tab." },
  { key: "readingAssistance", label: "Lectura asistida", description: "Aumenta el espacio entre líneas y facilita seguir textos e instrucciones." },
  { key: "largerControls", label: "Mayor tamaño de controles", description: "Amplía botones y áreas interactivas para facilitar su uso." }
];

function AccessibilityOptions({
  preferences,
  onChange
}: {
  preferences: AccessibilityPreferences;
  onChange: (preferences: AccessibilityPreferences) => void;
}) {
  const idPrefix = useId();
  function setBooleanPreference(key: BooleanAccessibilityPreference, value: boolean) {
    onChange({ ...preferences, [key]: value });
  }

  return <div className="accessibility-options">
    <fieldset className="accessibility-fieldset text-size-options">
      <legend>Tamaño del texto</legend>
      {([
        ["normal", "Normal"],
        ["large", "Grande"],
        ["veryLarge", "Muy grande"]
      ] as const).map(([value, label]) => {
        const id = `${idPrefix}-text-${value}`;
        return <label className="accessibility-radio" htmlFor={id} key={value}>
          <input id={id} type="radio" name={`${idPrefix}-text-size`} value={value} checked={preferences.textSize === value} onChange={() => onChange({ ...preferences, textSize: value })} />
          <span>{label}</span>
        </label>;
      })}
    </fieldset>
    <fieldset className="accessibility-fieldset">
      <legend>Preferencias de visualización y uso</legend>
      <div className="accessibility-toggle-list">
        {accessibilityPreferenceOptions.map(({ key, label, description }) => {
          const id = `${idPrefix}-${key}`;
          return <label className="accessibility-toggle" htmlFor={id} key={key}>
            <input id={id} type="checkbox" checked={preferences[key]} onChange={(event) => setBooleanPreference(key, event.target.checked)} />
            <span className="accessibility-toggle-copy">
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </label>;
        })}
      </div>
    </fieldset>
  </div>;
}

function AccessibilityPage({
  preferences,
  onChange,
  saveError,
  saving,
  loadError
}: {
  preferences: AccessibilityPreferences;
  onChange: (preferences: AccessibilityPreferences) => void;
  saveError: string;
  saving: boolean;
  loadError: string;
}) {
  return <>
    <PageIntro eyebrow="PREFERENCIAS PERSONALES" title="Accesibilidad" description="Elegí las opciones que te resulten útiles. Podés combinarlas y cambiarlas cuando quieras." />
    {loadError && <div className="inline-error" role="alert">No se pudieron cargar tus preferencias guardadas: {loadError}</div>}
    {saveError && <div className="inline-error" role="alert">No se pudieron guardar los cambios. Se mantienen en este dispositivo: {saveError}</div>}
    <section className="surface-card accessibility-settings">
      <AccessibilityOptions preferences={preferences} onChange={onChange} />
      <div className="accessibility-save-status" role="status" aria-live="polite">
        {saving ? "Guardando preferencias en tu cuenta…" : "Las preferencias se guardan automáticamente en tu cuenta y en este dispositivo."}
      </div>
    </section>
  </>;
}

function SessionManagement() {
  const utils = trpc.useUtils();
  const sessions = trpc.auth.sessions.useQuery();
  const revoke = trpc.auth.revokeSession.useMutation({
    onSuccess: () => void utils.auth.sessions.invalidate()
  });
  const revokeOthers = trpc.auth.revokeOtherSessions.useMutation({
    onSuccess: () => void utils.auth.sessions.invalidate()
  });
  return <>
    <PageIntro
      eyebrow="SEGURIDAD DE LA CUENTA"
      title="Sesiones activas"
      description="Revisá los dispositivos con acceso a tu cuenta y cerrá los que ya no uses."
      action={<button className="button button-secondary" onClick={() => {
        if (window.confirm("Se cerrarán todas las sesiones excepto esta. ¿Querés continuar?")) void revokeOthers.mutateAsync();
      }} disabled={revokeOthers.isPending || !sessions.data?.some((item) => !item.current)}>
        {revokeOthers.isPending ? "Cerrando…" : "Cerrar las demás sesiones"}
      </button>}
    />
    {sessions.error && <InlineError error={sessions.error} />}
    {revoke.error && <div className="inline-error" role="alert">{friendlyError(revoke.error)}</div>}
    {revokeOthers.error && <div className="inline-error" role="alert">{friendlyError(revokeOthers.error)}</div>}
    <section className="surface-card table-card">
      <div className="surface-heading"><div><span className="eyebrow">DISPOSITIVOS CONECTADOS</span><h3>Accesos de tu cuenta</h3></div><span className="row-count">{sessions.data?.length ?? 0} sesiones</span></div>
      {sessions.isLoading ? <LoadingRows /> : !sessions.data?.length ? <EmptyState icon={<MonitorSmartphone size={22} />} title="No hay sesiones activas" text="Volvé a iniciar sesión para consultar tus dispositivos." /> : <div className="table-wrap"><table><thead><tr><th>DISPOSITIVO</th><th>IP PARCIAL</th><th>ÚLTIMA ACTIVIDAD</th><th>VENCE</th><th>ESTADO</th><th>ACCIÓN</th></tr></thead><tbody>
        {sessions.data.map((item) => <tr key={item.id}>
          <td><strong>{item.device}</strong>{item.userAgent && <details><summary>Detalles del navegador</summary><small>{item.userAgent}</small></details>}</td>
          <td>{item.ipPartial}</td>
          <td>{item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleString("es-AR") : "No disponible"}</td>
          <td>{new Date(item.expiresAt).toLocaleString("es-AR")}</td>
          <td><Status status={item.current ? "SESIÓN ACTUAL" : "ACTIVA"} /></td>
          <td>{!item.current && <button className="button button-secondary" disabled={revoke.isPending} onClick={() => {
            if (window.confirm(`¿Cerrar la sesión de ${item.device}?`)) void revoke.mutateAsync({ id: item.id });
          }}>Cerrar sesión</button>}</td>
        </tr>)}
      </tbody></table></div>}
      <p className="section-copy">La ubicación no se recopila. La IP se muestra parcialmente y los cierres de sesión quedan registrados en la auditoría.</p>
    </section>
  </>;
}

function UsersPage({ actorRole, canManage, canCreate }: { actorRole: Role; canManage: boolean; canCreate: boolean }) {
  const [search, setSearch] = useState("");
  const users = trpc.administration.users.useQuery({ search: search.trim() || undefined });
  const utils = trpc.useUtils();
  const [newUser, setNewUser] = useState({
    firstName: "", lastName: "", email: "", dni: "", role: "ALUMNO" as Role, password: ""
  });
  const create = trpc.administration.createUser.useMutation({
    onSuccess: async () => {
      setNewUser({ firstName: "", lastName: "", email: "", dni: "", role: "ALUMNO", password: "" });
      await utils.administration.users.invalidate();
    }
  });
  const update = trpc.administration.updateUser.useMutation({
    onSuccess: () => void utils.administration.users.invalidate(),
  });
  const allowedRoles = assignableRolesForActor(actorRole);
  return <>
    <PageIntro eyebrow="ADMINISTRACIÓN INSTITUCIONAL" title="Usuarios y roles" description={canManage ? "Revisá la pertenencia institucional antes de habilitar cuentas o modificar sus roles. Cada decisión queda auditada." : "Consultá las cuentas y creá usuarios con los permisos de tu rol."} />
    {canCreate && <section className="surface-card form-panel"><h3>Agregar usuario</h3><form className="admin-form" onSubmit={(event) => { event.preventDefault(); void create.mutateAsync({ ...newUser, dni: newUser.dni || undefined }); }}>
      <div className="form-grid"><label className="field">Nombre<input required maxLength={100} value={newUser.firstName} onChange={(event) => setNewUser({ ...newUser, firstName: event.target.value })} /></label><label className="field">Apellido<input required maxLength={100} value={newUser.lastName} onChange={(event) => setNewUser({ ...newUser, lastName: event.target.value })} /></label></div>
      <div className="form-grid"><label className="field">Correo electrónico<input required type="email" maxLength={254} value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} /></label><label className="field">DNI <span className="muted-inline">(opcional)</span><input inputMode="numeric" pattern="[0-9]{7,10}" value={newUser.dni} onChange={(event) => setNewUser({ ...newUser, dni: event.target.value })} /></label></div>
      <div className="form-grid"><label className="field">Rol<select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value as Role })}>{allowedRoles.map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}</select></label><label className="field">Contraseña inicial<input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} /></label></div>
      {create.error && <div className="form-error">{friendlyError(create.error)}</div>}<button className="button button-primary" disabled={create.isPending}>{create.isPending ? "Creando…" : "Crear cuenta"}</button>
    </form></section>}
    {canManage && <div className="notice-message">Solo habilitá una cuenta después de verificar su identidad y rol con una fuente institucional autorizada. Las cuentas nuevas permanecen pendientes hasta esta revisión.</div>}
    <section className="surface-card table-card"><div className="surface-heading users-heading"><div><span className="eyebrow">CUENTAS</span><h3>Usuarios registrados</h3></div><label className="field users-search">Buscar usuario<input maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, correo o DNI" /></label><span className="row-count">{users.data?.length ?? 0} cuentas</span></div>
      {users.isLoading ? <LoadingRows /> : users.error ? <InlineError error={users.error} /> : !users.data?.length ? <EmptyState icon={<Users size={22} />} title="No hay usuarios" text="Las cuentas registradas aparecerán aquí." /> : <div className="table-wrap"><table><thead><tr><th>PERSONA</th><th>DNI</th><th>ROL</th><th>ESTADO</th>{canManage && <th>GUARDAR</th>}</tr></thead><tbody>{users.data.map((account) => {
        const accountRole = String(account.role) as Role;
        const canManageAccount = canManage && allowedRoles.includes(accountRole);
        return <UserRoleRow key={String(account.id)} account={account} canManage={canManageAccount} allowedRoles={allowedRoles} pending={update.isPending} onSave={(role, status) => void update.mutate({ id: String(account.id), role, status })} />;
      })}</tbody></table></div>}
      {update.error && <div className="inline-error">{friendlyError(update.error)}</div>}
    </section>
  </>;
}

function UserRoleRow({ account, canManage, allowedRoles, pending, onSave }: {
  account: Record<string, unknown>;
  canManage: boolean;
  allowedRoles: readonly Role[];
  pending: boolean;
  onSave: (role: Role, status: "PENDING" | "ACTIVE" | "SUSPENDED") => void;
}) {
  const [role, setRole] = useState(String(account.role) as Role);
  const [status, setStatus] = useState(String(account.status) as "PENDING" | "ACTIVE" | "SUSPENDED");
  const statusLabels = { PENDING: "Pendiente de validación", ACTIVE: "Activa", SUSPENDED: "Suspendida" };
  return <tr>
    <td><strong>{String(account.firstName)} {String(account.lastName)}</strong><small>{String(account.email)}</small></td>
    <td>{String(account.dni ?? "—")}</td>
    <td>{canManage ? <select className="status-select" value={role} onChange={(event) => setRole(event.target.value as Role)}>{allowedRoles.map((value) => <option key={value} value={value}>{roleNames[value]}</option>)}</select> : roleNames[role]}</td>
    <td>{canManage ? <select className="status-select" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : statusLabels[status]}</td>
    {canManage && <td><button className="table-action" disabled={pending || (role === account.role && status === account.status)} onClick={() => onSave(role, status)}>Guardar</button></td>}
  </tr>;
}

function ScholarshipsPage({ user, canManage }: { user: User; canManage: boolean }) {
  const managed = trpc.scholarships.list.useQuery(undefined, { enabled: canManage });
  const own = trpc.scholarships.mine.useQuery(undefined, { enabled: !canManage && user.role === "ALUMNO" });
  const benefits = trpc.benefits.list.useQuery(undefined, { enabled: canManage });
  const myBenefits = trpc.benefits.mine.useQuery(undefined, { enabled: !canManage && user.role === "ALUMNO" });
  const benefitUsers = trpc.administration.users.useQuery({}, { enabled: canManage });
  const utils = trpc.useUtils();
  const [type, setType] = useState<"BECA_COMPLETA" | "MEDIA_BECA">("BECA_COMPLETA");
  const [documentationReference, setDocumentationReference] = useState("");
  const [benefitDraft, setBenefitDraft] = useState({ userId: "", name: "", description: "", validFrom: "", validUntil: "" });
  const request = trpc.scholarships.request.useMutation({
    onSuccess: async () => {
      setDocumentationReference("");
      await utils.scholarships.mine.invalidate();
      await utils.notifications.mine.invalidate();
    },
  });
  const review = trpc.scholarships.review.useMutation({
    onSuccess: () => void utils.scholarships.list.invalidate(),
  });
  const assignBenefit = trpc.benefits.assign.useMutation({
    onSuccess: async () => {
      setBenefitDraft({ userId: "", name: "", description: "", validFrom: "", validUntil: "" });
      await utils.benefits.list.invalidate();
      await utils.benefits.mine.invalidate();
    }
  });
  const changeBenefitStatus = trpc.benefits.setStatus.useMutation({
    onSuccess: async () => {
      await utils.benefits.list.invalidate();
      await utils.benefits.mine.invalidate();
    }
  });
  const requests = canManage ? managed.data : own.data;
  if (!canManage && user.role !== "ALUMNO") {
    return <><PageIntro eyebrow="GESTIÓN DE BENEFICIOS" title="Becas" description="La solicitud de becas está disponible para cuentas de estudiantes." /><section className="surface-card"><p className="section-copy">Tu rol no permite solicitar ni administrar becas.</p></section></>;
  }
  return <>
    <PageIntro eyebrow="GESTIÓN DE BENEFICIOS" title={canManage ? "Solicitudes de beca" : "Mis becas"} description={canManage ? "Revisá las solicitudes y definí su período de vigencia." : "Consultá el estado de tus solicitudes de beca."} />
    {canManage ? <div className="notice-message scholarship-documents-notice"><ClipboardList size={18} aria-hidden="true" /><div><strong>Recepción y revisión de documentación</strong><p>El estudiante presenta los papeles y requisitos en Mesa de Entrada de la Secretaría de Bienestar Universitaria - UNCA. El Supervisor gestiona la revisión desde este panel.</p></div></div> : own.data?.some((row) => row.status === "PENDIENTE") && <div className="notice-message scholarship-documents-notice" role="status"><ClipboardList size={18} aria-hidden="true" /><div><strong>Presentá la documentación de tu solicitud</strong><p>Acercá los papeles y requisitos a Mesa de Entrada de la Secretaría de Bienestar Universitaria - UNCA. El Supervisor gestionará la revisión.</p></div></div>}
    <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">{canManage ? "BENEFICIOS ASIGNADOS" : "MIS BENEFICIOS"}</span><h3>{canManage ? "Administrar beneficios" : "Beneficios vigentes e históricos"}</h3></div></div>
      {canManage ? <><p className="section-copy">Solo el Supervisor puede asignar o cambiar beneficios. La asignación se registra en auditoría; no modifica tarifas ni importes guardados en reservas.</p><form className="admin-form" onSubmit={(event) => { event.preventDefault(); void assignBenefit.mutateAsync({ userId: benefitDraft.userId, name: benefitDraft.name, description: benefitDraft.description || undefined, validFrom: benefitDraft.validFrom || undefined, validUntil: benefitDraft.validUntil || undefined }); }}><div className="form-grid"><label className="field">Usuario<select required value={benefitDraft.userId} onChange={(event) => setBenefitDraft({ ...benefitDraft, userId: event.target.value })}><option value="">Seleccionar usuario</option>{(benefitUsers.data ?? []).filter((account) => account.status === "ACTIVE").map((account) => <option key={String(account.id)} value={String(account.id)}>{String(account.firstName)} {String(account.lastName)} · {String(account.dni ?? account.email)}</option>)}</select></label><label className="field">Beneficio<input required minLength={2} maxLength={120} value={benefitDraft.name} onChange={(event) => setBenefitDraft({ ...benefitDraft, name: event.target.value })} /></label><label className="field">Válido desde<input type="date" value={benefitDraft.validFrom} onChange={(event) => setBenefitDraft({ ...benefitDraft, validFrom: event.target.value })} /></label><label className="field">Válido hasta<input type="date" value={benefitDraft.validUntil} onChange={(event) => setBenefitDraft({ ...benefitDraft, validUntil: event.target.value })} /></label><label className="field">Descripción<textarea maxLength={2000} value={benefitDraft.description} onChange={(event) => setBenefitDraft({ ...benefitDraft, description: event.target.value })} /></label></div><button className="button button-primary" disabled={assignBenefit.isPending || !benefitDraft.userId}>{assignBenefit.isPending ? "Asignando…" : "Asignar beneficio"}</button></form>{assignBenefit.error && <div className="form-error">{friendlyError(assignBenefit.error)}</div>}<BenefitTable rows={benefits.data ?? []} loading={benefits.isLoading} error={benefits.error} canManage onStatusChange={(id, status) => void changeBenefitStatus.mutate({ id, status })} updating={changeBenefitStatus.isPending} /></> :
        <BenefitTable rows={myBenefits.data ?? []} loading={myBenefits.isLoading} error={myBenefits.error} canManage={false} onStatusChange={() => undefined} updating={false} />}
    </section>
    {!canManage && <section className="surface-card form-panel"><h3>Solicitar una beca</h3><p className="section-copy">La solicitud queda pendiente de revisión. No adjuntes documentación sensible en este campo.</p><form className="admin-form" onSubmit={(event) => { event.preventDefault(); void request.mutateAsync({ type, documentationReference: documentationReference || undefined }); }}><label className="field">Tipo de beca<select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="BECA_COMPLETA">Beca completa</option><option value="MEDIA_BECA">Media beca</option></select></label><label className="field">Referencia documental opcional<input maxLength={500} value={documentationReference} onChange={(event) => setDocumentationReference(event.target.value)} /></label><button className="button button-primary" disabled={request.isPending}>{request.isPending ? "Enviando…" : "Enviar solicitud"}</button></form>{request.error && <div className="form-error">{friendlyError(request.error)}</div>}</section>}
    <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">{canManage ? "PENDIENTES Y REVISADAS" : "HISTORIAL"}</span><h3>{canManage ? "Solicitudes" : "Estado de mis solicitudes"}</h3></div></div>
      {managed.isLoading && canManage || own.isLoading && !canManage ? <LoadingRows /> : managed.error && canManage ? <InlineError error={managed.error} /> : own.error && !canManage ? <InlineError error={own.error} /> : !requests?.length ? <EmptyState icon={<GraduationCap size={22} />} title="Sin solicitudes" text="No hay solicitudes de beca para mostrar." /> : <div className="table-wrap"><table><thead><tr><th>PERSONA / TIPO</th><th>FECHA</th><th>VIGENCIA</th><th>ESTADO</th>{canManage && <th>REVISIÓN</th>}</tr></thead><tbody>{requests.map((row) => <tr key={String(row.id)}><td><strong>{canManage ? `${String(row.firstName)} ${String(row.lastName)}` : String(row.scholarshipType)}</strong>{canManage && <small>{String(row.dni ?? "")} · {String(row.scholarshipType)}</small>}</td><td>{formatDate(String(row.createdAt).slice(0, 10))}</td><td>{row.validFrom ? `${String(row.validFrom)} – ${String(row.validUntil ?? "Sin vencimiento")}` : "—"}</td><td><Status status={String(row.status)} /></td>{canManage && <td>{row.status === "PENDIENTE" && <div className="table-actions"><button className="table-action" disabled={review.isPending} onClick={() => void review.mutate({ id: String(row.id), status: "APROBADA", validFrom: new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }) })}>Aprobar</button><button className="table-action danger-action" disabled={review.isPending} onClick={() => void review.mutate({ id: String(row.id), status: "RECHAZADA" })}>Rechazar</button></div>}</td>}</tr>)}</tbody></table></div>}
      {review.error && <div className="inline-error">{friendlyError(review.error)}</div>}
    </section>
  </>;
}

function FoodCreditsPage({ user, canManage }: { user: User; canManage: boolean }) {
  const mine = trpc.foodCredits.mine.useQuery(undefined, { enabled: user.role === "ALUMNO" });
  const list = trpc.foodCredits.list.useQuery(undefined, { enabled: canManage });
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState("50");
  const [reason, setReason] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const request = trpc.foodCredits.request.useMutation({
    onSuccess: async () => {
      setAmount("50");
      setReason("");
      setServiceDate("");
      setRequestMessage("Tu solicitud fue enviada y quedó pendiente de revisión.");
      await utils.foodCredits.mine.invalidate();
      await utils.notifications.mine.invalidate();
    }
  });
  const review = trpc.foodCredits.review.useMutation({
    onSuccess: async () => {
      setRequestMessage("La solicitud fue revisada.");
      await utils.foodCredits.list.invalidate();
      await utils.foodCredits.mine.invalidate();
    }
  });
  const rows = (canManage ? (list.data ?? []) : (mine.data ?? [])) as Array<Record<string, any>>;

  return <>
    <PageIntro eyebrow="CRÉDITOS DE COMIDA" title={canManage ? "Créditos de comida" : "Mis créditos de comida"} description={canManage ? "Revisá, aprueba o rechaza solicitudes para créditos de comida de la comunidad estudiantil." : "Gestioná las solicitudes y revisá el estado de tus créditos de comida disponibles."} />
    {!canManage && user.role === "ALUMNO" && <section className="surface-card form-panel">
      <h3>Solicitar crédito de comida</h3>
      <p className="section-copy">La solicitud se presenta a revisión del Supervisor. Se acepta para estudiantes sin beca completa o con media beca siguiendo la política institucional.</p>
      <form className="admin-form" onSubmit={(event) => { event.preventDefault(); setRequestMessage(""); void request.mutateAsync({ amount: Number(amount), reason: reason || undefined, serviceDate: serviceDate || undefined }); }}>
        <div className="form-grid">
          <label className="field">Monto de crédito<input type="number" min="1" max="2000" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label className="field">Fecha del servicio<input type="date" value={serviceDate} onChange={(event) => { setServiceDate(event.target.value); setRequestMessage(""); }} /></label>
        </div>
        <label className="field">Motivo<textarea maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); setRequestMessage(""); }} /></label>
        <button className="button button-primary" disabled={request.isPending}>{request.isPending ? "Enviando…" : "Solicitar crédito"}</button>
      </form>
      {requestMessage && <div className="notice-message" role="status">{requestMessage}</div>}
      {request.error && <div className="form-error">{friendlyError(request.error)}</div>}
    </section>}
    <section className="surface-card table-card">
      <div className="surface-heading"><div><span className="eyebrow">HISTORIAL</span><h3>{canManage ? "Solicitudes registradas" : "Mis solicitudes"}</h3></div></div>
      {requestMessage && canManage && <div className="notice-message" role="status">{requestMessage}</div>}
      {review.error && canManage && <div className="inline-error" role="alert">{friendlyError(review.error)}</div>}
      {canManage ? (list.isLoading ? <LoadingRows /> : list.error ? <InlineError error={list.error} /> : !rows?.length ? <EmptyState icon={<Gift size={22} />} title="Sin solicitudes" text="Las solicitudes de crédito de comida aparecerán aquí." /> : <div className="table-wrap"><table><thead><tr><th>PERSONA</th><th>MONTO</th><th>FECHA</th><th>ESTADO</th><th>REVISIÓN</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td><strong>{String(row.firstName)} {String(row.lastName)}</strong><small>{String(row.dni ?? "—")}</small></td><td>{String(row.amount)} ARS</td><td>{row.serviceDate ? formatDate(String(row.serviceDate)) : "Sin servicio"}</td><td><Status status={String(row.status)} /></td><td>{row.status === "PENDIENTE" && <div className="table-actions"><button className="table-action" disabled={review.isPending} onClick={() => { setRequestMessage(""); review.mutate({ id: String(row.id), status: "APROBADA" }); }}>Aprobar</button><button className="table-action danger-action" disabled={review.isPending} onClick={() => { setRequestMessage(""); review.mutate({ id: String(row.id), status: "RECHAZADA" }); }}>Rechazar</button></div>}</td></tr>)}</tbody></table></div>) : (mine.isLoading ? <LoadingRows /> : mine.error ? <InlineError error={mine.error} /> : !rows?.length ? <EmptyState icon={<Gift size={22} />} title="Sin créditos" text="Todavía no hay créditos de comida registrados para tu cuenta." /> : <div className="table-wrap"><table><thead><tr><th>MONTO</th><th>FECHA</th><th>MOTIVO</th><th>ESTADO</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{String(row.amount)} ARS</td><td>{row.serviceDate ? formatDate(String(row.serviceDate)) : "Sin servicio"}</td><td>{row.reason ? String(row.reason) : "—"}</td><td><Status status={String(row.status)} /></td></tr>)}</tbody></table></div>)}
    </section>
  </>;
}

function BenefitTable({ rows, loading, error, canManage, onStatusChange, updating }: {
  rows: Array<Record<string, unknown>>;
  loading: boolean;
  error: { message: string; data?: { code?: string | null } | null } | null;
  canManage: boolean;
  onStatusChange: (id: string, status: "APROBADO" | "RECHAZADO" | "VENCIDO") => void;
  updating: boolean;
}) {
  return loading ? <LoadingRows /> : error ? <InlineError error={error} /> : !rows.length
    ? <EmptyState icon={<Gift size={22} />} title="Sin beneficios registrados" text="Los beneficios asignados aparecerán aquí." />
    : <div className="table-wrap"><table><thead><tr>{canManage && <th>PERSONA</th>}<th>BENEFICIO</th><th>VIGENCIA</th><th>ESTADO</th>{canManage && <th>ACCIÓN</th>}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}>{canManage && <td><strong>{String(row.firstName)} {String(row.lastName)}</strong><small>DNI {String(row.dni ?? "—")}</small></td>}<td><strong>{String(row.name)}</strong>{row.description != null && String(row.description).length > 0 && <small>{String(row.description)}</small>}</td><td>{row.validFrom ? `${String(row.validFrom)} – ${String(row.validUntil ?? "Sin vencimiento")}` : "Sin límite definido"}</td><td><Status status={String(row.status)} /></td>{canManage && <td><button className={`table-action ${row.status === "APROBADO" ? "danger-action" : ""}`} disabled={updating} onClick={() => onStatusChange(String(row.id), row.status === "APROBADO" ? "RECHAZADO" : "APROBADO")}>{row.status === "APROBADO" ? "Revocar" : "Activar"}</button></td>}</tr>)}</tbody></table></div>;
}

function PaymentsPage({ canReview, canViewAll, canReconcile }: { canReview: boolean; canViewAll: boolean; canReconcile: boolean }) {
  const mine = trpc.payments.mine.useQuery(undefined, { enabled: !canViewAll });
  const reviewed = trpc.payments.list.useQuery(undefined, { enabled: canViewAll });
  const reservations = trpc.reservations.mine.useQuery(undefined, { enabled: !canViewAll });
  const pendingReservations = trpc.payments.pendingReservations.useQuery(undefined, { enabled: canViewAll });
  const utils = trpc.useUtils();
  const [proof, setProof] = useState<{ file: File; previewUrl: string } | null>(null);
  const [proofError, setProofError] = useState("");
  const [proofPending, setProofPending] = useState(false);
  const proofUrls = useRef(new Set<string>());
  useEffect(() => () => proofUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const [method, setMethod] = useState<PaymentMethod>("TRANSFERENCIA");
  const [reference, setReference] = useState("");
  const [declaredAmount, setDeclaredAmount] = useState("");
  const [accreditationPayment, setAccreditationPayment] = useState<Record<string, unknown> | null>(null);
  const [accreditedAmount, setAccreditedAmount] = useState("");
  const [institutionalReference, setInstitutionalReference] = useState("");
  const [accreditationNote, setAccreditationNote] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const verifyDocumentation = trpc.payments.verifyDocumentation.useMutation({
    onSuccess: async () => {
      setReviewNotice("Documentación verificada. La acreditación todavía está pendiente.");
      await utils.payments.list.invalidate();
    }
  });
  const review = trpc.payments.review.useMutation({
    onSuccess: async (result) => {
      setAccreditationPayment(null);
      setAccreditedAmount("");
      setInstitutionalReference("");
      setAccreditationNote("");
      setReviewNotice("status" in result && result.status === "OBSERVADO"
        ? "Se registró una diferencia. El pago sigue pendiente y no fue imputado a las reservas."
        : "La operación fue revisada.");
      await utils.payments.list.invalidate();
    },
  });
  const rows = canViewAll ? reviewed.data : mine.data;
  const listError = canViewAll ? reviewed.error : mine.error;
  const listLoading = canViewAll ? reviewed.isLoading : mine.isLoading;
  function selectProof(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setProofError("Elegí una captura JPEG, PNG o WebP de hasta 5 MB.");
      event.currentTarget.value = "";
      return;
    }
    if (proof) {
      URL.revokeObjectURL(proof.previewUrl);
      proofUrls.current.delete(proof.previewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    proofUrls.current.add(previewUrl);
    setProof({ file, previewUrl });
    setProofError("");
  }
  async function submitProof(event: FormEvent<HTMLFormElement>, reservationIds: string[]) {
    event.preventDefault();
    if (!proof) {
      setProofError("Seleccioná la captura del pago antes de enviarla.");
      return;
    }
    setProofPending(true);
    setProofError("");
    try {
      const params = new URLSearchParams({ method, reservationIds: reservationIds.join(","), reference, amount: declaredAmount });
      const response = await fetch(`/api/payments/proof?${params.toString()}`, {
        method: "POST", credentials: "include", headers: { "Content-Type": proof.file.type }, body: proof.file
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? `No se pudo informar el pago (HTTP ${response.status}).`);
      }
      URL.revokeObjectURL(proof.previewUrl);
      proofUrls.current.delete(proof.previewUrl);
      setProof(null);
      setReference("");
      setDeclaredAmount("");
      void utils.payments.mine.invalidate();
      void utils.payments.list.invalidate();
      void utils.reservations.mine.invalidate();
    } catch (error) {
      setProofError(error instanceof Error ? error.message : "No se pudo informar el pago.");
    } finally {
      setProofPending(false);
    }
  }
  const submittedReservationIds = new Set((mine.data ?? [])
    .filter((payment) => payment.status === "PENDIENTE")
    .flatMap((payment) => typeof payment.reservationIds === "string" && payment.reservationIds
      ? payment.reservationIds.split(",")
      : [String(payment.reservationId)]));
  const payable = (reservations.data ?? []).filter((item) =>
    item.status === "PENDIENTE" && Number(item.priceAmount) > 0 && item.paymentStatus !== "PAGADO" &&
    !submittedReservationIds.has(String(item.id))
  );
  const payableReservationIds = payable.map((reservation) => String(reservation.id));
  const totalPayableCents = payable.reduce((sum, reservation) => sum + Math.round(Number(reservation.priceAmount) * 100), 0);
  return <>
    <PageIntro eyebrow="PAGOS Y REFERENCIAS" title={canViewAll ? "Pagos del comedor" : "Mis pagos"} description={canViewAll ? "Consultá el QR de transferencia y revisá las capturas de pago informadas por la comunidad." : "Transferí el total de tus reservas pendientes y adjuntá una sola captura del comprobante para revisión manual."} />
    <TransferAccountQr />
    {!canViewAll && payable.length > 0 && <section className="surface-card form-panel">
      <h3>Informar un pago</h3>
      <p className="section-copy">El comprobante cubrirá todas las reservas pendientes que aparecen en este resumen. Hacé una sola transferencia por el total y adjuntá una captura.</p>
      <div className="payment-checkout-list">
        {payable.map((reservation) => <div className="payment-checkout-summary" key={String(reservation.id)}>
          <strong>{serviceName(String(reservation.service))} · {formatDate(String(reservation.serviceDate))}</strong>
          <span>{String(reservation.priceCurrency)} {Number(reservation.priceAmount).toFixed(2)}</span>
        </div>)}
        <div className="payment-checkout-total"><strong>Total a transferir</strong><strong>{String(payable[0].priceCurrency)} {(totalPayableCents / 100).toFixed(2)}</strong></div>
      </div>
      <form className="payment-manual-form" onSubmit={(event) => void submitProof(event, payableReservationIds)}>
        <label className="field">Medio de pago<select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
          {paymentMethodValues.map((value) => <option key={value} value={value}>{paymentMethodLabels[value]}</option>)}
        </select></label>
        <label className="field">Referencia de la operación<input required minLength={3} maxLength={191} pattern="[A-Za-z0-9._/-]+" value={reference} onChange={(event) => setReference(event.target.value)} /><small>Ingresá el identificador único que figura en el comprobante de esta transferencia, no el importe ni una descripción.</small></label>
        <label className="field">Importe declarado<input required inputMode="decimal" pattern="[0-9]{1,8}([.][0-9]{1,2})?" value={declaredAmount} onChange={(event) => setDeclaredAmount(event.target.value)} placeholder={(totalPayableCents / 100).toFixed(2)} /></label>
        <label className="field">Captura del pago<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={selectProof} /></label>
        <button className="button button-primary" disabled={proofPending || !proof}>{proofPending ? "Enviando…" : "Informar pago"}</button>
        {proof && <img className="payment-proof-preview" src={proof.previewUrl} alt="Vista previa de la captura del pago total" />}
      </form>
      {proofError && <div className="form-error" role="alert">{proofError}</div>}
    </section>}
    {canViewAll && <section className="surface-card table-card">
      <div className="surface-heading"><div><span className="eyebrow">CONTROL DE COBROS</span><h3>Reservas pendientes</h3></div><span className="row-count">{pendingReservations.data?.length ?? 0} pagos pendientes</span></div>
      {pendingReservations.isLoading ? <LoadingRows /> : pendingReservations.error ? <InlineError error={pendingReservations.error} /> : !pendingReservations.data?.length
        ? <EmptyState icon={<CreditCard size={22} />} title="No hay cobros pendientes" text="Las reservas que requieren pago aparecerán aquí." />
        : <div className="table-wrap"><table><thead><tr><th>PERSONA</th><th>RESERVA</th><th>ROL / BECA</th><th>IMPORTE</th><th>ESTADO DEL PAGO</th></tr></thead><tbody>{pendingReservations.data.map((reservation) => <tr key={String(reservation.reservationId)}>
          <td><strong>{String(reservation.firstName)} {String(reservation.lastName)}</strong></td>
          <td>{serviceName(String(reservation.service))} · {formatDate(String(reservation.serviceDate))}</td>
          <td>{roleNames[String(reservation.role) as Role] ?? String(reservation.role)}{reservation.scholarshipType ? ` · ${String(reservation.scholarshipType)}` : ""}</td>
          <td>{String(reservation.currency)} {Number(reservation.amount).toFixed(2)}</td>
          <td><Status status={String(reservation.paymentStatus)} /></td>
        </tr>)}</tbody></table></div>}
    </section>}
    <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">{canViewAll ? "CONTROL ADMINISTRATIVO" : "HISTORIAL PERSONAL"}</span><h3>Pagos registrados</h3></div></div>
      {listLoading ? <LoadingRows /> : listError ? <InlineError error={listError} /> : !rows?.length
        ? <EmptyState icon={<CreditCard size={22} />} title="Sin pagos registrados" text="Los pagos y referencias informados aparecerán en este listado." />
        : <div className="table-wrap"><table><thead><tr>{canViewAll && <th>PERSONA</th>}<th>RESERVA</th><th>MEDIO</th><th>REFERENCIA</th><th>IMPORTE DECLARADO</th><th>ESTADO</th>{canViewAll && <th>ACREDITACIÓN</th>}{canReview && <th>REVISIÓN</th>}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}>
          {canViewAll && <td><strong>{String(row.firstName)} {String(row.lastName)}</strong><small>{String(row.email)}</small></td>}
          <td>{Number(row.reservationCount) > 1 ? `${String(row.reservationCount)} reservas` : row.serviceDate ? `${serviceName(String(row.service))} · ${formatDate(String(row.serviceDate))}` : "—"}</td>
          <td>{paymentMethodLabels[String(row.method) as PaymentMethod] ?? String(row.method)}</td>
          <td>{row.hasProof ? <><span>Captura adjunta</span><a className="payment-proof-link" href={`/api/payments/${encodeURIComponent(String(row.id))}/proof`} target="_blank" rel="noreferrer">Ver captura</a></> : <code>{String(row.reference)}</code>}</td>
          <td>{String(row.currency)} {Number(row.amount).toFixed(2)}</td>
          <td><Status status={String(row.status)} /></td>
          {canViewAll && <td>{row.latestFinanceEvent === "ACREDITACION_CONFIRMADA" ? "Acreditado" : row.latestFinanceEvent === "DIFERENCIA_DETECTADA" ? "Diferencia observada" : row.latestFinanceEvent === "DOCUMENTACION_VERIFICADA" ? "Documentación verificada · pendiente" : "Pendiente de revisión"}</td>}
          {canReview && <td>{row.status === "PENDIENTE" && <div className="table-actions"><button className="table-action" disabled={verifyDocumentation.isPending} onClick={() => void verifyDocumentation.mutate({ id: String(row.id) })}>Verificar documentación</button>{canReconcile && <button className="table-action" disabled={review.isPending || row.latestFinanceEvent !== "DOCUMENTACION_VERIFICADA"} onClick={() => { setAccreditationPayment(row); setAccreditedAmount(String(row.amount)); setInstitutionalReference(""); setAccreditationNote(""); }}>Confirmar acreditación</button>}<button className="table-action danger-action" disabled={review.isPending} onClick={() => void review.mutate({ id: String(row.id), status: "RECHAZADO" })}>Rechazar</button></div>}</td>}
        </tr>)}</tbody></table></div>}
      {reviewNotice && <div className="notice-message" role="status">{reviewNotice}</div>}
      {verifyDocumentation.error && <div className="inline-error">{friendlyError(verifyDocumentation.error)}</div>}
      {review.error && <div className="inline-error">{friendlyError(review.error)}</div>}
    </section>
    {accreditationPayment && <Modal title="Confirmar acreditación" onClose={() => setAccreditationPayment(null)}>
      <form className="modal-form" onSubmit={(event) => {
        event.preventDefault();
        void review.mutateAsync({
          id: String(accreditationPayment.id), status: "APROBADO", accreditedAmount,
          institutionalReference, note: accreditationNote || undefined
        });
      }}>
        <p className="section-copy">Verificá el ingreso efectivo en el canal institucional. El comprobante por sí solo no acredita el pago.</p>
        <label className="field">Importe acreditado<input required inputMode="decimal" pattern="[0-9]{1,8}([.][0-9]{1,2})?" value={accreditedAmount} onChange={(event) => setAccreditedAmount(event.target.value)} /></label>
        <label className="field">Referencia institucional<input required minLength={3} maxLength={191} value={institutionalReference} onChange={(event) => setInstitutionalReference(event.target.value)} /></label>
        <label className="field">Observación opcional<textarea maxLength={1000} value={accreditationNote} onChange={(event) => setAccreditationNote(event.target.value)} /></label>
        <button className="button button-primary button-full" disabled={review.isPending}>{review.isPending ? "Registrando…" : "Confirmar acreditación"}</button>
      </form>
    </Modal>}
  </>;
}

function TransferAccountQr() {
  const [unavailable, setUnavailable] = useState(false);
  return <section className="surface-card transfer-account-card">
    <div><span className="eyebrow">CUENTA INSTITUCIONAL</span><h3>Transferencia bancaria</h3>
      <p className="section-copy">Escaneá el QR oficial para transferir a la cuenta del Comedor UNCA. Después, adjuntá la captura del comprobante para que el pago sea verificado manualmente.</p>
      <div className="payment-method-tags">{paymentMethodValues.map((method) => <span key={method}>{paymentMethodLabels[method]}</span>)}</div>
    </div>
    {unavailable
      ? <p className="notice-message" role="status">El QR oficial de la cuenta se incorporará cuando esté disponible.</p>
      : <img className="transfer-account-qr" src="/payment-qr-nacion.png" alt="QR oficial de transferencia a la cuenta del Comedor UNCA" onError={() => setUnavailable(true)} />}
  </section>;
}
function PricingPage() {
  const history = trpc.pricing.history.useQuery();
  const utils = trpc.useUtils();
  const [role, setRole] = useState<Role>("ALUMNO");
  const [scholarshipType, setScholarshipType] = useState<"BECA_COMPLETA" | "MEDIA_BECA" | "SIN_BECA">("SIN_BECA");
  const [amount, setAmount] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
  const save = trpc.pricing.set.useMutation({ onSuccess: () => void utils.pricing.history.invalidate() });
  return <>
    <PageIntro eyebrow="CONFIGURACIÓN ECONÓMICA" title="Tarifas" description="Los importes se administran en MySQL y cada reserva conserva una copia histórica de su tarifa." />
    <section className="surface-card form-panel"><h3>Agregar tarifa vigente</h3><form className="admin-form admin-form-inline" onSubmit={(event) => { event.preventDefault(); void save.mutateAsync({ role, scholarshipType: role === "ALUMNO" ? scholarshipType : null, amount: Number(amount), validFrom }); }}>
      <label className="field">Rol<select value={role} onChange={(event) => setRole(event.target.value as Role)}>{Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {role === "ALUMNO" && <label className="field">Beca<select value={scholarshipType} onChange={(event) => setScholarshipType(event.target.value as typeof scholarshipType)}><option value="BECA_COMPLETA">Beca completa</option><option value="MEDIA_BECA">Media beca</option><option value="SIN_BECA">Sin beca</option></select></label>}
      <label className="field">Importe ARS<input type="number" min="0" max="100000" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="field">Vigente desde<input type="date" required value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label><button className="button button-primary" disabled={save.isPending}>Guardar tarifa</button>
    </form>{save.error && <div className="form-error">{friendlyError(save.error)}</div>}</section>
    <section className="surface-card table-card"><div className="surface-heading"><div><span className="eyebrow">HISTORIAL</span><h3>Tarifas vigentes e históricas</h3></div></div>{history.isLoading ? <LoadingRows /> : history.error ? <InlineError error={history.error} /> : !history.data?.length ? <EmptyState icon={<CreditCard size={22} />} title="Sin tarifas configuradas" text="Agregá una tarifa para habilitar reservas pagas." /> : <div className="table-wrap"><table><thead><tr><th>ROL</th><th>BECA</th><th>IMPORTE</th><th>VIGENCIA</th></tr></thead><tbody>{history.data.map((item) => <tr key={String(item.id)}><td>{roleNames[item.role as Role] ?? String(item.role)}</td><td>{String(item.scholarshipType ?? "—")}</td><td>{String(item.currency)} {Number(item.amount).toFixed(2)}</td><td>{String(item.validFrom)} – {String(item.validUntil ?? "Actual")}</td></tr>)}</tbody></table></div>}</section>
  </>;
}

function ConfigurationPage() {
  const config = trpc.administration.capacityConfig.useQuery();
  const closures = trpc.administration.closures.useQuery();
  const utils = trpc.useUtils();
  const update = trpc.administration.updateCapacity.useMutation({ onSuccess: () => void utils.administration.capacityConfig.invalidate() });
  const [closureDate, setClosureDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
  const [closureService, setClosureService] = useState<"ALMUERZO" | "CENA">("ALMUERZO");
  const [closureReason, setClosureReason] = useState("");
  const addClosure = trpc.administration.addClosure.useMutation({
    onSuccess: async () => {
      setClosureReason("");
      await utils.administration.closures.invalidate();
      await utils.reservations.capacity.invalidate();
    }
  });
  const removeClosure = trpc.administration.removeClosure.useMutation({
    onSuccess: async () => {
      await utils.administration.closures.invalidate();
      await utils.reservations.capacity.invalidate();
    }
  });
  return <>
    <PageIntro eyebrow="PARÁMETROS OPERATIVOS" title="Configuración de servicios" description="Ajustá cupos y horarios. Los cambios impactan en las siguientes reservas." />
    {config.isLoading ? <LoadingRows /> : config.error ? <InlineError error={config.error} /> : <div className="config-grid">{config.data?.map((item) => <CapacityConfigForm key={String(item.service)} item={item} pending={update.isPending} onSave={(values) => void update.mutate(values)} />)}</div>}
    {update.error && <div className="inline-error">{friendlyError(update.error)}</div>}
    <p className="notice-message">Atención física del comedor: horario pendiente de confirmación institucional. Las ventanas de reserva se muestran por separado y no representan el horario de atención.</p>
    <section className="surface-card form-panel">
      <div className="surface-heading"><div><span className="eyebrow">CIERRES EXCEPCIONALES</span><h3>Fechas sin servicio</h3></div></div>
      <p className="section-copy">El comedor opera de lunes a viernes. Los cierres solo afectan nuevas reservas y no alteran reservas ni turnos históricos.</p>
      <form className="admin-form admin-form-inline" onSubmit={(event) => {
        event.preventDefault();
        void addClosure.mutateAsync({ date: closureDate, service: closureService, reason: closureReason.trim() });
      }}>
        <label className="field">Fecha<input type="date" required min={new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })} value={closureDate} onChange={(event) => setClosureDate(event.target.value)} /></label>
        <label className="field">Servicio<select value={closureService} onChange={(event) => setClosureService(event.target.value as typeof closureService)}><option value="ALMUERZO">Almuerzo</option><option value="CENA">Cena</option></select></label>
        <label className="field">Motivo<input required minLength={3} maxLength={250} value={closureReason} onChange={(event) => setClosureReason(event.target.value)} placeholder="Feriado, mantenimiento…" /></label>
        <button className="button button-primary" disabled={addClosure.isPending}>{addClosure.isPending ? "Guardando…" : "Agregar cierre"}</button>
      </form>
      {(addClosure.error || removeClosure.error) && <div className="form-error">{friendlyError(addClosure.error ?? removeClosure.error)}</div>}
      {closures.isLoading ? <LoadingRows /> : closures.error ? <InlineError error={closures.error} /> : !closures.data?.length ? <p className="catalog-status">No hay cierres futuros registrados.</p> : <div className="table-wrap"><table><thead><tr><th>FECHA</th><th>SERVICIO</th><th>MOTIVO</th><th>REGISTRADO POR</th><th>ACCIÓN</th></tr></thead><tbody>{closures.data.map((entry) => <tr key={String(entry.id)}><td>{formatDate(String(entry.serviceDate).slice(0, 10))}</td><td>{serviceName(String(entry.service))}</td><td>{String(entry.reason)}</td><td>{String(entry.createdByFirstName)} {String(entry.createdByLastName)}</td><td><button className="table-action danger-action" disabled={removeClosure.isPending} onClick={() => { if (window.confirm("¿Quitar este cierre? Las reservas volverán a habilitarse según su ventana habitual.")) void removeClosure.mutate({ id: String(entry.id) }); }}>Quitar</button></td></tr>)}</tbody></table></div>}
    </section>
  </>;
}

function CapacityConfigForm({ item, pending, onSave }: {
  item: Record<string, unknown>;
  pending: boolean;
  onSave: (values: { service: "ALMUERZO" | "CENA"; capacity: number; bookingOpensAt: string; bookingClosesAt: string; presentationDeadlineAt: string; bookingEnabled: boolean }) => void;
}) {
  const [capacity, setCapacity] = useState(String(item.capacity));
  const [opens, setOpens] = useState(String(item.bookingOpensAt));
  const [closes, setCloses] = useState(String(item.bookingClosesAt));
  const [deadline, setDeadline] = useState(String(item.presentationDeadlineAt));
  const [enabled, setEnabled] = useState(Boolean(item.bookingEnabled));
  return <form className="surface-card form-panel admin-form" onSubmit={(event) => { event.preventDefault(); onSave({ service: String(item.service) as "ALMUERZO" | "CENA", capacity: Number(capacity), bookingOpensAt: opens, bookingClosesAt: closes, presentationDeadlineAt: deadline, bookingEnabled: enabled }); }}>
    <div className="surface-heading"><h3>{serviceName(String(item.service))}</h3><label className="checkbox-field"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Habilitado</label></div>
    <label className="field">Cupo<input type="number" min="1" max="100000" required value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label>
    <div className="form-grid"><label className="field">Apertura<input type="time" required value={opens} onChange={(event) => setOpens(event.target.value)} /></label><label className="field">Cierre<input type="time" required value={closes} onChange={(event) => setCloses(event.target.value)} /></label></div>
    <label className="field">Límite para presentar ticket<input type="time" required value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
    <button className="button button-primary" disabled={pending}>Guardar {serviceName(String(item.service)).toLowerCase()}</button>
  </form>;
}

function Modal({ title, children, onClose, className = "" }: { title: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])");
    (firstFocusable ?? dialog)?.focus();
    return () => previousFocus?.focus();
  }, []);
  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
    ));
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={handleDialogKeyDown}><div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" aria-label="Cerrar ventana" onClick={onClose}><X size={18} /></button></div>{children}</section></div>;
}

function Status({ status }: { status: string }) {
  const key = status.toUpperCase();
  const map: Record<string, [string, string]> = {
    CONFIRMADA: ["Confirmada", "success"], CONFIRMADO: ["Confirmado", "success"],
    PENDIENTE: ["Pendiente", "warning"], PAGO_PENDIENTE: ["Pago pendiente", "warning"],
    PAGADO: ["Pagado", "success"], RECHAZADO: ["Rechazado", "danger"], APROBADA: ["Aprobada", "success"], APROBADO: ["Aprobado", "success"],
    RECHAZADA: ["Rechazada", "danger"], VENCIDA: ["Vencida", "muted"], DISPONIBLE: ["Disponible", "success"],
    BECA_COMPLETA: ["Beca completa", "success"], MEDIA_BECA: ["Media beca", "warning"], SIN_BECA: ["Sin beca", "muted"],
    CANCELADA: ["Cancelada", "muted"], CANCELADO: ["Cancelado", "muted"], VENCIDO: ["Vencido", "muted"], UTILIZADA: ["Utilizada", "blue"],
    UTILIZADO: ["Utilizado", "blue"], ABIERTO: ["Abierto", "warning"], EN_INVESTIGACION: ["En investigación", "blue"],
    RESUELTO: ["Resuelto", "success"], CERRADO: ["Cerrado", "muted"], BAJA: ["Baja", "muted"],
    MEDIA: ["Media", "warning"], ALTA: ["Alta", "warning"], CRITICA: ["Crítica", "danger"],
    SUCCESS: ["Correcto", "success"], DENIED: ["Denegado", "danger"], FAILURE: ["Error", "danger"]
  };
  const [label, style] = map[key] ?? [status, "muted"];
  return <span className={`status-chip status-${style}`} aria-label={`Estado: ${label}`}><i aria-hidden="true" />{label}</span>;
}

function DeadlineCountdown({ deadline }: { deadline: string | Date | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const countdown = formatDeadlineCountdown(deadline, now);
  return countdown
    ? <small className={`deadline-countdown ${countdown.expired ? "deadline-expired" : ""}`}><Clock3 size={12} /> Presentación: {countdown.label}</small>
    : null;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{text}</p></div>;
}

function LoadingRows() {
  return <div className="loading-rows" role="status" aria-label="Cargando"><i /><i /><i /></div>;
}

function InlineError({ error }: { error: { message: string; data?: { code?: string | null } | null } }) {
  return <div className="inline-error" role="alert">{friendlyError(error)}</div>;
}

function AccessDenied() {
  return <section className="surface-card"><EmptyState icon={<ShieldCheck size={22} />} title="Acceso denegado" text="Tu rol no tiene permiso para consultar este módulo." /></section>;
}

function NotFound() {
  return <div className="not-found"><span>404</span><h1>Esta página no existe</h1><p>La sección que buscás no está disponible para tu perfil.</p><Link className="button button-primary" href="/">Volver al inicio</Link></div>;
}

function SystemUnavailable({ error }: { error: string }) {
  return <main className="login-page"><section className="system-error-card"><span className="system-error-icon"><ShieldCheck size={26} /></span><span className="eyebrow">COMEDOR UNIVERSITARIO UNCA</span><h1>No pudimos conectar con el sistema</h1><p>{error || "Revisá la conexión con el servidor y la base de datos."}</p><button className="button button-primary" onClick={() => window.location.reload()}>Intentar nuevamente <ArrowRight size={16} /></button><small>Si el problema continúa, contactá al equipo administrador del comedor.</small></section></main>;
}

function serviceName(service: string) {
  return service === "ALMUERZO" ? "Almuerzo" : "Cena";
}

function startOfLocalWeek(date: string) {
  const weekStart = new Date(`${date}T12:00:00.000Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  return weekStart.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value.slice(0, 10)}T12:00:00`)).replace(".", "");
}

function googleCalendarEventUrl(date: string, service: string) {
  const normalized = date.slice(0, 10);
  const followingDay = new Date(`${normalized}T12:00:00.000Z`);
  followingDay.setUTCDate(followingDay.getUTCDate() + 1);
  const end = followingDay.toISOString().slice(0, 10).replaceAll("-", "");
  const start = normalized.replaceAll("-", "");
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: `${serviceName(service)} · Comedor Universitario UNCA`,
    dates: `${start}/${end}`,
    details: "Evento agregado manualmente desde Comedor UNCA. No implica sincronización automática de la cuenta.",
    location: "Comedor Universitario UNCA, Universidad Nacional de Catamarca"
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}

export default App;
