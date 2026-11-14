"use strict";
// Versiones de los archivos estáticos (CSS, JS, imágenes) para que el navegador nunca use una copia vieja.
//
// Cloudflare (y otros proxies) pueden imponer su propio tiempo de caché a estos archivos, sin importar lo
// que diga el servidor. Por eso cada referencia lleva ?v=<huella del contenido>: si el archivo cambia,
// cambia la dirección y el navegador lo descarga de nuevo; si no cambia, se puede guardar sin límite.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const cache = new Map(); // ruta → { mtime, size, v }

/** Huella corta del contenido del archivo (null si no existe). */
function version(rel) {
  rel = String(rel || "").replace(/^\/+/, "").split(/[?#]/)[0];
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return null;
  try {
    const st = fs.statSync(file);
    const hit = cache.get(rel);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.v;
    const v = crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 10);
    cache.set(rel, { mtime: st.mtimeMs, size: st.size, v });
    return v;
  } catch {
    return null;
  }
}

/** "css/styles.css" → "css/styles.css?v=abc123". Las direcciones externas o ya versionadas no se tocan. */
function versioned(rel) {
  if (!rel || /^[a-z]+:|^\/\/|\?/i.test(rel)) return rel;
  const v = version(rel);
  return v ? `${rel}?v=${v}` : rel;
}

/** Versiona en el HTML los href/src que apuntan a css/, js/ o img/. */
function rewriteHtml(html) {
  return html.replace(/\b(href|src)="((?:css|js|img)\/[^"?#]+)"/g, (m, attr, rel) => `${attr}="${versioned(rel)}"`);
}

/** Encabezado de caché: con la versión correcta en la dirección, el archivo se puede guardar un año. */
function cacheControl(query, rel) {
  const v = query && query.get("v");
  return v && v === version(rel) ? "public, max-age=31536000, immutable" : "no-cache";
}

/** Copia de los logos de un negocio con sus direcciones versionadas. */
function versionLogos(logos = {}) {
  return Object.fromEntries(Object.entries(logos).map(([k, v]) => [k, versioned(v)]));
}

module.exports = { version, versioned, rewriteHtml, cacheControl, versionLogos };
