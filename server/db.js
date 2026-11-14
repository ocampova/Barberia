"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS bookings (
      id         TEXT PRIMARY KEY,
      token      TEXT NOT NULL,
      category   TEXT NOT NULL,
      day        TEXT NOT NULL,
      start      INTEGER NOT NULL,
      minutes    INTEGER NOT NULL,
      services   TEXT NOT NULL,
      total      INTEGER,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'web',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bookings_day ON bookings(day);
    CREATE INDEX IF NOT EXISTS bookings_phone ON bookings(phone);
    CREATE TABLE IF NOT EXISTS blocks (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      day      TEXT NOT NULL,
      start    INTEGER NOT NULL,
      end      INTEGER NOT NULL,
      reason   TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS blocks_day ON blocks(day);
    -- Horario semanal por categoría: ranges = JSON [[inicio, fin], ...] en minutos; [] = cerrado.
    CREATE TABLE IF NOT EXISTS schedule_week (
      category TEXT NOT NULL,
      weekday  INTEGER NOT NULL,
      ranges   TEXT NOT NULL,
      PRIMARY KEY (category, weekday)
    );
    -- Clientes con cuenta.
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL UNIQUE,
      email      TEXT NOT NULL UNIQUE,
      pass_hash  TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    -- Sesiones: se guarda solo el hash del token, nunca el token.
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    -- Servicios que ofrece el negocio (los administra el panel).
    CREATE TABLE IF NOT EXISTS services (
      id          TEXT PRIMARY KEY,
      category    TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price       INTEGER,
      minutes     INTEGER NOT NULL,
      popular     INTEGER NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      sort        INTEGER NOT NULL DEFAULT 0
    );
    -- Excepciones por fecha: reemplazan al horario semanal ese día ([] = cerrado).
    CREATE TABLE IF NOT EXISTS schedule_days (
      category TEXT NOT NULL,
      day      TEXT NOT NULL,
      ranges   TEXT NOT NULL,
      PRIMARY KEY (category, day)
    );
  `);
  // Migraciones: columnas agregadas después de la primera versión.
  const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  if (!cols.includes("email")) db.exec("ALTER TABLE bookings ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  if (!cols.includes("reminded_at")) db.exec("ALTER TABLE bookings ADD COLUMN reminded_at TEXT");
  if (!cols.includes("user_id")) db.exec("ALTER TABLE bookings ADD COLUMN user_id INTEGER");
  // Quién canceló ('cliente' o 'negocio') y con cuántos minutos de anticipación.
  if (!cols.includes("cancelled_by")) db.exec("ALTER TABLE bookings ADD COLUMN cancelled_by TEXT NOT NULL DEFAULT ''");
  if (!cols.includes("cancel_notice_min")) db.exec("ALTER TABLE bookings ADD COLUMN cancel_notice_min INTEGER");
  // Segundo recordatorio (clientes con historial de cancelaciones o ausencias).
  if (!cols.includes("reminded2_at")) db.exec("ALTER TABLE bookings ADD COLUMN reminded2_at TEXT");
  const ucols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!ucols.includes("role")) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'cliente'");
  if (!ucols.includes("source")) db.exec("ALTER TABLE users ADD COLUMN source TEXT NOT NULL DEFAULT ''");
  // Agenda que atiende cada cuenta del equipo ('' = todas).
  if (!ucols.includes("agenda")) db.exec("ALTER TABLE users ADD COLUMN agenda TEXT NOT NULL DEFAULT ''");
  if (!ucols.includes("privacy_accepted_at")) db.exec("ALTER TABLE users ADD COLUMN privacy_accepted_at TEXT");
  if (!ucols.includes("privacy_version")) db.exec("ALTER TABLE users ADD COLUMN privacy_version TEXT");
  // Ajustes del negocio editables desde el panel (clave → JSON).
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id)");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const rowToBooking = (r) => r && { ...r, services: JSON.parse(r.services) };
const rowToService = (r) => r && { ...r, popular: Boolean(r.popular), active: Boolean(r.active) };

function repo(db) {
  const q = {
    bookingsOn: db.prepare("SELECT * FROM bookings WHERE day = ?"),
    bookingsRange: db.prepare("SELECT * FROM bookings WHERE day BETWEEN ? AND ? ORDER BY day, start"),
    bookingById: db.prepare("SELECT * FROM bookings WHERE id = ?"),
    activeByPhone: db.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE phone = ? AND day >= ? AND status IN ('pendiente','confirmada')"),
    pendingCount: db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pendiente' AND day >= ?"),
    insertBooking: db.prepare(`INSERT INTO bookings
      (id, token, category, day, start, minutes, services, total, name, phone, email, note, status, source, created_at, updated_at, user_id)
      VALUES (:id, :token, :category, :day, :start, :minutes, :services, :total, :name, :phone, :email, :note, :status, :source, :created_at, :updated_at, :user_id)`),
    bookingsByUser: db.prepare("SELECT * FROM bookings WHERE user_id = ? ORDER BY day DESC, start DESC LIMIT 200"),
    activeByUser: db.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND day >= ? AND status IN ('pendiente','confirmada')"),
    userInsert: db.prepare(`INSERT INTO users (name, phone, email, pass_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    userByLogin: db.prepare("SELECT * FROM users WHERE email = ? OR phone = ?"),
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    userByPhone: db.prepare("SELECT * FROM users WHERE phone = ?"),
    userUpdate: db.prepare("UPDATE users SET name = ?, phone = ?, email = ?, updated_at = ? WHERE id = ?"),
    userSetPass: db.prepare("UPDATE users SET pass_hash = ?, updated_at = ? WHERE id = ?"),
    userSetRole: db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?"),
    userSetSignup: db.prepare("UPDATE users SET source = ?, privacy_accepted_at = ?, privacy_version = ? WHERE id = ?"),
    sources: db.prepare(`SELECT source, COUNT(*) AS n FROM users WHERE role = 'cliente' AND created_at >= ?
      GROUP BY source ORDER BY n DESC`),
    settingGet: db.prepare("SELECT value FROM settings WHERE key = ?"),
    settingSet: db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`),
    admins: db.prepare("SELECT id, name, phone, email, agenda, created_at FROM users WHERE role = 'admin' ORDER BY name"),
    userSetAgenda: db.prepare("UPDATE users SET agenda = ?, updated_at = ? WHERE id = ?"),
    pendingByCategory: db.prepare(`SELECT category, COUNT(*) AS n FROM bookings
      WHERE status = 'pendiente' AND day >= ? GROUP BY category`),
    sessionInsert: db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
    sessionGet: db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?"),
    sessionDelete: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    sessionDeleteUser: db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?"),
    sessionPurge: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    resetInsert: db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
    resetTake: db.prepare("DELETE FROM password_resets WHERE token_hash = ? AND expires_at > ? RETURNING user_id"),
    resetPurgeUser: db.prepare("DELETE FROM password_resets WHERE user_id = ?"),
    svcAll: db.prepare("SELECT * FROM services ORDER BY sort, name"),
    svcGet: db.prepare("SELECT * FROM services WHERE id = ?"),
    svcCount: db.prepare("SELECT COUNT(*) AS n FROM services"),
    svcUpsert: db.prepare(`INSERT INTO services (id, category, name, description, price, minutes, popular, active, sort)
      VALUES (:id, :category, :name, :description, :price, :minutes, :popular, :active, :sort)
      ON CONFLICT (id) DO UPDATE SET category = excluded.category, name = excluded.name, description = excluded.description,
        price = excluded.price, minutes = excluded.minutes, popular = excluded.popular, active = excluded.active, sort = excluded.sort`),
    svcDelete: db.prepare("DELETE FROM services WHERE id = ?"),
    svcUsed: db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE services LIKE ?"),
    reminderCandidates: db.prepare(`SELECT * FROM bookings WHERE status = 'confirmada' AND email <> ''
      AND reminded_at IS NULL AND day BETWEEN ? AND ?`),
    setReminded: db.prepare("UPDATE bookings SET reminded_at = ? WHERE id = ?"),
    setStatus: db.prepare("UPDATE bookings SET status = ?, cancelled_by = '', cancel_notice_min = NULL, updated_at = ? WHERE id = ?"),
    setCancelled: db.prepare("UPDATE bookings SET status = 'cancelada', cancelled_by = ?, cancel_notice_min = ?, updated_at = ? WHERE id = ?"),
    // Historial de un cliente (por teléfono) desde una fecha: cancelaciones suyas, a última hora (< 24 h) y ausencias.
    history: db.prepare(`SELECT
        COALESCE(SUM(status = 'cancelada' AND cancelled_by = 'cliente'), 0) AS cancels,
        COALESCE(SUM(status = 'cancelada' AND cancelled_by = 'cliente' AND cancel_notice_min < 1440), 0) AS late,
        COALESCE(SUM(status = 'no-asistio'), 0) AS noShows,
        COALESCE(SUM(status = 'completada'), 0) AS completed
      FROM bookings WHERE phone = ? AND day >= ?`),
    reminder2Candidates: db.prepare(`SELECT * FROM bookings WHERE status = 'confirmada' AND email <> ''
      AND reminded2_at IS NULL AND day BETWEEN ? AND ?`),
    setReminded2: db.prepare("UPDATE bookings SET reminded2_at = ? WHERE id = ?"),
    blocksOn: db.prepare("SELECT * FROM blocks WHERE day = ?"),
    blocksRange: db.prepare("SELECT * FROM blocks WHERE day BETWEEN ? AND ? ORDER BY day, start"),
    insertBlock: db.prepare("INSERT INTO blocks (category, day, start, end, reason) VALUES (?, ?, ?, ?, ?)"),
    deleteBlock: db.prepare("DELETE FROM blocks WHERE id = ?"),
    weekGet: db.prepare("SELECT weekday, ranges FROM schedule_week WHERE category = ?"),
    weekSet: db.prepare(`INSERT INTO schedule_week (category, weekday, ranges) VALUES (?, ?, ?)
      ON CONFLICT (category, weekday) DO UPDATE SET ranges = excluded.ranges`),
    dayGet: db.prepare("SELECT ranges FROM schedule_days WHERE category = ? AND day = ?"),
    daysRange: db.prepare("SELECT day, ranges FROM schedule_days WHERE category = ? AND day BETWEEN ? AND ?"),
    daySet: db.prepare(`INSERT INTO schedule_days (category, day, ranges) VALUES (?, ?, ?)
      ON CONFLICT (category, day) DO UPDATE SET ranges = excluded.ranges`),
    dayDelete: db.prepare("DELETE FROM schedule_days WHERE category = ? AND day = ?"),
  };

  return {
    bookingsOn: (day) => q.bookingsOn.all(day).map(rowToBooking),
    bookingsRange: (from, to) => q.bookingsRange.all(from, to).map(rowToBooking),
    bookingById: (id) => rowToBooking(q.bookingById.get(id)),
    activeByPhone: (phone, fromDay) => q.activeByPhone.get(phone, fromDay).n,
    pendingCount: (fromDay) => q.pendingCount.get(fromDay).n,
    insertBooking: (b) => q.insertBooking.run({ email: "", user_id: null, ...b, services: JSON.stringify(b.services) }),
    bookingsByUser: (uid) => q.bookingsByUser.all(uid).map(rowToBooking),
    activeByUser: (uid, fromDay) => q.activeByUser.get(uid, fromDay).n,

    userInsert(u) {
      const ts = new Date().toISOString();
      return Number(q.userInsert.run(u.name, u.phone, u.email, u.pass_hash, ts, ts).lastInsertRowid);
    },
    userById: (id) => q.userById.get(id),
    userByLogin: (v) => q.userByLogin.get(v, v),
    userByEmail: (e) => q.userByEmail.get(e),
    userByPhone: (p) => q.userByPhone.get(p),
    userUpdate: (id, u) => q.userUpdate.run(u.name, u.phone, u.email, new Date().toISOString(), id),
    userSetPass: (id, h) => q.userSetPass.run(h, new Date().toISOString(), id),
    userSetRole: (id, role) => q.userSetRole.run(role, new Date().toISOString(), id),
    userSetSignup: (id, source, version) => q.userSetSignup.run(source, new Date().toISOString(), version, id),
    sources: (since) => q.sources.all(since),
    setting(key, fallback) { const r = q.settingGet.get(key); return r ? JSON.parse(r.value) : fallback; },
    settingSet: (key, value) => q.settingSet.run(key, JSON.stringify(value)),
    admins: () => q.admins.all(),
    userSetAgenda: (id, agenda) => q.userSetAgenda.run(agenda, new Date().toISOString(), id),
    pendingByCategory: (fromDay) => Object.fromEntries(q.pendingByCategory.all(fromDay).map((r) => [r.category, r.n])),
    sessionInsert: (h, uid, exp) => q.sessionInsert.run(h, uid, exp),
    sessionGet: (h) => q.sessionGet.get(h, Date.now()),
    sessionDelete: (h) => q.sessionDelete.run(h),
    sessionDeleteOthers: (uid, keepHash) => q.sessionDeleteUser.run(uid, keepHash),
    sessionPurge: () => q.sessionPurge.run(Date.now()),
    resetInsert: (h, uid, exp) => q.resetInsert.run(h, uid, exp),
    resetTake: (h) => { const r = q.resetTake.get(h, Date.now()); return r ? r.user_id : null; },
    resetPurgeUser: (uid) => q.resetPurgeUser.run(uid),

    services: () => q.svcAll.all().map(rowToService),
    service: (id) => rowToService(q.svcGet.get(id)),
    serviceCount: () => q.svcCount.get().n,
    serviceSave: (s) => q.svcUpsert.run({ ...s, popular: s.popular ? 1 : 0, active: s.active ? 1 : 0 }),
    serviceDelete: (id) => q.svcDelete.run(id).changes,
    serviceUsed: (id) => q.svcUsed.get(`%"${id}"%`).n > 0,
    reminderCandidates: (from, to) => q.reminderCandidates.all(from, to).map(rowToBooking),
    setReminded: (id) => q.setReminded.run(new Date().toISOString(), id).changes,
    setStatus: (id, status) => q.setStatus.run(status, new Date().toISOString(), id).changes,
    setCancelled: (id, by, noticeMin) => q.setCancelled.run(by, noticeMin, new Date().toISOString(), id).changes,
    history: (phone, since) => ({ ...q.history.get(phone, since) }),
    reminder2Candidates: (from, to) => q.reminder2Candidates.all(from, to).map(rowToBooking),
    setReminded2: (id) => q.setReminded2.run(new Date().toISOString(), id).changes,
    blocksOn: (day) => q.blocksOn.all(day),
    blocksRange: (from, to) => q.blocksRange.all(from, to),
    insertBlock: (b) => Number(q.insertBlock.run(b.category, b.day, b.start, b.end, b.reason).lastInsertRowid),
    deleteBlock: (id) => q.deleteBlock.run(id).changes,
    weekGet(category) {
      const out = {};
      for (const r of q.weekGet.all(category)) out[r.weekday] = JSON.parse(r.ranges);
      return out;
    },
    weekSet: (category, weekday, ranges) => q.weekSet.run(category, weekday, JSON.stringify(ranges)),
    dayGet(category, day) { const r = q.dayGet.get(category, day); return r ? JSON.parse(r.ranges) : null; },
    daysRange(category, from, to) {
      const out = {};
      for (const r of q.daysRange.all(category, from, to)) out[r.day] = JSON.parse(r.ranges);
      return out;
    },
    daySet: (category, day, ranges) => q.daySet.run(category, day, JSON.stringify(ranges)),
    dayDelete: (category, day) => q.dayDelete.run(category, day).changes,
    // node:sqlite es síncrono: la verificación y la inserción ocurren sin que otra petición se intercale.
    transaction(fn) {
      db.exec("BEGIN IMMEDIATE");
      try { const r = fn(); db.exec("COMMIT"); return r; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

module.exports = { openDb, repo };
