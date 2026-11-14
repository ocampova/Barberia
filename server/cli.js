"use strict";
// Herramientas de terminal para quien administra el servidor.
//   npm run admin -- <negocio> correo@ejemplo.com           da acceso al panel de ese negocio
//   npm run admin -- <negocio> correo@ejemplo.com --quitar  le quita el acceso
// <negocio> es el slug: victoraguilar, seimar…
const path = require("node:path");
const { openDb, repo } = require("./db");
const { negocios, get } = require("./negocios");

const DATA_DIR = process.env.DATA_DIR ||
  (process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : path.join(__dirname, "..", "data"));
const [slug, login, flag] = process.argv.slice(2);
const n = get(slug);
if (!n || !login) {
  console.log("Uso: npm run admin -- <negocio> <correo o teléfono> [--quitar]");
  console.log("Negocios: " + negocios.map((x) => x.slug).join(", "));
  process.exit(1);
}
const r = repo(openDb(path.join(DATA_DIR, n.dbFile || `${n.slug}.db`)));
let key = login.trim().toLowerCase();
if (!key.includes("@")) { key = key.replace(/\D/g, ""); if (key.length === 8) key = (n.countryCode || "506") + key; }
const u = r.userByLogin(key);
if (!u) {
  console.error(`No hay ninguna cuenta con "${login}" en ${n.name}. La persona debe registrarse primero en su app.`);
  process.exit(1);
}
const role = flag === "--quitar" ? "cliente" : "admin";
r.userSetRole(u.id, role);
if (role === "cliente") r.sessionDeleteOthers(u.id, "");
console.log(role === "admin" ? `${u.name} (${u.email}) ahora tiene acceso al panel de ${n.name}.` : `${u.name} ya no tiene acceso al panel de ${n.name}.`);
