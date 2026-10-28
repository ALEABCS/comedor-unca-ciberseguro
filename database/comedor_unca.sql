CREATE DATABASE IF NOT EXISTS basecomedorunca2026 CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE basecomedorunca2026;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  google_subject VARCHAR(191) NULL UNIQUE,
  username VARCHAR(80) NULL UNIQUE,
  dni VARCHAR(20) NULL UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30) NULL,
  accessibility_preferences JSON NULL,
  password_hash VARCHAR(255) NULL,
  role ENUM('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NOT NULL DEFAULT 'ALUMNO',
  status ENUM('PENDING','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  totp_secret VARCHAR(256) NULL,
  totp_enabled_at TIMESTAMP NULL DEFAULT NULL,
  totp_last_used_step INT UNSIGNED NULL,
  totp_recovery_codes JSON NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_users_role_status (role, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roles (
  code ENUM('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NOT NULL PRIMARY KEY,
  label VARCHAR(80) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  code VARCHAR(80) NOT NULL PRIMARY KEY,
  description VARCHAR(180) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code ENUM('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NOT NULL,
  permission_code VARCHAR(80) NOT NULL,
  PRIMARY KEY (role_code, permission_code),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_code) REFERENCES roles(code),
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_code) REFERENCES permissions(code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservations (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  dni_snapshot VARCHAR(20) NULL,
  role_snapshot ENUM('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NULL,
  service_date DATE NOT NULL,
  service ENUM('ALMUERZO','CENA') NOT NULL,
  status ENUM('PENDIENTE','CONFIRMADA','PAGADA','CANCELADA','UTILIZADA','VENCIDA') NOT NULL DEFAULT 'CONFIRMADA',
  approval_status ENUM('PENDIENTE','APROBADA','RECHAZADA') NOT NULL DEFAULT 'PENDIENTE',
  approval_actor_id VARCHAR(36) NULL,
  approval_role_snapshot ENUM('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NULL,
  approval_updated_at TIMESTAMP NULL DEFAULT NULL,
  payment_status ENUM('NO_REQUIERE_PAGO','PENDIENTE','PAGADO','RECHAZADO') NOT NULL DEFAULT 'NO_REQUIERE_PAGO',
  price_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  price_currency CHAR(3) NOT NULL DEFAULT 'ARS',
  scholarship_type ENUM('BECA_COMPLETA','MEDIA_BECA','SIN_BECA') NULL,
  presentation_deadline TIMESTAMP NULL DEFAULT NULL,
  no_show_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_reservation_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_reservation_approval_actor FOREIGN KEY (approval_actor_id) REFERENCES users(id),
  CONSTRAINT uq_reservation_user_date_service UNIQUE (user_id, service_date, service),
  KEY ix_reservation_date_service (service_date, service, status),
  KEY ix_reservation_user_date (user_id, service_date, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservation_waitlist (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  service_date DATE NOT NULL,
  service ENUM('ALMUERZO','CENA') NOT NULL,
  status ENUM('WAITING','OFFERED','CLAIMED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'WAITING',
  offered_at TIMESTAMP NULL DEFAULT NULL,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  reservation_id VARCHAR(36) NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TIMESTAMP NULL DEFAULT NULL,
  cancelled_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_waitlist_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_waitlist_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  KEY ix_waitlist_slot_order (service_date, service, status, created_at, id),
  KEY ix_waitlist_user_status (user_id, status),
  KEY ix_waitlist_offer_expiry (status, expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS service_capacity_config (
  service ENUM('ALMUERZO','CENA') NOT NULL PRIMARY KEY,
  capacity INT NOT NULL DEFAULT 750,
  booking_opens_at VARCHAR(5) NOT NULL DEFAULT '08:00',
  booking_closes_at VARCHAR(5) NOT NULL DEFAULT '11:00',
  presentation_deadline_at VARCHAR(5) NOT NULL DEFAULT '13:00',
  booking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_service_capacity_positive CHECK (capacity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS capacity_slots (
  service_date DATE NOT NULL,
  service ENUM('ALMUERZO','CENA') NOT NULL,
  capacity INT NOT NULL,
  booked INT NOT NULL DEFAULT 0,
  next_ticket_number INT NOT NULL DEFAULT 1,
  PRIMARY KEY (service_date, service),
  CONSTRAINT chk_capacity_slot_bounds CHECK (booked >= 0 AND booked <= capacity),
  CONSTRAINT chk_ticket_counter_positive CHECK (next_ticket_number > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS kitchen_production (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  service_date DATE NOT NULL,
  service ENUM('ALMUERZO','CENA') NOT NULL,
  produced_portions INT NOT NULL DEFAULT 0,
  notes TEXT NULL,
  updated_by VARCHAR(36) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_kitchen_production_user FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT uq_kitchen_production_date_service UNIQUE (service_date, service),
  CONSTRAINT chk_kitchen_produced_nonnegative CHECK (produced_portions >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tickets (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  reservation_id VARCHAR(36) NOT NULL UNIQUE,
  service_date DATE NOT NULL,
  service ENUM('ALMUERZO','CENA') NOT NULL,
  daily_number INT NOT NULL,
  status ENUM('DISPONIBLE','UTILIZADO','VENCIDO','CANCELADO') NOT NULL DEFAULT 'DISPONIBLE',
  consumed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT uq_ticket_daily_number UNIQUE (service_date, service, daily_number),
  KEY ix_ticket_service_date (service_date, service, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS menu_entries (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  service_date DATE NOT NULL,
  service ENUM('ALMUERZO','CENA') NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  ingredients TEXT NULL,
  main_dish TEXT NULL,
  side_dish TEXT NULL,
  salad TEXT NULL,
  dessert TEXT NULL,
  drink TEXT NULL,
  bread TEXT NULL,
  nutritional_information TEXT NULL,
  notes TEXT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_menu_author FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT uq_menu_date_service UNIQUE (service_date, service),
  KEY ix_menu_published_date (published, service_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS food_categories (
  code VARCHAR(40) NOT NULL PRIMARY KEY,
  label VARCHAR(80) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS food_allergens (
  code VARCHAR(40) NOT NULL PRIMARY KEY,
  label VARCHAR(80) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS foods (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  normalized_name VARCHAR(180) NOT NULL UNIQUE,
  category_code VARCHAR(40) NOT NULL,
  subcategory VARCHAR(80) NULL,
  food_type VARCHAR(40) NOT NULL DEFAULT 'ALIMENTO',
  description TEXT NULL,
  sin_tacc BOOLEAN NULL,
  vegan BOOLEAN NULL,
  vegetarian BOOLEAN NULL,
  allergens_verified BOOLEAN NOT NULL DEFAULT FALSE,
  calories DECIMAL(8,2) NULL,
  protein_grams DECIMAL(8,2) NULL,
  carbohydrate_grams DECIMAL(8,2) NULL,
  fat_grams DECIMAL(8,2) NULL,
  fiber_grams DECIMAL(8,2) NULL,
  sodium_milligrams DECIMAL(8,2) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_food_category FOREIGN KEY (category_code) REFERENCES food_categories(code),
  KEY ix_food_category_active (category_code, active),
  KEY ix_food_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS food_allergen_links (
  food_id VARCHAR(36) NOT NULL,
  allergen_code VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (food_id, allergen_code),
  CONSTRAINT fk_food_allergen_food FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE CASCADE,
  CONSTRAINT fk_food_allergen_allergen FOREIGN KEY (allergen_code) REFERENCES food_allergens(code),
  KEY ix_food_allergen_code (allergen_code, food_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS menu_entry_items (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  menu_entry_id VARCHAR(36) NOT NULL,
  food_id VARCHAR(36) NOT NULL,
  food_name_snapshot VARCHAR(160) NOT NULL,
  component VARCHAR(80) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  sin_tacc_snapshot BOOLEAN NULL,
  vegan_snapshot BOOLEAN NULL,
  vegetarian_snapshot BOOLEAN NULL,
  allergens_verified_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
  allergens_snapshot JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_menu_entry_item_menu FOREIGN KEY (menu_entry_id) REFERENCES menu_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_menu_entry_item_food FOREIGN KEY (food_id) REFERENCES foods(id),
  KEY ix_menu_entry_item_order (menu_entry_id, component, sort_order),
  KEY ix_menu_entry_item_food (food_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS menu_history (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  menu_entry_id VARCHAR(36) NOT NULL,
  actor_id VARCHAR(36) NOT NULL,
  action VARCHAR(40) NOT NULL,
  snapshot JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_menu_history_entry FOREIGN KEY (menu_entry_id) REFERENCES menu_entries(id),
  CONSTRAINT fk_menu_history_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  KEY ix_menu_history_entry_date (menu_entry_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS price_history (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  role ENUM('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL','ADMINISTRADOR_LOCAL','SUPERVISOR') NOT NULL,
  scholarship_type ENUM('BECA_COMPLETA','MEDIA_BECA','SIN_BECA') NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ARS',
  valid_from DATE NOT NULL,
  valid_until DATE NULL,
  changed_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_price_actor FOREIGN KEY (changed_by) REFERENCES users(id),
  CONSTRAINT chk_price_amount CHECK (amount >= 0),
  CONSTRAINT chk_price_validity CHECK (valid_until IS NULL OR valid_until >= valid_from),
  KEY ix_price_role_validity (role, valid_from, valid_until)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS benefits (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NULL,
  status ENUM('PENDIENTE','APROBADO','RECHAZADO','VENCIDO') NOT NULL DEFAULT 'PENDIENTE',
  valid_from DATE NULL,
  valid_until DATE NULL,
  approved_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_benefit_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_benefit_approver FOREIGN KEY (approved_by) REFERENCES users(id),
  KEY ix_benefit_user_status (user_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scholarships (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  scholarship_type VARCHAR(100) NOT NULL,
  status ENUM('PENDIENTE','APROBADA','RECHAZADA','VENCIDA') NOT NULL DEFAULT 'PENDIENTE',
  valid_from DATE NULL,
  valid_until DATE NULL,
  documentation_reference VARCHAR(500) NULL,
  reviewed_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_scholarship_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_scholarship_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id),
  KEY ix_scholarship_user_status (user_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_references (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  reservation_id VARCHAR(36) NULL UNIQUE,
  provider VARCHAR(60) NOT NULL,
  provider_reference VARCHAR(191) NOT NULL,
  method VARCHAR(60) NOT NULL DEFAULT 'REFERENCIA_EXTERNA',
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ARS',
  status ENUM('PENDIENTE','APROBADO','RECHAZADO','REEMBOLSADO') NOT NULL DEFAULT 'PENDIENTE',
  reviewed_by VARCHAR(36) NULL,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_payment_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT fk_payment_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id),
  CONSTRAINT uq_payment_provider_reference UNIQUE (provider, provider_reference),
  KEY ix_payment_user_date (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  payment_reference_id VARCHAR(36) NOT NULL,
  reservation_id VARCHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  allocated_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_payment_allocation_payment_reservation UNIQUE (payment_reference_id, reservation_id),
  CONSTRAINT fk_fin_alloc_payment FOREIGN KEY (payment_reference_id) REFERENCES payment_references(id),
  CONSTRAINT fk_fin_alloc_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT fk_fin_alloc_actor FOREIGN KEY (allocated_by) REFERENCES users(id),
  CONSTRAINT chk_payment_allocation_amount CHECK (amount > 0),
  KEY ix_payment_allocation_reservation_created (reservation_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_finance_events (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  payment_reference_id VARCHAR(36) NOT NULL,
  event_type ENUM('COMPROBANTE_PRESENTADO','DOCUMENTACION_VERIFICADA','DOCUMENTACION_RECHAZADA','ACREDITACION_CONFIRMADA','DIFERENCIA_DETECTADA','COBRO_EFECTIVO','DEVOLUCION_SOLICITADA','DEVOLUCION_AUTORIZADA','DEVOLUCION_EJECUTADA','DEVOLUCION_RECHAZADA','AJUSTE_REGISTRADO') NOT NULL,
  amount DECIMAL(10,2) NULL,
  currency CHAR(3) NULL,
  reference VARCHAR(191) NULL,
  note TEXT NULL,
  actor_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fin_event_payment FOREIGN KEY (payment_reference_id) REFERENCES payment_references(id),
  CONSTRAINT fk_fin_event_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  CONSTRAINT chk_payment_finance_event_amount CHECK (amount IS NULL OR amount >= 0),
  KEY ix_payment_finance_event_payment_created (payment_reference_id, created_at),
  KEY ix_payment_finance_event_actor_created (actor_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_evidence (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  payment_reference_id VARCHAR(36) NOT NULL,
  submitted_by VARCHAR(36) NOT NULL,
  provider_reference VARCHAR(191) NOT NULL,
  method VARCHAR(60) NOT NULL,
  declared_amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  mime_type VARCHAR(20) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fin_evidence_payment FOREIGN KEY (payment_reference_id) REFERENCES payment_references(id),
  CONSTRAINT fk_fin_evidence_submitter FOREIGN KEY (submitted_by) REFERENCES users(id),
  CONSTRAINT chk_payment_evidence_amount CHECK (declared_amount >= 0),
  KEY ix_payment_evidence_payment_created (payment_reference_id, created_at),
  KEY ix_payment_evidence_submitter_created (submitted_by, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS finance_adjustments (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  payment_reference_id VARCHAR(36) NOT NULL,
  adjustment_type ENUM('DEVOLUCION','AJUSTE','ANULACION') NOT NULL,
  status ENUM('SOLICITADA','AUTORIZADA','EJECUTADA','RECHAZADA','APLICADA') NOT NULL DEFAULT 'SOLICITADA',
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  reason TEXT NOT NULL,
  requested_by VARCHAR(36) NOT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  authorized_by VARCHAR(36) NULL,
  authorized_at DATETIME NULL,
  executed_by VARCHAR(36) NULL,
  executed_at DATETIME NULL,
  execution_reference VARCHAR(191) NULL,
  execution_note TEXT NULL,
  CONSTRAINT fk_fin_adj_payment FOREIGN KEY (payment_reference_id) REFERENCES payment_references(id),
  CONSTRAINT fk_fin_adj_requester FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_fin_adj_authorizer FOREIGN KEY (authorized_by) REFERENCES users(id),
  CONSTRAINT fk_fin_adj_executor FOREIGN KEY (executed_by) REFERENCES users(id),
  CONSTRAINT chk_finance_adjustment_amount CHECK (amount > 0),
  KEY ix_finance_adjustment_payment_created (payment_reference_id, requested_at),
  KEY ix_finance_adjustment_status_created (status, requested_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cash_shifts (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  active_operator_id VARCHAR(36) NULL UNIQUE,
  opened_by VARCHAR(36) NOT NULL,
  opening_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
  opening_note TEXT NULL,
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('ABIERTA','CERRADA') NOT NULL DEFAULT 'ABIERTA',
  closed_by VARCHAR(36) NULL,
  closed_at DATETIME NULL,
  expected_cash DECIMAL(10,2) NULL,
  counted_cash DECIMAL(10,2) NULL,
  difference DECIMAL(10,2) NULL,
  close_note TEXT NULL,
  reviewed_by VARCHAR(36) NULL,
  reviewed_at DATETIME NULL,
  CONSTRAINT fk_cash_shift_active_operator FOREIGN KEY (active_operator_id) REFERENCES users(id),
  CONSTRAINT fk_cash_shift_opened_by FOREIGN KEY (opened_by) REFERENCES users(id),
  CONSTRAINT fk_cash_shift_closed_by FOREIGN KEY (closed_by) REFERENCES users(id),
  CONSTRAINT fk_cash_shift_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id),
  CONSTRAINT chk_cash_shift_opening_balance CHECK (opening_balance >= 0),
  CONSTRAINT chk_cash_shift_counted_cash CHECK (counted_cash IS NULL OR counted_cash >= 0),
  KEY ix_cash_shift_status_opened (status, opened_at),
  KEY ix_cash_shift_operator_opened (opened_by, opened_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cash_receipts (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  receipt_number INT NOT NULL AUTO_INCREMENT UNIQUE,
  cash_shift_id VARCHAR(36) NOT NULL,
  payment_reference_id VARCHAR(36) NOT NULL UNIQUE,
  received_by VARCHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  note TEXT NULL,
  status ENUM('CONFIRMADO','ANULADO') NOT NULL DEFAULT 'CONFIRMADO',
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_by VARCHAR(36) NULL,
  voided_at DATETIME NULL,
  void_reason TEXT NULL,
  CONSTRAINT fk_cash_receipt_shift FOREIGN KEY (cash_shift_id) REFERENCES cash_shifts(id),
  CONSTRAINT fk_cash_receipt_payment FOREIGN KEY (payment_reference_id) REFERENCES payment_references(id),
  CONSTRAINT fk_cash_receipt_receiver FOREIGN KEY (received_by) REFERENCES users(id),
  CONSTRAINT fk_cash_receipt_voider FOREIGN KEY (voided_by) REFERENCES users(id),
  CONSTRAINT chk_cash_receipt_amount CHECK (amount > 0),
  KEY ix_cash_receipt_shift_received (cash_shift_id, received_at),
  KEY ix_cash_receipt_receiver_received (received_by, received_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scholarship_types (
  code ENUM('BECA_COMPLETA','MEDIA_BECA','SIN_BECA') NOT NULL PRIMARY KEY,
  label VARCHAR(80) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ticket_scans (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  ticket_id VARCHAR(36) NULL,
  reservation_id VARCHAR(36) NULL,
  operator_id VARCHAR(36) NOT NULL,
  result ENUM('VALID','ALREADY_USED','EXPIRED','CANCELLED','INVALID') NOT NULL,
  scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_scan_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  CONSTRAINT fk_ticket_scan_operator FOREIGN KEY (operator_id) REFERENCES users(id),
  KEY ix_ticket_scans_ticket_date (ticket_id, scanned_at),
  KEY ix_ticket_scans_operator_date (operator_id, scanned_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_by VARCHAR(36) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_app_settings_actor FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incidents (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  created_by VARCHAR(36) NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  severity ENUM('BAJA','MEDIA','ALTA','CRITICA') NOT NULL DEFAULT 'MEDIA',
  status ENUM('ABIERTO','EN_INVESTIGACION','RESUELTO','CERRADO') NOT NULL DEFAULT 'ABIERTO',
  assigned_to VARCHAR(36) NULL,
  resolution TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_incident_author FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_incident_assignee FOREIGN KEY (assigned_to) REFERENCES users(id),
  KEY ix_incident_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id),
  KEY ix_notification_user_created (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  actor_id VARCHAR(36) NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(36) NULL,
  outcome ENUM('SUCCESS','DENIED','FAILURE') NOT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  KEY ix_audit_action_created (action, created_at),
  KEY ix_audit_actor_created (actor_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  operation VARCHAR(80) NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  response JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT uq_idempotency_operation UNIQUE (user_id, operation, idempotency_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT,
  PRIMARY KEY (session_id),
  KEY ix_sessions_expiry (expires)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS carousel_photos (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  caption VARCHAR(100) NOT NULL,
  mime_type VARCHAR(20) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_carousel_photos_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  KEY ix_carousel_photos_created_at (created_at, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events_news (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  type ENUM('NOTICIA','COMUNICADO','EVENTO') NOT NULL,
  visibility ENUM('PUBLICO','PRIVADO') NOT NULL DEFAULT 'PUBLICO',
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  event_date DATE NULL,
  start_time VARCHAR(5) NULL,
  end_time VARCHAR(5) NULL,
  location VARCHAR(180) NULL,
  event_status ENUM('PROGRAMADO','REALIZADO','CANCELADO') NOT NULL DEFAULT 'PROGRAMADO',
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_news_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  KEY ix_events_news_published_created (published, created_at),
  KEY ix_events_news_event_date (event_date, event_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events_news_photos (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  entry_id VARCHAR(36) NOT NULL,
  mime_type VARCHAR(20) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_news_photos_entry FOREIGN KEY (entry_id) REFERENCES events_news(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_news_photos_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  KEY ix_events_news_photos_entry_created (entry_id, created_at)
) ENGINE=InnoDB;

INSERT IGNORE INTO roles (code, label) VALUES
  ('ALUMNO','Alumno'),('DOCENTE','Docente'),('NO_DOCENTE','No docente'),
  ('INVITADO_ESPECIAL','Invitado especial'),('ADMINISTRADOR_LOCAL','Administrador local'),('SUPERVISOR','Supervisor');

INSERT IGNORE INTO permissions (code, description) VALUES
  ('menu:read','Consultar menús publicados'),('reservations:create','Crear reservas propias'),
  ('reservations:read:own','Consultar reservas propias'),('reservations:cancel:own','Cancelar reservas propias'),
  ('reservations:read:all','Consultar reservas operativas'),('reservations:manage','Administrar reservas'),
  ('menu:manage','Administrar menú'),
  ('tickets:validate','Validar tickets y registrar consumos'),
  ('reservations:approve','Aprobar o rechazar reservas'),
  ('users:read','Consultar cuentas de usuario'),('users:create','Crear cuentas de usuario'),('users:manage','Administrar usuarios'),
  ('scholarships:manage','Administrar becas y beneficios'),('prices:manage','Administrar tarifas'),
  ('payments:read','Consultar referencias de pago'),('payments:manage','Revisar referencias de pago'),
  ('payments:cash:manage','Abrir caja y registrar efectivo'),('payments:reconcile','Verificar acreditaciones y revisar cierres'),
  ('payments:adjustments:manage','Autorizar ajustes y devoluciones'),('payments:export','Exportar informes financieros'),
  ('incidents:create','Crear reportes'),('incidents:read','Consultar incidentes'),('incidents:manage','Gestionar incidentes'),
  ('audit:read','Consultar auditoría'),('statistics:read','Consultar estadísticas operativas'),
  ('settings:manage','Administrar configuración'),
  ('kitchen:read','Consultar operación de cocina'),('kitchen:manage','Registrar producción de cocina');

INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES
  ('ALUMNO','menu:read'),('ALUMNO','reservations:create'),('ALUMNO','reservations:read:own'),('ALUMNO','reservations:cancel:own'),('ALUMNO','incidents:create'),
  ('DOCENTE','menu:read'),('DOCENTE','reservations:create'),('DOCENTE','reservations:read:own'),('DOCENTE','reservations:cancel:own'),('DOCENTE','incidents:create'),
  ('NO_DOCENTE','menu:read'),('NO_DOCENTE','reservations:create'),('NO_DOCENTE','reservations:read:own'),('NO_DOCENTE','reservations:cancel:own'),('NO_DOCENTE','incidents:create'),
  ('INVITADO_ESPECIAL','menu:read'),('INVITADO_ESPECIAL','reservations:create'),('INVITADO_ESPECIAL','reservations:read:own'),('INVITADO_ESPECIAL','reservations:cancel:own'),('INVITADO_ESPECIAL','incidents:create'),
  ('ADMINISTRADOR_LOCAL','menu:read'),('ADMINISTRADOR_LOCAL','reservations:read:all'),('ADMINISTRADOR_LOCAL','reservations:manage'),('ADMINISTRADOR_LOCAL','menu:manage'),('ADMINISTRADOR_LOCAL','tickets:validate'),('ADMINISTRADOR_LOCAL','reservations:approve'),('ADMINISTRADOR_LOCAL','users:read'),('ADMINISTRADOR_LOCAL','users:create'),('ADMINISTRADOR_LOCAL','incidents:create'),('ADMINISTRADOR_LOCAL','incidents:read'),('ADMINISTRADOR_LOCAL','incidents:manage'),('ADMINISTRADOR_LOCAL','statistics:read'),('ADMINISTRADOR_LOCAL','kitchen:read'),('ADMINISTRADOR_LOCAL','kitchen:manage'),('ADMINISTRADOR_LOCAL','payments:cash:manage'),('ADMINISTRADOR_LOCAL','payments:reconcile'),
  ('SUPERVISOR','menu:read'),('SUPERVISOR','reservations:read:all'),('SUPERVISOR','reservations:manage'),('SUPERVISOR','tickets:validate'),('SUPERVISOR','reservations:approve'),('SUPERVISOR','users:read'),('SUPERVISOR','users:create'),('SUPERVISOR','users:manage'),('SUPERVISOR','scholarships:manage'),('SUPERVISOR','prices:manage'),('SUPERVISOR','payments:read'),('SUPERVISOR','payments:manage'),('SUPERVISOR','payments:cash:manage'),('SUPERVISOR','payments:reconcile'),('SUPERVISOR','payments:adjustments:manage'),('SUPERVISOR','payments:export'),('SUPERVISOR','settings:manage'),('SUPERVISOR','incidents:read'),('SUPERVISOR','audit:read'),('SUPERVISOR','statistics:read'),('SUPERVISOR','kitchen:read'),('SUPERVISOR','kitchen:manage');

INSERT IGNORE INTO service_capacity_config (service, capacity, booking_opens_at, booking_closes_at, presentation_deadline_at, booking_enabled) VALUES
  ('ALMUERZO',750,'08:00','11:00','13:00',TRUE),('CENA',750,'18:00','22:00','13:00',TRUE);

INSERT IGNORE INTO scholarship_types (code, label) VALUES
  ('BECA_COMPLETA','Beca completa'),('MEDIA_BECA','Media beca'),('SIN_BECA','Sin beca');

INSERT IGNORE INTO price_history (id, role, scholarship_type, amount, currency, valid_from, changed_by) VALUES
  ('10000000-0000-4000-8000-000000000101','ALUMNO','BECA_COMPLETA',0.00,'ARS',CURRENT_DATE,NULL),
  ('10000000-0000-4000-8000-000000000102','ALUMNO','MEDIA_BECA',1500.00,'ARS',CURRENT_DATE,NULL),
  ('10000000-0000-4000-8000-000000000103','ALUMNO','SIN_BECA',3000.00,'ARS',CURRENT_DATE,NULL),
  ('10000000-0000-4000-8000-000000000104','DOCENTE',NULL,4500.00,'ARS',CURRENT_DATE,NULL),
  ('10000000-0000-4000-8000-000000000105','NO_DOCENTE',NULL,4500.00,'ARS',CURRENT_DATE,NULL),
  ('10000000-0000-4000-8000-000000000106','INVITADO_ESPECIAL',NULL,5000.00,'ARS',CURRENT_DATE,NULL);
