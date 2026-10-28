import {
  mysqlTable, varchar, char, text, mediumtext, timestamp, datetime, date, int, decimal, mysqlEnum, boolean, json, uniqueIndex, index, primaryKey, foreignKey, check, customType
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { roles } from "../../shared/domain";
import type { AccessibilityPreferences } from "../../shared/accessibility";

const mediumBinary = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "mediumblob"
});

export const users = mysqlTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  googleSubject: varchar("google_subject", { length: 191 }).unique(),
  username: varchar("username", { length: 80 }).unique(),
  dni: varchar("dni", { length: 20 }).unique(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  accessibilityPreferences: json("accessibility_preferences").$type<AccessibilityPreferences>(),
  passwordHash: varchar("password_hash", { length: 255 }),
  role: mysqlEnum("role", roles).notNull().default("ALUMNO"),
  status: mysqlEnum("status", ["PENDING", "ACTIVE", "SUSPENDED"]).notNull().default("PENDING"),
  totpSecret: varchar("totp_secret", { length: 256 }),
  totpEnabledAt: timestamp("totp_enabled_at"),
  totpLastUsedStep: int("totp_last_used_step", { unsigned: true }),
  totpRecoveryCodes: json("totp_recovery_codes").$type<string[]>(),
  isDemo: boolean("is_demo").notNull().default(false),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
}, (table) => ({ roleStatus: index("ix_users_role_status").on(table.role, table.status) }));

export const profilePhotos = mysqlTable("profile_photos", {
  userId: varchar("user_id", { length: 36 }).primaryKey().references(() => users.id),
  mimeType: varchar("mime_type", { length: 20 }).notNull(),
  imageData: mediumBinary("image_data").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const reservations = mysqlTable("reservations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  dniSnapshot: varchar("dni_snapshot", { length: 20 }),
  roleSnapshot: mysqlEnum("role_snapshot", roles),
  serviceDate: date("service_date").notNull(),
  service: mysqlEnum("service", ["ALMUERZO", "CENA"]).notNull(),
  queueNumber: int("queue_number", { unsigned: true }),
  status: mysqlEnum("status", ["PENDIENTE", "CONFIRMADA", "PAGADA", "CANCELADA", "UTILIZADA", "VENCIDA"]).notNull().default("CONFIRMADA"),
  approvalStatus: mysqlEnum("approval_status", ["PENDIENTE", "APROBADA", "RECHAZADA"]).notNull().default("PENDIENTE"),
  approvalActorId: varchar("approval_actor_id", { length: 36 }).references(() => users.id),
  approvalRoleSnapshot: mysqlEnum("approval_role_snapshot", roles),
  approvalUpdatedAt: timestamp("approval_updated_at"),
  paymentStatus: mysqlEnum("payment_status", ["NO_REQUIERE_PAGO", "PENDIENTE", "PAGADO", "RECHAZADO"]).notNull().default("NO_REQUIERE_PAGO"),
  priceAmount: decimal("price_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  priceCurrency: varchar("price_currency", { length: 3 }).notNull().default("ARS"),
  scholarshipType: mysqlEnum("scholarship_type", ["BECA_COMPLETA", "MEDIA_BECA", "SIN_BECA"]),
  presentationDeadline: timestamp("presentation_deadline"),
  noShowAt: timestamp("no_show_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at")
}, (table) => ({
  userDateService: uniqueIndex("uq_reservation_user_date_service").on(table.userId, table.serviceDate, table.service),
  dateService: index("ix_reservation_date_service").on(table.serviceDate, table.service, table.status),
  userDate: index("ix_reservation_user_date").on(table.userId, table.serviceDate, table.status),
  queueNumber: uniqueIndex("uq_reservation_queue_number").on(table.serviceDate, table.service, table.queueNumber)
}));

export const reservationWaitlist = mysqlTable("reservation_waitlist", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  serviceDate: date("service_date").notNull(),
  service: mysqlEnum("service", ["ALMUERZO", "CENA"]).notNull(),
  status: mysqlEnum("status", ["WAITING", "OFFERED", "CLAIMED", "EXPIRED", "CANCELLED"]).notNull().default("WAITING"),
  offeredAt: timestamp("offered_at"),
  expiresAt: timestamp("expires_at"),
  reservationId: varchar("reservation_id", { length: 36 }).unique().references(() => reservations.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  claimedAt: timestamp("claimed_at"),
  cancelledAt: timestamp("cancelled_at")
}, (table) => ({
  slotOrder: index("ix_waitlist_slot_order").on(table.serviceDate, table.service, table.status, table.createdAt, table.id),
  userStatus: index("ix_waitlist_user_status").on(table.userId, table.status),
  offerExpiry: index("ix_waitlist_offer_expiry").on(table.status, table.expiresAt)
}));

export const tickets = mysqlTable("tickets", {
  id: varchar("id", { length: 36 }).primaryKey(),
  reservationId: varchar("reservation_id", { length: 36 }).notNull().unique().references(() => reservations.id),
  serviceDate: date("service_date").notNull(),
  service: mysqlEnum("service", ["ALMUERZO", "CENA"]).notNull(),
  dailyNumber: int("daily_number").notNull(),
  status: mysqlEnum("status", ["DISPONIBLE", "UTILIZADO", "VENCIDO", "CANCELADO"]).notNull().default("DISPONIBLE"),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  dailyUnique: uniqueIndex("uq_ticket_daily_number").on(table.serviceDate, table.service, table.dailyNumber),
  serviceDate: index("ix_ticket_service_date").on(table.serviceDate, table.service, table.status)
}));

export const comidas = mysqlTable("comidas", {
  id: char("id", { length: 3 }).primaryKey(),
  name: varchar("nombre", { length: 150 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 180 }).notNull().unique(),
  category: mysqlEnum("categoria", ["NUTRICIONAL", "CHATARRA"]).notNull(),
  mealService: mysqlEnum("tipo_comida", ["ALMUERZO", "CENA", "AMBOS"]).notNull(),
  description: text("descripcion").notNull(),
  ingredients: text("ingredientes").notNull(),
  preparation: text("preparacion").notNull(),
  portion: varchar("porcion", { length: 100 }).notNull(),
  calories: decimal("calorias", { precision: 8, scale: 2 }).notNull(),
  proteinGrams: decimal("proteinas", { precision: 8, scale: 2 }).notNull(),
  carbohydrateGrams: decimal("carbohidratos", { precision: 8, scale: 2 }).notNull(),
  fatGrams: decimal("grasas", { precision: 8, scale: 2 }).notNull(),
  fiberGrams: decimal("fibra", { precision: 8, scale: 2 }).notNull(),
  sodiumMilligrams: decimal("sodio", { precision: 8, scale: 2 }).notNull(),
  preparationMinutes: int("tiempo_preparacion", { unsigned: true }).notNull(),
  difficulty: mysqlEnum("dificultad", ["FACIL", "MEDIA", "ALTA"]).notNull(),
  estimatedCost: decimal("costo_estimado", { precision: 10, scale: 2 }).notNull(),
  currency: char("moneda", { length: 3 }).notNull().default("ARS"),
  suitableForCanteen: boolean("apta_comedor").notNull().default(true),
  observations: text("observaciones"),
  proteinSource: varchar("fuente_proteina", { length: 40 }).notNull(),
  cookingMethod: varchar("metodo_coccion", { length: 30 }).notNull(),
  vegetarian: boolean("vegetariana").notNull(),
  containsMeat: boolean("contiene_carne").notNull(),
  containsFish: boolean("contiene_pescado").notNull(),
  containsLegumes: boolean("contiene_legumbres").notNull(),
  active: boolean("activa").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
}, (table) => ({
  category: index("ix_comidas_categoria").on(table.category, table.active),
  mealService: index("ix_comidas_tipo_comida").on(table.mealService, table.active),
  canteen: index("ix_comidas_apta_comedor").on(table.suitableForCanteen, table.active),
  calories: index("ix_comidas_calorias").on(table.calories),
  protein: index("ix_comidas_proteinas").on(table.proteinGrams),
  cost: index("ix_comidas_costo").on(table.estimatedCost),
  difficultyTime: index("ix_comidas_dificultad_tiempo").on(table.difficulty, table.preparationMinutes),
  proteinSource: index("ix_comidas_fuente_proteina").on(table.proteinSource),
  dietary: index("ix_comidas_filtros_dieteticos").on(table.vegetarian, table.containsMeat, table.containsFish, table.containsLegumes)
}));

export const menuEntries = mysqlTable("menu_entries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  serviceDate: date("service_date").notNull(),
  service: mysqlEnum("service", ["ALMUERZO", "CENA"]).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description"),
  ingredients: text("ingredients"),
  mainDish: text("main_dish"),
  sideDish: text("side_dish"),
  salad: text("salad"),
  dessert: text("dessert"),
  drink: text("drink"),
  bread: text("bread"),
  nutritionalInformation: text("nutritional_information"),
  notes: text("notes"),
  published: boolean("published").notNull().default(false),
  createdBy: varchar("created_by", { length: 36 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
}, (table) => ({
  dateService: uniqueIndex("uq_menu_date_service").on(table.serviceDate, table.service),
  publishedDate: index("ix_menu_published_date").on(table.published, table.serviceDate)
}));

export const foodCategories = mysqlTable("food_categories", {
  code: varchar("code", { length: 40 }).primaryKey(),
  label: varchar("label", { length: 80 }).notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const foodAllergens = mysqlTable("food_allergens", {
  code: varchar("code", { length: 40 }).primaryKey(),
  label: varchar("label", { length: 80 }).notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const foods = mysqlTable("foods", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 180 }).notNull().unique(),
  categoryCode: varchar("category_code", { length: 40 }).notNull().references(() => foodCategories.code),
  subcategory: varchar("subcategory", { length: 80 }),
  foodType: varchar("food_type", { length: 40 }).notNull().default("ALIMENTO"),
  description: text("description"),
  sinTacc: boolean("sin_tacc"),
  vegan: boolean("vegan"),
  vegetarian: boolean("vegetarian"),
  allergensVerified: boolean("allergens_verified").notNull().default(false),
  calories: decimal("calories", { precision: 8, scale: 2 }),
  proteinGrams: decimal("protein_grams", { precision: 8, scale: 2 }),
  carbohydrateGrams: decimal("carbohydrate_grams", { precision: 8, scale: 2 }),
  fatGrams: decimal("fat_grams", { precision: 8, scale: 2 }),
  fiberGrams: decimal("fiber_grams", { precision: 8, scale: 2 }),
  sodiumMilligrams: decimal("sodium_milligrams", { precision: 8, scale: 2 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
}, (table) => ({
  categoryActive: index("ix_food_category_active").on(table.categoryCode, table.active),
  name: index("ix_food_name").on(table.name)
}));

export const foodAllergenLinks = mysqlTable("food_allergen_links", {
  foodId: varchar("food_id", { length: 36 }).notNull().references(() => foods.id, { onDelete: "cascade" }),
  allergenCode: varchar("allergen_code", { length: 40 }).notNull().references(() => foodAllergens.code),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  foodAllergen: primaryKey({ columns: [table.foodId, table.allergenCode], name: "pk_food_allergen" }),
  allergenFood: index("ix_food_allergen_code").on(table.allergenCode, table.foodId)
}));

export const menuEntryItems = mysqlTable("menu_entry_items", {
  id: varchar("id", { length: 36 }).primaryKey(),
  menuEntryId: varchar("menu_entry_id", { length: 36 }).notNull().references(() => menuEntries.id, { onDelete: "cascade" }),
  foodId: varchar("food_id", { length: 36 }).notNull().references(() => foods.id),
  foodNameSnapshot: varchar("food_name_snapshot", { length: 160 }).notNull(),
  component: varchar("component", { length: 80 }).notNull(),
  sortOrder: int("sort_order", { unsigned: true }).notNull().default(0),
  sinTaccSnapshot: boolean("sin_tacc_snapshot"),
  veganSnapshot: boolean("vegan_snapshot"),
  vegetarianSnapshot: boolean("vegetarian_snapshot"),
  allergensVerifiedSnapshot: boolean("allergens_verified_snapshot").notNull().default(false),
  allergensSnapshot: json("allergens_snapshot").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  menuOrder: index("ix_menu_entry_item_order").on(table.menuEntryId, table.component, table.sortOrder),
  food: index("ix_menu_entry_item_food").on(table.foodId)
}));

export const priceHistory = mysqlTable("price_history", {
  id: varchar("id", { length: 36 }).primaryKey(),
  role: mysqlEnum("role", roles).notNull(),
  scholarshipType: mysqlEnum("scholarship_type", ["BECA_COMPLETA", "MEDIA_BECA", "SIN_BECA"]),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("ARS"),
  validFrom: date("valid_from").notNull(),
  validUntil: date("valid_until"),
  changedBy: varchar("changed_by", { length: 36 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  roleValidity: index("ix_price_role_validity").on(table.role, table.validFrom, table.validUntil),
  nonNegativeAmount: check("chk_price_amount", sql`${table.amount} >= 0`),
  validDateRange: check("chk_price_validity", sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom}`)
}));

export const incidents = mysqlTable("incidents", {
  id: varchar("id", { length: 36 }).primaryKey(),
  createdBy: varchar("created_by", { length: 36 }).notNull().references(() => users.id),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description").notNull(),
  severity: mysqlEnum("severity", ["BAJA", "MEDIA", "ALTA", "CRITICA"]).notNull().default("MEDIA"),
  status: mysqlEnum("status", ["ABIERTO", "EN_INVESTIGACION", "RESUELTO", "CERRADO"]).notNull().default("ABIERTO"),
  assignedTo: varchar("assigned_to", { length: 36 }).references(() => users.id),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
}, (table) => ({ statusCreated: index("ix_incident_status_created").on(table.status, table.createdAt) }));

export const notifications = mysqlTable("notifications", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({ userCreated: index("ix_notification_user_created").on(table.userId, table.createdAt) }));

export const auditLogs = mysqlTable("audit_logs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  actorId: varchar("actor_id", { length: 36 }).references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  resourceType: varchar("resource_type", { length: 80 }).notNull(),
  resourceId: varchar("resource_id", { length: 36 }),
  outcome: mysqlEnum("outcome", ["SUCCESS", "DENIED", "FAILURE"]).notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  actionCreated: index("ix_audit_action_created").on(table.action, table.createdAt),
  actorCreated: index("ix_audit_actor_created").on(table.actorId, table.createdAt)
}));

export const serviceCapacityConfig = mysqlTable("service_capacity_config", {
  service: mysqlEnum("service", ["ALMUERZO", "CENA"]).primaryKey(),
  capacity: int("capacity").notNull().default(750),
  bookingOpensAt: varchar("booking_opens_at", { length: 5 }).notNull().default("08:00"),
  bookingClosesAt: varchar("booking_closes_at", { length: 5 }).notNull().default("11:00"),
  presentationDeadlineAt: varchar("presentation_deadline_at", { length: 5 }).notNull().default("13:00"),
  bookingEnabled: boolean("booking_enabled").notNull().default(true)
}, (table) => ({ positiveCapacity: check("chk_service_capacity_positive", sql`${table.capacity} > 0`) }));

export const serviceClosures = mysqlTable("service_closures", {
  id: varchar("id", { length: 36 }).primaryKey(),
  serviceDate: date("service_date").notNull(),
  service: mysqlEnum("service", ["ALMUERZO", "CENA"]).notNull(),
  reason: varchar("reason", { length: 250 }).notNull(),
  createdBy: varchar("created_by", { length: 36 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  dateService: uniqueIndex("uq_service_closure_date_service").on(table.serviceDate, table.service),
  serviceDateIndex: index("ix_service_closure_date").on(table.serviceDate, table.service)
}));

export const capacitySlots = mysqlTable("capacity_slots", {
  serviceDate: date("service_date").notNull(),
  service: mysqlEnum("service", ["ALMUERZO", "CENA"]).notNull(),
  capacity: int("capacity").notNull(),
  booked: int("booked").notNull().default(0),
  nextTicketNumber: int("next_ticket_number").notNull().default(1)
}, (table) => ({
  primary: primaryKey({ name: "pk_capacity_slot", columns: [table.serviceDate, table.service] }),
  validCounts: check("chk_capacity_slot_bounds", sql`${table.booked} >= 0 AND ${table.booked} <= ${table.capacity}`),
  validTicketNumber: check("chk_ticket_counter_positive", sql`${table.nextTicketNumber} > 0`)
}));

export const kitchenProduction = mysqlTable("kitchen_production", {
  id: varchar("id", { length: 36 }).primaryKey(),
  serviceDate: date("service_date").notNull(),
  service: mysqlEnum("service", ["ALMUERZO", "CENA"]).notNull(),
  producedPortions: int("produced_portions").notNull().default(0),
  notes: text("notes"),
  updatedBy: varchar("updated_by", { length: 36 }).notNull().references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
}, (table) => ({
  dateService: uniqueIndex("uq_kitchen_production_date_service").on(table.serviceDate, table.service),
  nonNegativeProduction: check("chk_kitchen_produced_nonnegative", sql`${table.producedPortions} >= 0`)
}));

export const roleRecords = mysqlTable("roles", {
  code: mysqlEnum("code", roles).primaryKey(),
  label: varchar("label", { length: 80 }).notNull()
});

export const permissions = mysqlTable("permissions", {
  code: varchar("code", { length: 80 }).primaryKey(),
  description: varchar("description", { length: 180 }).notNull()
});

export const rolePermissions = mysqlTable("role_permissions", {
  roleCode: mysqlEnum("role_code", roles).notNull().references(() => roleRecords.code),
  permissionCode: varchar("permission_code", { length: 80 }).notNull().references(() => permissions.code)
}, (table) => ({ primary: primaryKey({ columns: [table.roleCode, table.permissionCode] }) }));

export const menuHistory = mysqlTable("menu_history", {
  id: varchar("id", { length: 36 }).primaryKey(),
  menuEntryId: varchar("menu_entry_id", { length: 36 }).notNull().references(() => menuEntries.id),
  actorId: varchar("actor_id", { length: 36 }).notNull().references(() => users.id),
  action: varchar("action", { length: 40 }).notNull(),
  snapshot: json("snapshot").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({ entryDate: index("ix_menu_history_entry_date").on(table.menuEntryId, table.createdAt) }));

export const benefits = mysqlTable("benefits", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["PENDIENTE", "APROBADO", "RECHAZADO", "VENCIDO"]).notNull().default("PENDIENTE"),
  validFrom: date("valid_from"),
  validUntil: date("valid_until"),
  approvedBy: varchar("approved_by", { length: 36 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({ userStatus: index("ix_benefit_user_status").on(table.userId, table.status) }));

export const scholarships = mysqlTable("scholarships", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  scholarshipType: varchar("scholarship_type", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["PENDIENTE", "APROBADA", "RECHAZADA", "VENCIDA"]).notNull().default("PENDIENTE"),
  validFrom: date("valid_from"),
  validUntil: date("valid_until"),
  documentationReference: varchar("documentation_reference", { length: 500 }),
  reviewedBy: varchar("reviewed_by", { length: 36 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
}, (table) => ({ userStatus: index("ix_scholarship_user_status").on(table.userId, table.status) }));

export const foodCreditRequests = mysqlTable("food_credit_requests", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  reservationId: varchar("reservation_id", { length: 36 }),
  serviceDate: date("service_date"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull().default("0"),
  reason: text("reason"),
  creditKey: varchar("credit_key", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["PENDIENTE", "APROBADA", "RECHAZADA", "UTILIZADA", "VENCIDA"]).notNull().default("PENDIENTE"),
  reviewedBy: varchar("reviewed_by", { length: 36 }).references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
}, (table) => ({
  userStatus: index("ix_food_credit_user_status").on(table.userId, table.status),
  uniqueKey: uniqueIndex("uq_food_credit_key").on(table.creditKey)
}));

export const foodCreditMovements = mysqlTable("food_credit_movements", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  requestId: varchar("request_id", { length: 36 }).notNull().references(() => foodCreditRequests.id),
  entryType: mysqlEnum("entry_type", ["CREADO", "APROBADO", "RECHAZADO", "UTILIZADO"]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  userCreated: index("ix_food_credit_movement_user_created").on(table.userId, table.createdAt)
}));

export const paymentReferences = mysqlTable("payment_references", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  reservationId: varchar("reservation_id", { length: 36 }).unique().references(() => reservations.id),
  provider: varchar("provider", { length: 60 }).notNull(),
  providerReference: varchar("provider_reference", { length: 191 }).notNull(),
  method: varchar("method", { length: 60 }).notNull().default("REFERENCIA_EXTERNA"),
  proofMimeType: varchar("proof_mime_type", { length: 20 }),
  proofImage: mediumBinary("proof_image"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("ARS"),
  status: mysqlEnum("status", ["PENDIENTE", "APROBADO", "RECHAZADO", "REEMBOLSADO"]).notNull().default("PENDIENTE"),
  reviewedBy: varchar("reviewed_by", { length: 36 }).references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  providerReference: uniqueIndex("uq_payment_provider_method_reference").on(table.provider, table.method, table.providerReference),
  userDate: index("ix_payment_user_date").on(table.userId, table.createdAt)
}));

export const paymentReferenceReservations = mysqlTable("payment_reference_reservations", {
  paymentReferenceId: varchar("payment_reference_id", { length: 36 }).notNull(),
  reservationId: varchar("reservation_id", { length: 36 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  primary: primaryKey({ name: "pk_payment_ref_reservation", columns: [table.paymentReferenceId, table.reservationId] }),
  paymentReference: foreignKey({
    name: "fk_payment_ref_reservation_payment",
    columns: [table.paymentReferenceId],
    foreignColumns: [paymentReferences.id]
  }).onDelete("cascade"),
  reservationReference: foreignKey({
    name: "fk_payment_ref_reservation_reservation",
    columns: [table.reservationId],
    foreignColumns: [reservations.id]
  }).onDelete("cascade"),
  reservation: index("ix_payment_reference_reservations_reservation_id").on(table.reservationId)
}));

export const paymentAllocations = mysqlTable("payment_allocations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  paymentReferenceId: varchar("payment_reference_id", { length: 36 }).notNull(),
  reservationId: varchar("reservation_id", { length: 36 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  allocatedBy: varchar("allocated_by", { length: 36 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  paymentReservation: uniqueIndex("uq_payment_allocation_payment_reservation").on(table.paymentReferenceId, table.reservationId),
  reservationCreated: index("ix_payment_allocation_reservation_created").on(table.reservationId, table.createdAt),
  paymentReference: foreignKey({ name: "fk_fin_alloc_payment", columns: [table.paymentReferenceId], foreignColumns: [paymentReferences.id] }),
  reservationReference: foreignKey({ name: "fk_fin_alloc_reservation", columns: [table.reservationId], foreignColumns: [reservations.id] }),
  actorReference: foreignKey({ name: "fk_fin_alloc_actor", columns: [table.allocatedBy], foreignColumns: [users.id] }),
  nonNegativeAmount: check("chk_payment_allocation_amount", sql`${table.amount} > 0`)
}));

export const paymentFinanceEvents = mysqlTable("payment_finance_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  paymentReferenceId: varchar("payment_reference_id", { length: 36 }).notNull(),
  eventType: mysqlEnum("event_type", [
    "COMPROBANTE_PRESENTADO", "DOCUMENTACION_VERIFICADA", "DOCUMENTACION_RECHAZADA",
    "ACREDITACION_CONFIRMADA", "DIFERENCIA_DETECTADA", "COBRO_EFECTIVO",
    "DEVOLUCION_SOLICITADA", "DEVOLUCION_AUTORIZADA", "DEVOLUCION_EJECUTADA",
    "DEVOLUCION_RECHAZADA", "AJUSTE_REGISTRADO"
  ]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 3 }),
  reference: varchar("reference", { length: 191 }),
  note: text("note"),
  actorId: varchar("actor_id", { length: 36 }).notNull(),
  createdAt: timestamp("created_at", { fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`)
}, (table) => ({
  paymentCreated: index("ix_payment_finance_event_payment_created").on(table.paymentReferenceId, table.createdAt),
  actorCreated: index("ix_payment_finance_event_actor_created").on(table.actorId, table.createdAt),
  paymentReference: foreignKey({ name: "fk_fin_event_payment", columns: [table.paymentReferenceId], foreignColumns: [paymentReferences.id] }),
  actorReference: foreignKey({ name: "fk_fin_event_actor", columns: [table.actorId], foreignColumns: [users.id] }),
  nonNegativeAmount: check("chk_payment_finance_event_amount", sql`${table.amount} IS NULL OR ${table.amount} >= 0`)
}));

export const paymentEvidence = mysqlTable("payment_evidence", {
  id: varchar("id", { length: 36 }).primaryKey(),
  paymentReferenceId: varchar("payment_reference_id", { length: 36 }).notNull(),
  submittedBy: varchar("submitted_by", { length: 36 }).notNull(),
  providerReference: varchar("provider_reference", { length: 191 }).notNull(),
  method: varchar("method", { length: 60 }).notNull(),
  declaredAmount: decimal("declared_amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  mimeType: varchar("mime_type", { length: 20 }).notNull(),
  imageData: mediumBinary("image_data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  paymentCreated: index("ix_payment_evidence_payment_created").on(table.paymentReferenceId, table.createdAt),
  submitterCreated: index("ix_payment_evidence_submitter_created").on(table.submittedBy, table.createdAt),
  paymentReference: foreignKey({ name: "fk_fin_evidence_payment", columns: [table.paymentReferenceId], foreignColumns: [paymentReferences.id] }),
  submitterReference: foreignKey({ name: "fk_fin_evidence_submitter", columns: [table.submittedBy], foreignColumns: [users.id] }),
  nonNegativeAmount: check("chk_payment_evidence_amount", sql`${table.declaredAmount} >= 0`)
}));

export const financeAdjustments = mysqlTable("finance_adjustments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  paymentReferenceId: varchar("payment_reference_id", { length: 36 }).notNull(),
  adjustmentType: mysqlEnum("adjustment_type", ["DEVOLUCION", "AJUSTE", "ANULACION"]).notNull(),
  status: mysqlEnum("status", ["SOLICITADA", "AUTORIZADA", "EJECUTADA", "RECHAZADA", "APLICADA"]).notNull().default("SOLICITADA"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  reason: text("reason").notNull(),
  requestedBy: varchar("requested_by", { length: 36 }).notNull(),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  authorizedBy: varchar("authorized_by", { length: 36 }),
  authorizedAt: datetime("authorized_at"),
  executedBy: varchar("executed_by", { length: 36 }),
  executedAt: datetime("executed_at"),
  executionReference: varchar("execution_reference", { length: 191 }),
  executionNote: text("execution_note")
}, (table) => ({
  paymentCreated: index("ix_finance_adjustment_payment_created").on(table.paymentReferenceId, table.requestedAt),
  statusCreated: index("ix_finance_adjustment_status_created").on(table.status, table.requestedAt),
  paymentReference: foreignKey({ name: "fk_fin_adj_payment", columns: [table.paymentReferenceId], foreignColumns: [paymentReferences.id] }),
  requestedByReference: foreignKey({ name: "fk_fin_adj_requester", columns: [table.requestedBy], foreignColumns: [users.id] }),
  authorizedByReference: foreignKey({ name: "fk_fin_adj_authorizer", columns: [table.authorizedBy], foreignColumns: [users.id] }),
  executedByReference: foreignKey({ name: "fk_fin_adj_executor", columns: [table.executedBy], foreignColumns: [users.id] }),
  nonNegativeAmount: check("chk_finance_adjustment_amount", sql`${table.amount} > 0`)
}));

export const cashShifts = mysqlTable("cash_shifts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  activeOperatorId: varchar("active_operator_id", { length: 36 }).unique().references(() => users.id),
  openedBy: varchar("opened_by", { length: 36 }).notNull().references(() => users.id),
  openingBalance: decimal("opening_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  openingNote: text("opening_note"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  status: mysqlEnum("status", ["ABIERTA", "CERRADA"]).notNull().default("ABIERTA"),
  closedBy: varchar("closed_by", { length: 36 }).references(() => users.id),
  closedAt: datetime("closed_at"),
  expectedCash: decimal("expected_cash", { precision: 10, scale: 2 }),
  countedCash: decimal("counted_cash", { precision: 10, scale: 2 }),
  difference: decimal("difference", { precision: 10, scale: 2 }),
  closeNote: text("close_note"),
  reviewedBy: varchar("reviewed_by", { length: 36 }).references(() => users.id),
  reviewedAt: datetime("reviewed_at")
}, (table) => ({
  statusOpened: index("ix_cash_shift_status_opened").on(table.status, table.openedAt),
  operatorOpened: index("ix_cash_shift_operator_opened").on(table.openedBy, table.openedAt),
  nonNegativeOpening: check("chk_cash_shift_opening_balance", sql`${table.openingBalance} >= 0`),
  nonNegativeCounted: check("chk_cash_shift_counted_cash", sql`${table.countedCash} IS NULL OR ${table.countedCash} >= 0`)
}));

export const cashReceipts = mysqlTable("cash_receipts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  receiptNumber: int("receipt_number").autoincrement().notNull().unique(),
  cashShiftId: varchar("cash_shift_id", { length: 36 }).notNull().references(() => cashShifts.id),
  paymentReferenceId: varchar("payment_reference_id", { length: 36 }).notNull().unique().references(() => paymentReferences.id),
  receivedBy: varchar("received_by", { length: 36 }).notNull().references(() => users.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  note: text("note"),
  status: mysqlEnum("status", ["CONFIRMADO", "ANULADO"]).notNull().default("CONFIRMADO"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  voidedBy: varchar("voided_by", { length: 36 }).references(() => users.id),
  voidedAt: datetime("voided_at"),
  voidReason: text("void_reason")
}, (table) => ({
  shiftReceived: index("ix_cash_receipt_shift_received").on(table.cashShiftId, table.receivedAt),
  receiverReceived: index("ix_cash_receipt_receiver_received").on(table.receivedBy, table.receivedAt),
  nonNegativeAmount: check("chk_cash_receipt_amount", sql`${table.amount} > 0`)
}));

export const scholarshipTypes = mysqlTable("scholarship_types", {
  code: mysqlEnum("code", ["BECA_COMPLETA", "MEDIA_BECA", "SIN_BECA"]).primaryKey(),
  label: varchar("label", { length: 80 }).notNull()
});

export const ticketScans = mysqlTable("ticket_scans", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ticketId: varchar("ticket_id", { length: 36 }).references(() => tickets.id),
  reservationId: varchar("reservation_id", { length: 36 }),
  operatorId: varchar("operator_id", { length: 36 }).notNull().references(() => users.id),
  result: mysqlEnum("result", ["VALID", "ALREADY_USED", "EXPIRED", "CANCELLED", "INVALID"]).notNull(),
  scannedAt: timestamp("scanned_at").notNull().defaultNow()
}, (table) => ({
  ticketDate: index("ix_ticket_scans_ticket_date").on(table.ticketId, table.scannedAt),
  operatorDate: index("ix_ticket_scans_operator_date").on(table.operatorId, table.scannedAt)
}));

export const appSettings = mysqlTable("app_settings", {
  settingKey: varchar("setting_key", { length: 100 }).primaryKey(),
  settingValue: varchar("setting_value", { length: 255 }).notNull(),
  updatedBy: varchar("updated_by", { length: 36 }).references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const carouselPhotos = mysqlTable("carousel_photos", {
  id: varchar("id", { length: 36 }).primaryKey(),
  caption: varchar("caption", { length: 100 }).notNull(),
  mimeType: varchar("mime_type", { length: 20 }).notNull(),
  imageData: mediumBinary("image_data").notNull(),
  createdBy: varchar("created_by", { length: 36 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  createdAt: index("ix_carousel_photos_created_at").on(table.createdAt, table.id)
}));

export const eventsNews = mysqlTable("events_news", {
  id: varchar("id", { length: 36 }).primaryKey(),
  type: mysqlEnum("type", ["NOTICIA", "COMUNICADO", "EVENTO"]).notNull(),
  visibility: mysqlEnum("visibility", ["PUBLICO", "PRIVADO"]).notNull().default("PUBLICO"),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body").notNull(),
  eventDate: date("event_date"),
  startTime: varchar("start_time", { length: 5 }),
  endTime: varchar("end_time", { length: 5 }),
  location: varchar("location", { length: 180 }),
  eventStatus: mysqlEnum("event_status", ["PROGRAMADO", "REALIZADO", "CANCELADO"]).notNull().default("PROGRAMADO"),
  published: boolean("published").notNull().default(false),
  createdBy: varchar("created_by", { length: 36 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
}, (table) => ({
  publishedCreated: index("ix_events_news_published_created").on(table.published, table.createdAt),
  eventDate: index("ix_events_news_event_date").on(table.eventDate, table.eventStatus)
}));

export const eventsNewsPhotos = mysqlTable("events_news_photos", {
  id: varchar("id", { length: 36 }).primaryKey(),
  entryId: varchar("entry_id", { length: 36 }).notNull().references(() => eventsNews.id, { onDelete: "cascade" }),
  mimeType: varchar("mime_type", { length: 20 }).notNull(),
  imageData: mediumBinary("image_data").notNull(),
  createdBy: varchar("created_by", { length: 36 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  entryCreated: index("ix_events_news_photos_entry_created").on(table.entryId, table.createdAt)
}));

export const idempotencyKeys = mysqlTable("idempotency_keys", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  operation: varchar("operation", { length: 80 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
  response: json("response"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  operationKey: uniqueIndex("uq_idempotency_operation").on(table.userId, table.operation, table.idempotencyKey)
}));

const binaryCollatedSessionId = customType<{ data: string }>({
  dataType: () => "varchar(128) COLLATE utf8mb4_bin"
});
const unsignedSessionExpiry = customType<{ data: number }>({
  dataType: () => "int unsigned"
});

export const sessions = mysqlTable("sessions", {
  sessionId: binaryCollatedSessionId("session_id").primaryKey(),
  expires: unsignedSessionExpiry("expires").notNull(),
  data: mediumtext("data")
}, (table) => ({ expiry: index("ix_sessions_expiry").on(table.expires) }));
