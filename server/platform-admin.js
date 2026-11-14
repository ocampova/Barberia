"use strict";
// Administración de la PLATAFORMA (plataforma.<dominio>): una sola cuenta para quien gestiona todos los negocios.
//  - Tablero con todos los negocios y sus números.
//  - "Entrar al panel" de un negocio: pase de un solo uso (60 s) → el negocio lo canjea por una cookie firmada,
//    válida solo para ESE negocio y por 8 horas. Cada entrada queda en el registro de accesos.
//  - Equipo de cada negocio: dar o quitar acceso a sus dueños/administradores.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { hashPassword, verifyPassword, DUMMY, newToken, tokenHash, parseCookies } = require("./auth");
const { addDays, nowIn } = require("./time");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const assets = require("./assets");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png" };
const COOKIE = "va_platform";       // sesión en plataforma.<dominio>
const BIZ_COOKIE = "va_plat";       // sesión de plataforma dentro de un negocio
const SESSION_DAYS = 14;
const ENTRY_HOURS = 8;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(now); hits.set(key, list);
    return true;
  };
}

function createPlatformAdmin({ tenants, pdb, env = process.env, log = console, clock = () => new Date() }) {
  const bySlug = new Map(tenants.map((t) => [t.slug, t]));
  const loginLimit = limiter(Number(env.LOGIN_RATE_LIMIT || 10), 15 * 60 * 1000);

  // Clave para firmar las cookies de entrada a los negocios (persistente entre reinicios)
  let secret = pdb.setting("entrySecret", null);
  if (!secret) { secret = crypto.randomBytes(32).toString("hex"); pdb.settingSet("entrySecret", secret); }
  const sign = (data) => crypto.createHmac("sha256", secret).update(data).digest("base64url");

  /* ---------- Cuenta de la plataforma (arranque) ---------- */
  const ownerEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (ownerEmail) {
    let owner = pdb.adminByEmail(ownerEmail);
    const pass = String(env.ADMIN_PASSWORD || "");
    if (!owner) {
      // Se crea con ADMIN_PASSWORD o, si no está, con la contraseña de su cuenta de administrador en algún negocio.
      let hash = pass.length >= 8 ? hashPassword(pass) : null, name = env.ADMIN_NAME || "Administración";
      if (!hash) {
        for (const t of tenants) {
          const u = t.repo.userByEmail(ownerEmail);
          if (u && u.role === "admin") { hash = u.pass_hash; name = u.name; break; }
        }
      }
      if (hash) {
        pdb.adminInsert(name, ownerEmail, hash);
        owner = pdb.adminByEmail(ownerEmail);
        log.log(`Plataforma: cuenta de administración creada para ${ownerEmail}.`);
      } else {
        log.warn("⚠  Plataforma: no se pudo crear la cuenta de ADMIN_EMAIL (falta ADMIN_PASSWORD de al menos 8 caracteres).");
      }
    } else if (env.ADMIN_FORCE === "1" && pass.length >= 8) {
      pdb.adminSetPass(owner.id, hashPassword(pass));
      pdb.sessionDeleteOthers(owner.id, "");
      log.warn("⚠  ADMIN_FORCE: la contraseña de la plataforma ahora es ADMIN_PASSWORD. Borra ADMIN_FORCE.");
    }
    // Una sola vez: las cuentas de administrador del dueño dentro de cada negocio pasan a ser de cliente
    // (su acceso es la plataforma; así no aparece en el equipo de los negocios ni pueden quitárselo).
    if (owner && !pdb.setting("ownerDemoted", false)) {
      for (const t of tenants) {
        const u = t.repo.userByEmail(ownerEmail);
        if (u && u.role === "admin") {
          t.repo.userSetRole(u.id, "cliente");
          t.repo.sessionDeleteOthers(u.id, "");
          log.log(`Plataforma: ${ownerEmail} ya no es administrador dentro de ${t.slug} (entra desde la plataforma).`);
        }
      }
      pdb.settingSet("ownerDemoted", true);
    }
  }

  /* ---------- Pases de entrada a los negocios ---------- */
  const passes = new Map(); // token → { slug, adminId, exp }
  function issuePass(slug, adminId) {
    const token = newToken();
    passes.set(token, { slug, adminId, exp: Date.now() + 60_000 });
    for (const [k, v] of passes) if (v.exp < Date.now()) passes.delete(k);
    return token;
  }

  // Lo usan los negocios (createApp → platformAuth)
  const platformAuth = {
    /** Canjea un pase de un solo uso. Devuelve el valor de la cookie o null. */
    redeem(token, slug) {
      const p = passes.get(String(token || ""));
      passes.delete(String(token || ""));
      if (!p || p.exp < Date.now() || p.slug !== slug) return null;
      const admin = pdb.adminById(p.adminId);
      if (!admin) return null;
      const payload = Buffer.from(JSON.stringify({ a: admin.id, s: slug, e: Date.now() + ENTRY_HOURS * 3600e3 })).toString("base64url");
      pdb.log(admin.id, slug, "entrar", "Entró al panel del negocio");
      return { cookie: `${payload}.${sign(payload)}`, maxAge: ENTRY_HOURS * 3600, name: BIZ_COOKIE };
    },
    /** Si la petición trae una entrada de plataforma válida para este negocio, devuelve quién es. */
    verify(req, slug) {
      const raw = parseCookies(req.headers.cookie)[BIZ_COOKIE];
      if (!raw) return null;
      const [payload, mac] = raw.split(".");
      if (!payload || !mac) return null;
      const want = Buffer.from(sign(payload)), got = Buffer.from(mac);
      if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
      let data; try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
      if (data.s !== slug || data.e < Date.now()) return null;
      const admin = pdb.adminById(data.a);
      return admin ? { id: admin.id, name: admin.name, email: admin.email } : null;
    },
    cookieName: BIZ_COOKIE,
    log: (adminId, slug, action, detail) => pdb.log(adminId, slug, action, detail),
  };

  /* ---------- Sesión en la plataforma ---------- */
  const secure = (req) => env.COOKIE_SECURE ? env.COOKIE_SECURE === "1"
    : Boolean(env.TRUST_PROXY && String(req.headers["x-forwarded-proto"] || "").startsWith("https")) || String(env.PUBLIC_URL || "").startsWith("https://");
  const setCookie = (req, res, value, maxAge) => res.setHeader("set-cookie",
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` + (secure(req) ? "; Secure" : ""));
  function currentAdmin(req) {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (!t) return null;
    const s = pdb.sessionGet(tokenHash(t));
    if (!s) return null;
    const a = pdb.adminById(s.admin_id);
    return a ? { ...a, sessionHash: tokenHash(t) } : null;
  }
  function requireAdmin(req) {
    const a = currentAdmin(req);
    if (!a) throw new HttpError(401, "Inicia sesión para continuar.");
    return a;
  }

  /* ---------- Números de cada negocio (solo lectura) ---------- */
  // "¿Cómo nos conociste?" de los clientes registrados desde `since`, de mayor a menor.
  function sourcesOf(t, since) {
    const labels = Object.fromEntries((t.config.sources || []).map((x) => [x.id, x.label]));
    return t.repo.sources(since).map((r) => ({ label: labels[r.source] || "Sin respuesta", count: r.n }))
      .sort((a, b) => b.count - a.count || (a.label === "Sin respuesta") - (b.label === "Sin respuesta"));
  }

  function stats(t) {
    const today = nowIn(t.config.timeZone, clock()).day;
    const month = today.slice(0, 7);
    const one = (sql, ...p) => t.db.prepare(sql).get(...p);
    const active = "status IN ('pendiente','confirmada','completada','no-asistio')";
    const file = t.dbFile && fs.existsSync(t.dbFile) ? fs.statSync(t.dbFile).size : null;
    return {
      clients: one("SELECT COUNT(*) AS n FROM users WHERE role = 'cliente'").n,
      newClients30: one("SELECT COUNT(*) AS n FROM users WHERE role = 'cliente' AND created_at >= ?",
        new Date(clock().getTime() - 30 * 86400e3).toISOString()).n,
      bookingsMonth: one(`SELECT COUNT(*) AS n FROM bookings WHERE day LIKE ? AND ${active}`, month + "%").n,
      pending: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pendiente' AND day >= ?", today).n,
      next7: one("SELECT COUNT(*) AS n FROM bookings WHERE status IN ('pendiente','confirmada') AND day BETWEEN ? AND ?",
        today, addDays(today, 7)).n,
      lastBooking: one("SELECT MAX(created_at) AS at FROM bookings").at,
      team: t.repo.admins().map((a) => ({ id: a.id, name: a.name, email: a.email })),
      lastBackup: t.repo.setting("lastBackup", null),
      dbBytes: file,
      sources: { d30: sourcesOf(t, new Date(clock().getTime() - 30 * 86400e3).toISOString()), all: sourcesOf(t, "0000") },
    };
  }

  /* ---------- Rutas ---------- */
  const routes = [];
  const route = (method, pattern, handler, auth = true) =>
    routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[\\w-]+)") + "$"), handler, auth });
  const tenantOf = (slug) => { const t = bySlug.get(slug); if (!t) throw new HttpError(404, "Negocio no encontrado."); return t; };

  route("POST", "/api/plataforma/login", ({ body, ip, req, res }) => {
    if (!loginLimit(ip)) throw new HttpError(429, "Demasiados intentos. Espera unos minutos.");
    const a = pdb.adminByEmail(String(body.email || "").trim().toLowerCase());
    const ok = verifyPassword(String(body.password || ""), a ? a.pass_hash : DUMMY) && Boolean(a);
    if (!ok) { pdb.log(null, null, "login-fallido", String(body.email || "").slice(0, 80)); throw new HttpError(401, "Correo o contraseña incorrectos."); }
    pdb.sessionPurge();
    const token = newToken();
    pdb.sessionInsert(tokenHash(token), a.id, Date.now() + SESSION_DAYS * 86400e3);
    setCookie(req, res, token, SESSION_DAYS * 86400);
    pdb.log(a.id, null, "login", "");
    return { admin: { name: a.name, email: a.email } };
  }, false);

  route("POST", "/api/plataforma/logout", ({ req, res }) => {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (t) pdb.sessionDelete(tokenHash(t));
    setCookie(req, res, "", 0);
    return { ok: true };
  }, false);

  route("GET", "/api/plataforma/me", ({ req }) => {
    const a = currentAdmin(req);
    return { admin: a ? { name: a.name, email: a.email } : null };
  }, false);

  route("POST", "/api/plataforma/password", ({ body, admin }) => {
    if (!verifyPassword(String(body.current || ""), admin.pass_hash)) throw new HttpError(400, "La contraseña actual no es correcta.");
    const p = String(body.password || "");
    if (p.length < 10) throw new HttpError(400, "Usa al menos 10 caracteres para la cuenta de la plataforma.");
    pdb.adminSetPass(admin.id, hashPassword(p));
    pdb.sessionDeleteOthers(admin.id, admin.sessionHash);
    pdb.log(admin.id, null, "password", "Cambió su contraseña");
    return { ok: true };
  });

  route("GET", "/api/plataforma/negocios", () => ({
    negocios: tenants.map((t) => ({
      slug: t.slug, name: t.config.name, place: t.config.place, url: t.url, logo: assets.versioned(t.config.logos.main),
      accent: t.config.theme.accent, logoBg: t.config.theme.palette?.bg || "#0b0a09", contact: t.app.contact(), staff: t.config.categories.map((c) => c.staff).filter(Boolean),
      stats: stats(t),
    })),
  }));

  route("POST", "/api/plataforma/negocios/:slug/entrar", ({ params, admin, req }) => {
    const t = tenantOf(params.slug);
    const base = t.url || businessOriginFromRequest(req, t.slug);
    return { url: `${base}/__plataforma?t=${encodeURIComponent(issuePass(t.slug, admin.id))}` };
  });

  route("POST", "/api/plataforma/negocios/:slug/equipo", ({ params, body, admin }) => {
    const t = tenantOf(params.slug);
    const raw = String(body.login || "").trim().toLowerCase();
    let key = raw;
    if (!raw.includes("@")) { key = raw.replace(/\D/g, ""); if (key.length === 8) key = (t.config.countryCode || "506") + key; }
    const u = key ? t.repo.userByLogin(key) : null;
    if (!u) throw new HttpError(404, `No hay ninguna cuenta con ese correo o teléfono en ${t.config.name}. La persona debe crear su cuenta primero en ${t.url || "la app del negocio"}.`);
    if (u.role === "admin") throw new HttpError(409, `${u.name} ya administra ${t.config.name}.`);
    t.repo.userSetRole(u.id, "admin");
    pdb.log(admin.id, t.slug, "equipo-agregar", `${u.name} <${u.email}>`);
    return { status: 201, body: { team: t.repo.admins().map((a) => ({ id: a.id, name: a.name, email: a.email })) } };
  });

  route("DELETE", "/api/plataforma/negocios/:slug/equipo/:id", ({ params, admin }) => {
    const t = tenantOf(params.slug);
    const u = t.repo.userById(Number(params.id));
    if (!u || u.role !== "admin") throw new HttpError(404, "Esa cuenta no administra este negocio.");
    t.repo.userSetRole(u.id, "cliente");
    t.repo.sessionDeleteOthers(u.id, "");
    pdb.log(admin.id, t.slug, "equipo-quitar", `${u.name} <${u.email}>`);
    return { team: t.repo.admins().map((a) => ({ id: a.id, name: a.name, email: a.email })) };
  });

  route("POST", "/api/plataforma/negocios/:slug/copia", async ({ params, admin }) => {
    const t = tenantOf(params.slug);
    const r = await t.backups.run(`manual desde la plataforma · ${t.slug}`);
    t.repo.settingSet("lastBackup", { at: new Date().toISOString(), name: r.name, uploaded: r.uploaded });
    pdb.log(admin.id, t.slug, "copia", r.name);
    return { status: 201, body: r };
  });

  // Datos de contacto del negocio: teléfono, WhatsApp y correo para las respuestas de los clientes.
  route("PUT", "/api/plataforma/negocios/:slug/contacto", ({ params, body, admin }) => {
    const t = tenantOf(params.slug);
    const before = t.app.contact();
    const after = t.app.setContact(body);
    const changes = Object.keys(after).filter((k) => before[k] !== after[k]);
    const LABELS = { phone: "teléfono", whatsapp: "WhatsApp", replyTo: "correo para respuestas", instagram: "Instagram", facebook: "Facebook" };
    if (changes.length) pdb.log(admin.id, t.slug, "contacto", changes.map((k) => `${LABELS[k]}: ${after[k] || "(vacío)"}`).join(" · "));
    return { contact: after };
  });

  // Descarga una copia recién hecha de la base de datos de un negocio (SQLite comprimida con gzip).
  route("GET", "/api/plataforma/negocios/:slug/copia/descargar", ({ params, admin }) => {
    const t = tenantOf(params.slug);
    const stamp = clock().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const data = t.backups.snapshot();
    pdb.log(admin.id, t.slug, "descarga", `${t.slug}-${stamp}.db.gz`);
    return { raw: { type: "application/gzip", filename: `${t.slug}-${stamp}.db.gz`, data } };
  });

  route("GET", "/api/plataforma/registro", () => ({
    entries: pdb.logList(100).map((l) => ({ at: l.at, who: l.admin_name || null, negocio: l.negocio, action: l.action, detail: l.detail })),
  }));

  function businessOriginFromRequest(req, slug) {
    const host = String(req.headers.host || "");
    const proto = (env.TRUST_PROXY && String(req.headers["x-forwarded-proto"] || "").split(",")[0]) || "http";
    return `${proto}://${host.replace(/^plataforma\./, slug + ".")}`;
  }

  /* ---------- HTTP ---------- */
  function sendJson(res, status, data) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  }
  async function readJson(req) {
    if (!["POST", "PATCH", "PUT"].includes(req.method)) return {};
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 16 * 1024) throw new HttpError(413, "Solicitud demasiado grande."); chunks.push(c); }
    if (!size) return {};
    try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8")); return v && typeof v === "object" ? v : {}; }
    catch { throw new HttpError(400, "JSON inválido."); }
  }
  function serveStatic(req, res, pathname) {
    if (pathname === "/" || pathname === "/index.html") pathname = "/plataforma.html";
    if (!/^\/(plataforma\.html|css\/[\w.-]+\.css|js\/plataforma\.js|img\/[\w./-]+\.(svg|png))$/.test(pathname)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("No encontrado");
    }
    const file = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    if (pathname === "/plataforma.html") {
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-cache, no-transform" });
      return res.end(assets.rewriteHtml(fs.readFileSync(file, "utf8")));
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": assets.cacheControl(new URL(req.url, "http://x").searchParams, pathname) });
    fs.createReadStream(file).pipe(res);
  }

  async function handler(req, res) {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("x-robots-tag", "noindex");
    const url = new URL(req.url, "http://localhost");
    const ip = (env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "") || req.socket.remoteAddress || "?";
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    }
    try {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, "Ruta no encontrada.");
      if (["POST", "PUT", "PATCH"].includes(req.method) && !String(req.headers["content-type"] || "").startsWith("application/json"))
        throw new HttpError(415, "Formato no soportado.");
      const admin = r.auth ? requireAdmin(req) : null;
      const body = await readJson(req);
      const out = await r.handler({ params: r.re.exec(url.pathname).groups || {}, body, ip, req, res, admin });
      if (out && out.raw) {
        res.writeHead(200, { "content-type": out.raw.type, "cache-control": "no-store",
          "content-disposition": `attachment; filename="${out.raw.filename}"` });
        return res.end(out.raw.data);
      }
      if (out && out.status && out.body) return sendJson(res, out.status, out.body);
      sendJson(res, 200, out);
    } catch (e) {
      // También los errores de validación de la app del negocio (otra clase, mismo formato)
      if (e instanceof HttpError || (Number.isInteger(e.status) && e.status >= 400 && e.status < 500)) return sendJson(res, e.status, { error: e.message });
      log.error(e);
      sendJson(res, 500, { error: "Algo salió mal. Intenta de nuevo." });
    }
  }

  return { handler, platformAuth };
}

module.exports = { createPlatformAdmin };
