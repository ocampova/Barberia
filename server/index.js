"use strict";
const http = require("node:http");
const path = require("node:path");
const config = require("./config");
const { openDb, repo } = require("./db");
const { createApp } = require("./app");

const PORT = Number(process.env.PORT || 8080);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "..", "data", "barberia.db");

if (!process.env.ADMIN_PIN) console.warn("⚠  ADMIN_PIN no está configurado: el panel /admin queda desactivado.");
else if (process.env.ADMIN_PIN.length < 6) console.warn("⚠  ADMIN_PIN es corto: usa al menos 6 caracteres.");
if (!process.env.ADMIN_SECRET) console.warn("⚠  Sin ADMIN_SECRET: las sesiones del panel se cierran al reiniciar.");

const handler = createApp({ repo: repo(openDb(DB_FILE)), config });
http.createServer(handler).listen(PORT, () => {
  console.log(`Barbería lista en http://localhost:${PORT}  (panel: /admin)`);
});
