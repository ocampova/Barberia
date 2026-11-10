"use strict";
const http = require("node:http");
const path = require("node:path");
const config = require("./config");
const { openDb, repo } = require("./db");
const { createApp } = require("./app");

const PORT = Number(process.env.PORT || 8080);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "..", "data", "barberia.db");

if (process.env.ADMIN_PIN || process.env.ADMIN_SECRET)
  console.warn("⚠  ADMIN_PIN y ADMIN_SECRET ya no se usan: el panel se entra con una cuenta de administrador (ADMIN_EMAIL).");

if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
  console.warn("⚠  Correos desactivados: configura RESEND_API_KEY y EMAIL_FROM para enviar confirmaciones.");
if (!process.env.PUBLIC_URL)
  console.warn("⚠  Sin PUBLIC_URL: los recordatorios por correo no incluirán el enlace a la cita.");

const handler = createApp({ repo: repo(openDb(DB_FILE)), config });
http.createServer(handler).listen(PORT, () => {
  console.log(`Barbería lista en http://localhost:${PORT}  (panel: /admin)`);
});

// Recordatorios por correo: se revisa cada 10 minutos.
const tick = () => {
  try { const n = handler.runReminders(); if (n) console.log(`Recordatorios enviados: ${n}`); }
  catch (e) { console.error("Recordatorios:", e.message); }
};
setInterval(tick, 10 * 60 * 1000).unref();
setTimeout(tick, 5000).unref();
