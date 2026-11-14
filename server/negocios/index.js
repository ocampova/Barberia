"use strict";
// Registro de negocios de la plataforma. Para sumar uno nuevo:
//   1. Crea server/negocios/<slug>.js (copia uno existente) con su marca, servicios y categorías.
//   2. Pon sus logos en public/img/negocios/<slug>/ (node brand/export.js genera los PNG).
//   3. Agrégalo a la lista de abajo.
// Cada negocio tiene su propia base de datos, sus propios clientes, su panel y su dirección <slug>.<dominio>.

const base = require("./_base");

const LIST = [require("./victoraguilar"), require("./seimar")];

function build(n) {
  const cfg = { ...base, ...n, theme: { ...base.theme, ...(n.theme || {}) } };
  for (const k of ["slug", "name", "shortName", "place", "categories", "services", "logos"])
    if (!cfg[k]) throw new Error(`Negocio ${n.slug || "?"}: falta "${k}"`);
  if (!/^[a-z0-9-]{2,40}$/.test(cfg.slug)) throw new Error(`Negocio ${cfg.slug}: slug inválido`);
  return Object.freeze(cfg);
}

const negocios = LIST.map(build);
const bySlug = new Map(negocios.map((n) => [n.slug, n]));
if (bySlug.size !== negocios.length) throw new Error("Hay dos negocios con el mismo slug");

module.exports = { negocios, get: (slug) => bySlug.get(slug), build };
