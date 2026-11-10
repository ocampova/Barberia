"use strict";
// Herramientas de terminal para quien administra el servidor.
//   npm run admin -- correo@ejemplo.com          da acceso al panel a esa cuenta
//   npm run admin -- correo@ejemplo.com --quitar  le quita el acceso
const path = require("node:path");
const { openDb, repo } = require("./db");

const DB_FILE = process.env.DB_FILE || path.join(__dirname, "..", "data", "barberia.db");
const [login, flag] = process.argv.slice(2);
if (!login) {
  console.log("Uso: npm run admin -- <correo o teléfono> [--quitar]");
  process.exit(1);
}
const r = repo(openDb(DB_FILE));
let key = login.trim().toLowerCase();
if (!key.includes("@")) { key = key.replace(/\D/g, ""); if (key.length === 8) key = "506" + key; }
const u = r.userByLogin(key);
if (!u) {
  console.error(`No hay ninguna cuenta con "${login}". La persona debe registrarse primero en la app.`);
  process.exit(1);
}
const role = flag === "--quitar" ? "cliente" : "admin";
r.userSetRole(u.id, role);
if (role === "cliente") r.sessionDeleteOthers(u.id, "");
console.log(role === "admin" ? `${u.name} (${u.email}) ahora tiene acceso al panel.` : `${u.name} ya no tiene acceso al panel.`);
