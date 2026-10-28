import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { config, isDemoMode, isGuestDemoMode } from "../config";
import { permissions, roles } from "../../shared/domain";
import { hashPassword } from "../auth/password";
import { pool } from "./index";
import { demoLoginAccountsForMode, initialPrices } from "./seed-data";
import { seedFoodCatalog } from "./food-catalog-seed";

if (!config.DB_USER) {
  throw new Error("Configurá DB_USER o DATABASE_URL con el usuario indicado por tu instalación de XAMPP.");
}

const connection = await pool.getConnection();
const demoUsers = [
  ["10000000-0000-4000-8000-000000000001", "Alma", "Estudiante", "ALUMNO"],
  ["10000000-0000-4000-8000-000000000002", "Dante", "Docente", "DOCENTE"],
  ["10000000-0000-4000-8000-000000000003", "Noa", "Administrativa", "NO_DOCENTE"],
  ["10000000-0000-4000-8000-000000000004", "Alex", "Invitado", "INVITADO_ESPECIAL"],
  ["10000000-0000-4000-8000-000000000005", "Ada", "Operadora", "ADMINISTRADOR_LOCAL"],
  ["10000000-0000-4000-8000-000000000006", "Sami", "Supervisión", "SUPERVISOR"]
] as const;

try {
  await connection.beginTransaction();
  for (const role of roles) {
    await connection.execute(
      "INSERT IGNORE INTO roles (code, label) VALUES (?, ?)",
      [role, role.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())]
    );
  }
  const descriptions: Record<keyof typeof permissions, string> = {
    "menu:read": "Consultar menús publicados",
    "reservations:create": "Crear reservas propias",
    "reservations:read:own": "Consultar reservas propias",
    "reservations:cancel:own": "Cancelar reservas propias",
    "reservations:read:all": "Consultar reservas operativas",
    "reservations:manage": "Administrar reservas",
    "menu:manage": "Administrar menú",
    "tickets:validate": "Validar tickets y registrar consumos",
    "reservations:approve": "Aprobar o rechazar reservas",
    "users:manage": "Administrar usuarios",
    "users:create": "Crear cuentas de usuario",
    "scholarships:manage": "Administrar becas y beneficios",
    "prices:manage": "Administrar tarifas",
    "payments:read": "Consultar referencias de pago",
    "payments:manage": "Revisar referencias de pago",
    "payments:cash:manage": "Abrir caja, registrar efectivo y cerrar jornada propia",
    "payments:reconcile": "Verificar acreditaciones y revisar cierres de caja",
    "payments:adjustments:manage": "Autorizar y registrar la ejecución de ajustes y devoluciones",
    "payments:export": "Exportar informes financieros",
    "users:read": "Consultar cuentas de usuario",
    "incidents:create": "Crear reportes",
    "incidents:read": "Consultar incidentes",
    "incidents:manage": "Gestionar incidentes",
    "audit:read": "Consultar auditoría",
    "statistics:read": "Consultar estadísticas operativas",
    "settings:manage": "Administrar configuración",
    "kitchen:read": "Consultar operación de cocina",
    "kitchen:manage": "Registrar producción de cocina"
  };
  for (const permission of Object.keys(permissions) as Array<keyof typeof permissions>) {
    await connection.execute(
      "INSERT IGNORE INTO permissions (code, description) VALUES (?, ?)",
      [permission, descriptions[permission]]
    );
    for (const role of permissions[permission]) {
      await connection.execute(
        "INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES (?, ?)",
        [role, permission]
      );
    }
  }
  await connection.execute(
    `INSERT IGNORE INTO service_capacity_config
     (service, capacity, booking_opens_at, booking_closes_at, presentation_deadline_at, booking_enabled)
     VALUES ('ALMUERZO',750,'08:00','11:00','13:00',TRUE),('CENA',750,'15:00','17:00','13:00',TRUE)`
  );
  await connection.execute(
    "INSERT IGNORE INTO scholarship_types (code, label) VALUES ('BECA_COMPLETA','Beca completa'),('MEDIA_BECA','Media beca'),('SIN_BECA','Sin beca')"
  );
  const catalogInserted = await seedFoodCatalog(connection);
  console.info(`Catálogo de alimentos verificado: ${catalogInserted} registros nuevos agregados.`);
  if (isDemoMode) {
    for (const [id, firstName, lastName, role] of demoUsers) {
      await connection.execute(
        `INSERT IGNORE INTO users (id, email, first_name, last_name, role, status, is_demo)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', TRUE)`,
        [id, `${String(role).toLowerCase()}@demo.comedor-unca.invalid`, firstName, lastName, role]
      );
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, email, role, is_demo AS isDemo FROM users WHERE id = ?",
        [id]
      );
      const expectedEmail = `${String(role).toLowerCase()}@demo.comedor-unca.invalid`;
      if (!rows[0] || rows[0].email !== expectedEmail || rows[0].role !== role || !Boolean(rows[0].isDemo)) {
        throw new Error(`No se creó el usuario DEMO ${role} porque su identificador o correo ya está ocupado. No se modificaron los datos existentes.`);
      }
    }
    for (const account of demoLoginAccountsForMode(isDemoMode)) {
      const passwordHash = await hashPassword(account.password);
      await connection.execute(
        `INSERT IGNORE INTO users
         (id, username, email, first_name, last_name, password_hash, role, status, is_demo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', TRUE)`,
        [account.id, account.username, account.email, account.firstName, account.lastName, passwordHash, account.role]
      );
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(`${today}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      const serviceDate = date.toISOString().slice(0, 10);
      for (const service of ["ALMUERZO", "CENA"] as const) {
        await connection.execute(
          `INSERT IGNORE INTO menu_entries (id, service_date, service, title, description, ingredients, published, created_by)
           VALUES (?, ?, ?, 'Menú DEMO · revisar antes de publicar', 'Contenido ilustrativo; confirmar con el equipo del comedor antes de producción.', 'Ingredientes de ejemplo', TRUE, ?)`,
          [randomUUID(), serviceDate, service, demoUsers[4][0]]
        );
      }
    }
    console.info("Entorno DEMO cargado con usuarios ficticios y menú de muestra.");
  } else if (isGuestDemoMode) {
    const [id, firstName, lastName, role] = demoUsers[3];
    const email = `${String(role).toLowerCase()}@demo.comedor-unca.invalid`;
    await connection.execute(
      `INSERT IGNORE INTO users (id, email, first_name, last_name, role, status, is_demo)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', TRUE)`,
      [id, email, firstName, lastName, role]
    );
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT id, email, role, is_demo AS isDemo FROM users WHERE id = ?",
      [id]
    );
    if (!rows[0] || rows[0].email !== email || rows[0].role !== role || !Boolean(rows[0].isDemo)) {
      throw new Error("No se pudo crear la cuenta demo de estudiante; el identificador ya está ocupado.");
    }
    console.info("Cuenta demo limitada a invitado verificada.");
  } else {
    console.info("Configuración operativa lista. DEMO_MODE está desactivado; no se crearon usuarios ni menús de muestra.");
  }
  const [priceRows] = await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM price_history");
  if (Number(priceRows[0]?.total ?? 0) === 0) {
    const validFrom = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
    for (const [role, scholarshipType, amount] of initialPrices) {
      await connection.execute(
        `INSERT INTO price_history (id, role, scholarship_type, amount, currency, valid_from)
         VALUES (?, ?, ?, ?, 'ARS', ?)`,
        [randomUUID(), role, scholarshipType, amount, validFrom]
      );
    }
  }
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await pool.end();
}
