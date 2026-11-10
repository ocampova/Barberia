"use strict";
const http = require("node:http");
const path = require("node:path");
const config = require("./config");
const { openDb, repo } = require("./db");
const { createApp } = require("./app");
const { createBackups } = require("./backup");
const { nowIn } = require("./time");

const PORT = Number(process.env.PORT || 8080);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "..", "data", "barberia.db");

if (process.env.ADMIN_PIN || process.env.ADMIN_SECRET)
  console.warn("⚠  ADMIN_PIN y ADMIN_SECRET ya no se usan: el panel se entra con una cuenta de administrador (ADMIN_EMAIL).");

if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
  console.warn("⚠  Correos desactivados: configura RESEND_API_KEY y EMAIL_FROM para enviar confirmaciones.");
if (!process.env.PUBLIC_URL)
  console.warn("⚠  Sin PUBLIC_URL: los recordatorios por correo no incluirán el enlace a la cita.");

// Resumen de configuración (sin valores secretos), útil para revisar los registros del hosting.
const yesNo = (v) => (v ? "sí" : "no");
console.log(`Configuración → base de datos: ${DB_FILE} · ADMIN_EMAIL: ${yesNo(process.env.ADMIN_EMAIL)} · ` +
  `ADMIN_PASSWORD: ${yesNo(process.env.ADMIN_PASSWORD)} · TRUST_PROXY: ${yesNo(process.env.TRUST_PROXY)} · ` +
  `PUBLIC_URL: ${process.env.PUBLIC_URL || "no"} · correos: ${yesNo(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)}`);
if (process.env.ADMIN_FORCE === "1") console.warn("⚠  ADMIN_FORCE está activo: bórralo apenas puedas entrar al panel.");
const db = openDb(DB_FILE);
const r = repo(db);
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_FILE), "backups");
const backups = createBackups({ db, dir: BACKUP_DIR });
const handler = createApp({ repo: r, config, backups });
const server = http.createServer(handler).listen(PORT, () => {
  console.log(`Barbería lista en http://localhost:${PORT}  (panel: /admin)`);
});

// Apagado ordenado: en cada nueva versión el hosting envía SIGTERM. Se dejan terminar
// las peticiones en curso y se cierra la base de datos antes de salir.
let closing = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    console.log(`${sig} recibido: cerrando…`);
    server.close(() => { try { db.close(); } catch {} process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

// Recordatorios por correo: se revisa cada 10 minutos.
const tick = () => {
  try { const n = handler.runReminders(); if (n) console.log(`Recordatorios enviados: ${n}`); }
  catch (e) { console.error("Recordatorios:", e.message); }
};
setInterval(tick, 10 * 60 * 1000).unref();
setTimeout(tick, 5000).unref();

// Copia de seguridad diaria a partir de las 3:00 a.m. (hora del negocio); se revisa cada 10 minutos.
const BACKUP_HOUR = Number(process.env.BACKUP_HOUR ?? 3);
let backupRunning = false;
async function backupTick() {
  if (backupRunning || process.env.BACKUP_DISABLED === "1") return;
  const n = nowIn(config.timeZone);
  const last = r.setting("lastBackup", null);
  const lastDay = last ? nowIn(config.timeZone, new Date(last.at)).day : null;
  if (lastDay === n.day || n.minutes < BACKUP_HOUR * 60) return;
  backupRunning = true;
  try {
    const res = await backups.run("diaria");
    r.settingSet("lastBackup", { at: new Date().toISOString(), name: res.name, uploaded: res.uploaded });
  } catch (e) {
    console.error("⚠  La copia de seguridad falló:", e.message);
  } finally { backupRunning = false; }
}
setInterval(backupTick, 10 * 60 * 1000).unref();
setTimeout(backupTick, 15000).unref();
if (!backups.offsite) console.warn("⚠  Copias solo en el disco del servidor: configura BACKUP_S3_* para guardarlas también fuera (Cloudflare R2).");
