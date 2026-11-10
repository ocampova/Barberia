"use strict";
// Contraseñas con scrypt (incluido en Node) y tokens de sesión aleatorios.
const crypto = require("node:crypto");

const N = 16384, R = 8, P = 1, KEYLEN = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  const [alg, n, salt, hash] = String(stored || "").split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(password, Buffer.from(salt, "base64"), want.length, { N: Number(n), r: R, p: P });
  return crypto.timingSafeEqual(got, want);
}

// Se usa al fallar un inicio de sesión con un usuario inexistente,
// para que tarde lo mismo que con uno real y no revele qué cuentas existen.
const DUMMY = hashPassword("contraseña-de-relleno");

const newToken = () => crypto.randomBytes(32).toString("base64url");
const tokenHash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

module.exports = { hashPassword, verifyPassword, DUMMY, newToken, tokenHash, parseCookies };
