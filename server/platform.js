"use strict";
// Plataforma multi-negocio: un solo servidor atiende a varios negocios.
//  - Cada negocio tiene SU PROPIA base de datos (clientes, citas, servicios, horario, equipo): datos aislados.
//  - El negocio se elige por la dirección: <slug>.<dominio> (p. ej. seimar.elcorte.app),
//    <slug>.localhost en desarrollo, o el negocio por defecto para cualquier otra dirección.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { openDb, repo } = require("./db");
const { createApp } = require("./app");
const { createBackups } = require("./backup");
const { nowIn } = require("./time");
const { openPlatformDb } = require("./platform-db");
const { createPlatformAdmin } = require("./platform-admin");

const hostOf = (h) => String(h || "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

/** Dominio de la plataforma: PLATFORM_DOMAIN, o el que se deduce de PUBLIC_URL (victoraguilar.elcorte.app → elcorte.app). */
function platformDomain(env) {
  if (env.PLATFORM_DOMAIN) return hostOf(env.PLATFORM_DOMAIN);
  if (!env.PUBLIC_URL) return null;
  try {
    const host = new URL(env.PUBLIC_URL).hostname;
    if (host.endsWith(".localhost")) return "localhost";
    const parts = host.split(".");
    return parts.length > 2 ? parts.slice(1).join(".") : null;
  } catch { return null; }
}

/**
 * Migración única: antes de la plataforma, la barbería y el salón compartían una base de datos
 * (categorías "barberia" y "salon"). Esto mueve todo lo del salón a la base de datos propia del salón:
 * servicios, horario, días especiales, bloqueos, citas, ajustes, y las cuentas de los clientes que
 * reservaron en el salón (más las cuentas de administración, para no perder el acceso al panel).
 * Antes de tocar nada guarda una copia completa de la base original.
 */
function migrateSplit({ fromFile, toFile, category, backupDir, log = console }) {
  if (fs.existsSync(toFile) || !fs.existsSync(fromFile)) return false;
  const src = new DatabaseSync(fromFile);
  const count = (sql) => { try { return src.prepare(sql).get(category).n; } catch { return 0; } };
  const rows = count("SELECT COUNT(*) AS n FROM services WHERE category = ?") +
    count("SELECT COUNT(*) AS n FROM bookings WHERE category = ?") +
    count("SELECT COUNT(*) AS n FROM schedule_week WHERE category = ?");
  if (!rows) { src.close(); return false; }

  fs.mkdirSync(backupDir, { recursive: true });
  const safety = path.join(backupDir, `antes-de-separar-${category}-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  src.prepare("VACUUM INTO ?").run(safety);
  src.close();

  const dst = openDb(toFile); // crea el esquema completo
  const cols = (t) => dst.prepare(`PRAGMA main.table_info(${t})`).all().map((c) => `"${c.name}"`);
  const srcCols = (t) => new Set(dst.prepare(`PRAGMA v.table_info(${t})`).all().map((c) => `"${c.name}"`));
  dst.exec(`ATTACH DATABASE '${fromFile.replace(/'/g, "''")}' AS v`);
  try {
    const copy = (table, where, params = []) => {
      const have = srcCols(table);
      const list = cols(table).filter((c) => have.has(c)).join(", ");
      dst.prepare(`INSERT INTO main.${table} (${list}) SELECT ${list} FROM v.${table} WHERE ${where}`).run(...params);
    };
    dst.exec("BEGIN");
    copy("users", `role = 'admin' OR id IN (SELECT user_id FROM v.bookings WHERE category = ? AND user_id IS NOT NULL)`, [category]);
    copy("services", "category = ?", [category]);
    copy("bookings", "category = ?", [category]);
    copy("schedule_week", "category = ?", [category]);
    copy("schedule_days", "category = ?", [category]);
    dst.prepare(`INSERT INTO main.blocks (category, day, start, "end", reason)
      SELECT category, day, start, "end", reason FROM v.blocks WHERE category = ? OR category IS NULL`).run(category);
    copy("settings", "key IN ('cancelHours')");
    dst.exec("COMMIT");
    dst.exec("BEGIN");
    for (const t of ["bookings", "services", "schedule_week", "schedule_days", "blocks"])
      dst.prepare(`DELETE FROM v.${t} WHERE category = ?`).run(category);
    dst.exec("COMMIT");
  } catch (e) {
    try { dst.exec("ROLLBACK"); } catch {}
    dst.exec("DETACH DATABASE v");
    dst.close();
    fs.rmSync(toFile, { force: true });
    throw new Error(`No se pudo separar "${category}": ${e.message}. La base original no se modificó (copia en ${safety}).`);
  }
  dst.exec("DETACH DATABASE v");
  dst.close();
  log.log(`Migración: los datos de "${category}" se movieron a ${path.basename(toFile)} (copia previa: ${path.basename(safety)}).`);
  return true;
}

/**
 * @param negocios  lista de configuraciones (server/negocios)
 * @param dataDir   carpeta de datos (bases de datos y copias)
 * @param env       variables de entorno
 * @param defaultSlug negocio para direcciones que no son <slug>.<dominio>
 */
function createPlatform({ negocios, dataDir, env = process.env, defaultSlug, clock, mailer, log = console,
  migrations = [{ from: "victoraguilar", to: "seimar", category: "salon" }] }) {
  const domain = platformDomain(env);
  const def = defaultSlug || env.DEFAULT_NEGOCIO || negocios[0].slug;
  const fileOf = (n) => path.join(dataDir, n.dbFile || `${n.slug}.db`);
  // Esquema y puerto salen de PUBLIC_URL (en desarrollo: http://victoraguilar.localhost:8080)
  const pub = (() => { try { return new URL(env.PUBLIC_URL); } catch { return null; } })();
  const scheme = pub && pub.hostname.endsWith(domain || "\0") ? pub.protocol : "https:";
  const port = pub && scheme === pub.protocol && pub.port ? `:${pub.port}` : "";
  const urlOf = (n) => (domain ? `${scheme}//${n.slug}.${domain}${port}` : n.slug === def && env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, "") : null);
  const fromAddress = String(env.EMAIL_FROM || "").match(/<([^>]+)>/)?.[1] || env.EMAIL_FROM || "";

  // Migraciones de datos (una sola vez)
  for (const m of migrations) {
    const a = negocios.find((n) => n.slug === m.from), b = negocios.find((n) => n.slug === m.to);
    if (a && b) migrateSplit({ fromFile: fileOf(a), toFile: fileOf(b), category: m.category, backupDir: path.join(dataDir, "backups"), log });
  }

  // La administración de la plataforma se crea después de los negocios; ellos la consultan al recibir peticiones.
  let admin = null;
  const platformAuth = {
    cookieName: "va_plat",
    redeem: (t, slug) => (admin ? admin.platformAuth.redeem(t, slug) : null),
    verify: (req, slug) => (admin ? admin.platformAuth.verify(req, slug) : null),
  };

  const tenants = negocios.map((n) => {
    const db = openDb(fileOf(n));
    const r = repo(db);
    const nEnv = {
      ...env,
      ADMIN_EMAIL: "", ADMIN_PASSWORD: "", ADMIN_FORCE: "", // el dueño se administra desde la plataforma
      PUBLIC_URL: urlOf(n) || "",
      EMAIL_FROM: fromAddress ? `${n.name} <${fromAddress}>` : "",
      EMAIL_REPLY_TO: n.replyTo || env.EMAIL_REPLY_TO || "",
      BACKUP_S3_PREFIX: `${(env.BACKUP_S3_PREFIX || "backups/").replace(/\/?$/, "/")}${n.slug}/`,
    };
    const backups = createBackups({ db, dir: path.join(dataDir, "backups", n.slug), env: nEnv, log });
    const related = (n.related || []).map((rel) => {
      const o = negocios.find((x) => x.slug === rel.slug);
      return o && { slug: o.slug, name: o.name, logo: o.logos.main, url: urlOf(o), pitch: rel.pitch || "" };
    }).filter((x) => x && x.url);
    const app = createApp({ repo: r, config: n, env: nEnv, backups, clock, mailer, related, platformAuth });
    return { slug: n.slug, config: n, db, repo: r, app, backups, url: urlOf(n), dbFile: fileOf(n) };
  });

  const pdb = openPlatformDb(path.join(dataDir, "plataforma.db"));
  admin = createPlatformAdmin({ tenants, pdb, env, log, clock: clock || (() => new Date()) });
  const bySlug = new Map(tenants.map((t) => [t.slug, t]));
  const byHost = new Map();
  for (const t of tenants) for (const h of t.config.hosts || []) byHost.set(hostOf(h), t);

  const PLATFORM_LABEL = "plataforma";
  function resolve(hostHeader) {
    const host = hostOf(hostHeader);
    if (byHost.has(host)) return bySlug.get(byHost.get(host).slug);
    for (const suffix of [domain, "localhost"].filter(Boolean)) {
      if (host.endsWith("." + suffix)) {
        const label = host.slice(0, -(suffix.length + 1));
        if (!label.includes(".")) return bySlug.get(label) || null; // subdominio desconocido → no existe
      }
    }
    return bySlug.get(def);
  }

  function isPlatformHost(hostHeader) {
    const host = hostOf(hostHeader);
    // PLATFORM_HOST: otra(s) dirección(es) para la plataforma, p. ej. la de Railway (*.up.railway.app)
    const extra = String(env.PLATFORM_HOST || "").split(",").map((h) => hostOf(h.trim().replace(/^\w+:\/\//, "").split("/")[0])).filter(Boolean);
    return extra.includes(host) || [domain, "localhost"].filter(Boolean).some((d) => host === `${PLATFORM_LABEL}.${d}`);
  }

  function handler(req, res) {
    if (isPlatformHost(req.headers.host)) return admin.handler(req, res);
    const t = resolve(req.headers.host);
    if (!t) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Este negocio no existe en la plataforma.");
    }
    return t.app(req, res);
  }

  function runReminders() {
    let n = 0;
    for (const t of tenants) {
      try { n += t.app.runReminders(); } catch (e) { log.error(`Recordatorios (${t.slug}):`, e.message); }
    }
    return n;
  }

  async function runBackups(hour = 3) {
    for (const t of tenants) {
      const now = nowIn(t.config.timeZone);
      const last = t.repo.setting("lastBackup", null);
      const lastDay = last ? nowIn(t.config.timeZone, new Date(last.at)).day : null;
      if (lastDay === now.day || now.minutes < hour * 60) continue;
      try {
        const res = await t.backups.run(`diaria · ${t.slug}`);
        t.repo.settingSet("lastBackup", { at: new Date().toISOString(), name: res.name, uploaded: res.uploaded });
      } catch (e) { log.error(`⚠  La copia de seguridad de ${t.slug} falló:`, e.message); }
    }
  }

  const close = () => { for (const t of tenants) { try { t.db.close(); } catch {} } try { pdb.close(); } catch {} };

  return { handler, resolve, isPlatformHost, tenants, domain, runReminders, runBackups, close, pdb };
}

module.exports = { createPlatform, migrateSplit, platformDomain };
