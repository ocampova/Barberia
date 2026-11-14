"use strict";
const http = require("node:http");
const path = require("node:path");
const { negocios } = require("./negocios");
const { createPlatform } = require("./platform");

const PORT = Number(process.env.PORT || 8080);
// Carpeta de datos: la de DB_FILE (compatibilidad: /data/barberia.db → /data) o DATA_DIR.
const DATA_DIR = process.env.DATA_DIR ||
  (process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : path.join(__dirname, "..", "data"));

if (process.env.ADMIN_PIN || process.env.ADMIN_SECRET)
  console.warn("⚠  ADMIN_PIN y ADMIN_SECRET ya no se usan: el panel se entra con una cuenta de administrador (ADMIN_EMAIL).");
if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
  console.warn("⚠  Correos desactivados: configura RESEND_API_KEY y EMAIL_FROM para enviar confirmaciones.");
if (process.env.ADMIN_FORCE === "1") console.warn("⚠  ADMIN_FORCE está activo: bórralo apenas puedas entrar al panel.");

const platform = createPlatform({ negocios, dataDir: DATA_DIR });

// Resumen de configuración (sin valores secretos), útil para revisar los registros del hosting.
const yesNo = (v) => (v ? "sí" : "no");
console.log(`Configuración → datos: ${DATA_DIR} · dominio: ${platform.domain || "no"} · ADMIN_EMAIL: ${yesNo(process.env.ADMIN_EMAIL)} · ` +
  `TRUST_PROXY: ${yesNo(process.env.TRUST_PROXY)} · correos: ${yesNo(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)} · ` +
  `copias externas: ${yesNo(process.env.BACKUP_S3_ENDPOINT)}`);
for (const t of platform.tenants) console.log(`Negocio ${t.slug}: ${t.config.name} → ${t.url || "(solo dirección por defecto)"}`);

const server = http.createServer(platform.handler).listen(PORT, () => {
  console.log(`Plataforma lista en http://localhost:${PORT}  (en desarrollo: http://<negocio>.localhost:${PORT})`);
});

// Apagado ordenado: en cada nueva versión el hosting envía SIGTERM.
let closing = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    console.log(`${sig} recibido: cerrando…`);
    server.close(() => { platform.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

// Recordatorios por correo: se revisa cada 10 minutos.
const tick = () => { const n = platform.runReminders(); if (n) console.log(`Recordatorios enviados: ${n}`); };
setInterval(tick, 10 * 60 * 1000).unref();
setTimeout(tick, 5000).unref();

// Copia de seguridad diaria de cada negocio, a partir de las 3:00 a.m.; se revisa cada 10 minutos.
const BACKUP_HOUR = Number(process.env.BACKUP_HOUR ?? 3);
let backupRunning = false;
async function backupTick() {
  if (backupRunning || process.env.BACKUP_DISABLED === "1") return;
  backupRunning = true;
  try { await platform.runBackups(BACKUP_HOUR); } finally { backupRunning = false; }
}
setInterval(backupTick, 10 * 60 * 1000).unref();
setTimeout(backupTick, 15000).unref();
