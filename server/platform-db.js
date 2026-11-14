"use strict";
// Base de datos de la PLATAFORMA (no de un negocio): cuentas de quienes administran la plataforma,
// sus sesiones, el registro de accesos a los negocios y ajustes internos.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function openPlatformDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS admins (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      pass_hash  TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS access_log (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      at       TEXT NOT NULL,
      admin_id INTEGER,
      negocio  TEXT,
      action   TEXT NOT NULL,
      detail   TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const q = {
    adminCount: db.prepare("SELECT COUNT(*) AS n FROM admins"),
    adminByEmail: db.prepare("SELECT * FROM admins WHERE email = ?"),
    adminById: db.prepare("SELECT * FROM admins WHERE id = ?"),
    adminInsert: db.prepare("INSERT INTO admins (name, email, pass_hash, created_at) VALUES (?, ?, ?, ?)"),
    adminSetPass: db.prepare("UPDATE admins SET pass_hash = ? WHERE id = ?"),
    sessionInsert: db.prepare("INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)"),
    sessionGet: db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?"),
    sessionDelete: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    sessionDeleteOthers: db.prepare("DELETE FROM sessions WHERE admin_id = ? AND token_hash <> ?"),
    sessionPurge: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    logInsert: db.prepare("INSERT INTO access_log (at, admin_id, negocio, action, detail) VALUES (?, ?, ?, ?, ?)"),
    logList: db.prepare(`SELECT l.*, a.name AS admin_name FROM access_log l LEFT JOIN admins a ON a.id = l.admin_id
      ORDER BY l.id DESC LIMIT ?`),
    settingGet: db.prepare("SELECT value FROM settings WHERE key = ?"),
    settingSet: db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
  };
  return {
    db,
    adminCount: () => q.adminCount.get().n,
    adminByEmail: (e) => q.adminByEmail.get(e),
    adminById: (id) => q.adminById.get(id),
    adminInsert: (name, email, hash) => Number(q.adminInsert.run(name, email, hash, new Date().toISOString()).lastInsertRowid),
    adminSetPass: (id, hash) => q.adminSetPass.run(hash, id),
    sessionInsert: (h, id, exp) => q.sessionInsert.run(h, id, exp),
    sessionGet: (h) => q.sessionGet.get(h, Date.now()),
    sessionDelete: (h) => q.sessionDelete.run(h),
    sessionDeleteOthers: (id, keep) => q.sessionDeleteOthers.run(id, keep),
    sessionPurge: () => q.sessionPurge.run(Date.now()),
    log: (adminId, negocio, action, detail = "") => q.logInsert.run(new Date().toISOString(), adminId ?? null, negocio ?? null, action, detail),
    logList: (limit = 100) => q.logList.all(limit),
    setting(key, fallback) { const r = q.settingGet.get(key); return r ? JSON.parse(r.value) : fallback; },
    settingSet: (key, value) => q.settingSet.run(key, JSON.stringify(value)),
    close: () => db.close(),
  };
}

module.exports = { openPlatformDb };
