"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { freeSlots, checkRanges, ACTIVE } = require("./availability");
const { isDay, addDays, nowIn, fmtTime, weekday } = require("./time");
const { render: renderEmail, renderReset } = require("./emails");
const { hashPassword, verifyPassword, DUMMY, newToken, tokenHash, parseCookies } = require("./auth");
const { createMailer } = require("./mailer");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
const ADMIN_STATUSES = new Set(["pendiente", "confirmada", "rechazada", "cancelada", "completada", "no-asistio"]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- Límite de peticiones sencillo, en memoria ---------- */
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(now); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return true;
  };
}

function createApp({ repo, config, env = process.env, clock = () => new Date(), notify, mailer, backups = null, related = [], platformAuth = null }) {
  // Copia propia: los datos de contacto se pueden cambiar desde la plataforma sin tocar el archivo del negocio.
  config = { ...config, replyTo: config.replyTo || env.EMAIL_REPLY_TO || "" };
  /* ---------- Servicios ---------- */
  // La primera vez se copian de config.services. Después se administran desde el panel.
  if (!repo.serviceCount()) {
    config.services.forEach((s, i) => repo.serviceSave({ id: s.id, category: s.cat, name: s.name,
      description: s.desc || "", price: s.price ?? null, minutes: s.min, popular: !!s.popular, active: true, sort: i * 10 }));
  }
  // Formato que usan la app y las plantillas de correo.
  const toPublicService = (s) => ({ id: s.id, cat: s.category, name: s.name, price: s.price, min: s.minutes,
    desc: s.description, popular: s.popular });
  const configForEmail = () => ({ ...config, services: repo.services().map(toPublicService) });
  const bookingLimit = limiter(Number(env.BOOKING_RATE_LIMIT || 8), 60 * 60 * 1000);
  const userLoginLimit = limiter(Number(env.LOGIN_RATE_LIMIT || 10), 15 * 60 * 1000);
  const registerLimit = limiter(Number(env.REGISTER_RATE_LIMIT || 6), 60 * 60 * 1000);
  const SESSION_DAYS = 60;
  const send = notify || makeNotifier(env.NOTIFY_URL);
  const mail = mailer || createMailer(env);
  const publicUrl = (env.PUBLIC_URL || "").replace(/\/+$/, "");

  function siteUrl(req) {
    if (publicUrl) return publicUrl;
    if (!req) return null;
    const proto = (env.TRUST_PROXY && String(req.headers["x-forwarded-proto"] || "").split(",")[0]) || "http";
    return req.headers.host ? `${proto}://${req.headers.host}` : null;
  }

  // Envía un correo al cliente sin hacer esperar la respuesta. Devuelve true si se intentó.
  function emailClient(kind, b, req, extra = {}) {
    if (!b.email) return false;
    const site = siteUrl(req);
    const link = site ? `${site}/?citas=1` : null;
    let msg;
    try { msg = renderEmail(kind, b, configForEmail(), { link, siteUrl: site, ...extra }); }
    catch (e) { console.error("Plantilla de correo:", e.message); return false; }
    Promise.resolve(mail.send({ to: b.email, replyTo: config.replyTo, ...msg }))
      .catch((e) => console.error(`No se pudo enviar el correo (${kind}) a la cita ${b.id}:`, e.message));
    return mail.enabled !== false;
  }

  const now = () => nowIn(config.timeZone, clock());

  /* ---------- Utilidades ---------- */
  function resolveServices(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 5 || new Set(ids).size !== ids.length)
      throw new HttpError(400, "Elige entre 1 y 5 servicios.");
    const list = ids.map((id) => (typeof id === "string" ? repo.service(id) : null));
    if (list.some((s) => !s || !s.active)) throw new HttpError(400, "Uno de los servicios ya no está disponible.");
    const category = list[0].category;
    if (list.some((s) => s.category !== category))
      throw new HttpError(400, "Reserva los servicios de barbería y de salón por separado.");
    const minutes = list.reduce((t, s) => t + s.minutes, 0);
    const total = list.some((s) => s.price == null) ? null : list.reduce((t, s) => t + s.price, 0);
    return { list, category, minutes, total };
  }

  /* ---------- Horario ---------- */
  // La primera vez, el horario semanal se copia de config.hours. Después se edita desde el panel.
  for (const c of config.categories) {
    const week = repo.weekGet(c.id);
    for (let wd = 0; wd < 7; wd++)
      if (!week[wd]) repo.weekSet(c.id, wd, config.hours[wd] ? [config.hours[wd]] : []);
  }
  const categoryIds = new Set(config.categories.map((c) => c.id));

  /** Turnos de trabajo de un día: la excepción de esa fecha o, si no hay, el horario semanal. */
  function rangesFor(category, day) {
    const special = repo.dayGet(category, day);
    if (special) return special;
    return repo.weekGet(category)[weekday(day)] || [];
  }

  const slotsFor = (category, day, minutes, nowArg = now()) =>
    freeSlots({ config, category, day, minutes, ranges: rangesFor(category, day),
      bookings: repo.bookingsOn(day), blocks: repo.blocksOn(day), now: nowArg });

  function openStatus(category) {
    const n = now();
    const today = rangesFor(category, n.day);
    const cur = today.find(([a, b]) => n.minutes >= a && n.minutes < b);
    if (cur) return { open: true, closesAt: cur[1] };
    const later = today.find(([a]) => a > n.minutes);
    if (later) return { open: false, opensAt: later[0], opensDay: n.day };
    for (let i = 1; i <= 14; i++) {
      const d = addDays(n.day, i), r = rangesFor(category, d);
      if (r.length) return { open: false, opensAt: r[0][0], opensDay: d };
    }
    return { open: false };
  }

  const publicBooking = (b) => ({
    id: b.id, day: b.day, start: b.start, minutes: b.minutes, services: b.services, category: b.category,
    total: b.total, status: b.status, note: b.note,
  });

  /* ---------- Sesiones de clientes ---------- */
  const COOKIE = "va_sid";
  function secureCookie(req) {
    if (env.COOKIE_SECURE) return env.COOKIE_SECURE === "1";
    if (publicUrl.startsWith("https://")) return true;
    return Boolean(env.TRUST_PROXY && String(req.headers["x-forwarded-proto"] || "").startsWith("https"));
  }
  function setSessionCookie(req, res, token, maxAgeSec) {
    res.setHeader("set-cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` +
      (secureCookie(req) ? "; Secure" : ""));
  }
  function startSession(req, res, userId) {
    const token = newToken();
    repo.sessionInsert(tokenHash(token), userId, Date.now() + SESSION_DAYS * 86400e3);
    setSessionCookie(req, res, token, SESSION_DAYS * 86400);
    return token;
  }
  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const sess = repo.sessionGet(tokenHash(token));
    if (!sess) return null;
    const u = repo.userById(sess.user_id);
    return u ? { ...u, sessionHash: tokenHash(token) } : null;
  }
  function requireUser(req) {
    const u = currentUser(req);
    if (!u) throw new HttpError(401, "Inicia sesión para continuar.");
    return u;
  }
  const publicUser = (u) => ({ id: u.id, name: u.name, phone: u.phone, email: u.email, since: u.created_at,
    admin: u.role === "admin", ...(u.role === "admin" ? { agenda: u.agenda || "" } : {}) });
  function requireAdmin(req) {
    const u = currentUser(req);
    if (u && u.role === "admin") return u;
    // Administración de la plataforma: entrada firmada, válida solo para este negocio.
    const p = platformAuth ? platformAuth.verify(req, config.slug) : null;
    if (p) return { id: -1, name: p.name, email: p.email, role: "admin", agenda: "", platform: true, platformAdminId: p.id };
    if (!u) throw new HttpError(401, "Inicia sesión para continuar.");
    throw new HttpError(403, "Esta cuenta no tiene acceso al panel.");
  }

  function cleanPassword(v) {
    const p = String(v ?? "");
    if (p.length < 8) throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
    if (p.length > 200) throw new HttpError(400, "La contraseña es demasiado larga.");
    return p;
  }
  function checkUnique({ phone, email }, exceptId) {
    const byPhone = repo.userByPhone(phone);
    if (byPhone && byPhone.id !== exceptId) throw new HttpError(409, "Ya existe una cuenta con ese teléfono. ¿Quieres iniciar sesión?");
    const byEmail = repo.userByEmail(email);
    if (byEmail && byEmail.id !== exceptId) throw new HttpError(409, "Ya existe una cuenta con ese correo. ¿Quieres iniciar sesión?");
  }

  function cleanPhone(raw) {
    let p = String(raw || "").replace(/\D/g, "");
    if (p.length === 8) p = config.countryCode + p;
    if (p.length < 10 || p.length > 15) throw new HttpError(400, "Escribe un teléfono válido (8 dígitos).");
    return p;
  }
  function cleanEmail(v) {
    const e = String(v ?? "").trim().toLowerCase();
    if (!e) return "";
    if (e.length > 120 || !/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/.test(e))
      throw new HttpError(400, "Revisa tu correo electrónico.");
    return e;
  }
  function cleanText(v, max, field, required) {
    const s = String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (required && s.length < 2) throw new HttpError(400, `Escribe tu ${field}.`);
    if (s.length > max) throw new HttpError(400, `El campo ${field} es demasiado largo.`);
    return s;
  }
  function parseSlot(day, start) {
    if (!isDay(day)) throw new HttpError(400, "Fecha inválida.");
    if (!Number.isInteger(start) || start < 0 || start >= 1440) throw new HttpError(400, "Hora inválida.");
  }

  /* ---------- Ajustes del negocio ---------- */
  const cancelHours = () => repo.setting("cancelHours", config.cancelHours ?? 0);
  // Recordatorio por correo: horas antes de la cita (0 = no se envía).
  const reminderHours = () => repo.setting("reminderHours", config.reminderHoursBefore ?? 24);
  // Segundo recordatorio, solo para clientes con historial (0 = no se envía).
  const reminderExtraHours = () => repo.setting("reminderExtraHours", config.reminderExtraHours ?? 3);

  /* ---------- Historial de cancelaciones y ausencias ---------- */
  const HISTORY_DAYS = 180;
  // Un cliente "con historial": no vino al menos una vez, canceló 2 veces a última hora (< 24 h) o canceló 3 veces.
  function clientHistory(phone) {
    if (!phone) return null;
    const h = repo.history(phone, addDays(now().day, -HISTORY_DAYS));
    return { ...h, flagged: h.noShows >= 1 || h.late >= 2 || h.cancels >= 3 };
  }
  // Minutos que faltan para la cita (0 si ya empezó).
  function minutesUntil(b) {
    const n = now();
    const m = (Date.parse(b.day + "T00:00:00Z") - Date.parse(n.day + "T00:00:00Z")) / 60000 + b.start - n.minutes;
    return Math.max(0, Math.round(m));
  }
  const sourceIds = new Set((config.sources || []).map((x) => x.id));

  /* ---------- Primer administrador ---------- */
  // Con ADMIN_EMAIL y ADMIN_PASSWORD, al arrancar se crea esa cuenta de administrador si no existe.
  // Nunca se promueve una cuenta que ya existía (alguien pudo registrarla antes con ese correo),
  // salvo con ADMIN_FORCE=1: recuperación explícita desde el hosting, que además fija la contraseña.
  if (!env.ADMIN_EMAIL) {
    if (!repo.admins().length && !platformAuth) console.warn("⚠  No hay administradores y falta ADMIN_EMAIL: nadie puede entrar al panel.");
  } else {
    const email = String(env.ADMIN_EMAIL).trim().toLowerCase();
    const password = String(env.ADMIN_PASSWORD || "");
    const force = env.ADMIN_FORCE === "1";
    const existing = repo.userByEmail(email);
    if (password && password.length < 8) {
      console.warn("⚠  ADMIN_PASSWORD es muy corta (mínimo 8 caracteres): no se usó.");
    } else if (existing && force && password) {
      repo.userSetRole(existing.id, "admin");
      repo.userSetPass(existing.id, hashPassword(password));
      repo.sessionDeleteOthers(existing.id, "");
      console.log(`ADMIN_FORCE: ${email} es administrador y su contraseña es ADMIN_PASSWORD. Borra ADMIN_FORCE ahora.`);
    } else if (existing && existing.role !== "admin") {
      console.warn(`⚠  ${email} ya tiene una cuenta de cliente: no se convirtió en administrador. ` +
        "Para hacerlo, agrega ADMIN_FORCE=1 (y bórrala después) o usa: npm run admin -- " + email);
    } else if (existing) {
      console.log(`Administrador ${email}: la cuenta ya existe (su contraseña se cambia desde el perfil, no con ADMIN_PASSWORD).`);
    } else if (!password) {
      console.warn("⚠  ADMIN_EMAIL sin ADMIN_PASSWORD: no se creó el administrador.");
    } else {
      const id = repo.userInsert({ name: env.ADMIN_NAME || config.name, phone: cleanPhoneRaw(env.ADMIN_PHONE),
        email, pass_hash: hashPassword(password) });
      repo.userSetRole(id, "admin");
      console.log(`Administrador creado: ${email}. Cambia la contraseña desde el perfil después de entrar.`);
    }
  }
  function cleanPhoneRaw(v) {
    let p = String(v || "").replace(/\D/g, "");
    if (p.length === 8) p = config.countryCode + p;
    return p.length >= 10 && p.length <= 15 ? p : "";
  }

  /* ---------- Rutas ---------- */
  const routes = [];
  const route = (method, pattern, handler, opts = {}) =>
    routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[\\w-]+)") + "$"), handler, ...opts });

  route("GET", "/api/health", () => ({ ok: true }));

  route("GET", "/api/config", () => {
    const { slug, name, shortName, tagline, place, hero, slogan, city, location, mapsUrl, phone, whatsapp, currency,
      slotStepMinutes, daysAhead, policies, categories, theme, logos } = config;
    const all = repo.services();
    return { slug, name, shortName: shortName || name, tagline, place, dePlace: dePlace(place), hero, slogan, city, location, mapsUrl, phone, whatsapp, currency,
      theme, logos, related,
      slotStepMinutes, daysAhead, policies,
      categories: categories.map(({ id, name, staff, brand, place }) => ({ id, name, staff: staff || null, brand: brand || name, place: place || null })),
      status: openStatus(categories[0].id),
      services: all.filter((x) => x.active).map(toPublicService),
      retired: all.filter((x) => !x.active).map(({ id, name }) => ({ id, name })),
      today: now().day, nowMinutes: now().minutes, emailEnabled: mail.enabled !== false,
      cancelHours: cancelHours(), sources: config.sources || [], privacyVersion: config.privacyVersion };
  });

  // Resumen de varios días: cuántos espacios libres hay en cada uno.
  route("GET", "/api/availability", ({ query }) => {
    const { category, minutes } = resolveServices(String(query.get("services") || "").split(",").filter(Boolean));
    const from = query.get("from") || now().day;
    if (!isDay(from)) throw new HttpError(400, "Fecha inválida.");
    const days = Math.min(Math.max(Number(query.get("days") || 1), 1), config.daysAhead + 1);
    const out = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      out.push({ day, open: rangesFor(category, day).length > 0, slots: slotsFor(category, day, minutes) });
    }
    return { minutes, days: out };
  });

  route("POST", "/api/bookings", ({ body, ip, req }) => {
    const user = requireUser(req);
    if (!bookingLimit(ip)) throw new HttpError(429, "Demasiados intentos. Prueba de nuevo más tarde.");
    const { list, category, minutes, total } = resolveServices(body.services);
    parseSlot(body.day, body.start);
    const { name, phone, email } = user;
    const note = cleanText(body.note, 200, "nota", false);
    if (body.website) throw new HttpError(400, "Solicitud inválida."); // campo trampa para bots

    const booking = repo.transaction(() => {
      if (repo.activeByUser(user.id, now().day) >= config.maxActivePerPhone)
        throw new HttpError(429, "Ya tienes varias citas activas. Escríbenos por WhatsApp si necesitas otra.");
      if (!slotsFor(category, body.day, minutes).includes(body.start))
        throw new HttpError(409, "Ese espacio acaba de ocuparse. Elige otra hora.");
      const ts = new Date().toISOString();
      const b = {
        id: crypto.randomBytes(6).toString("base64url"),
        token: crypto.randomBytes(18).toString("base64url"),
        category, day: body.day, start: body.start, minutes, services: list.map((s) => s.id), total,
        name, phone, email, note, status: "pendiente", source: "web", created_at: ts, updated_at: ts,
        user_id: user.id,
      };
      repo.insertBooking(b);
      return b;
    });
    emailClient("recibida", booking, req);

    send(`Nueva reserva: ${name}`, `${list.map((s) => s.name).join(" + ")}\n${booking.day} · ${fmtTime(booking.start)}\nTel: ${phone}${note ? "\nNota: " + note : ""}`);
    return { status: 201, body: publicBooking(booking) };
  });

  route("GET", "/api/me/bookings", ({ req }) => {
    const user = requireUser(req);
    return { bookings: repo.bookingsByUser(user.id).map(publicBooking), today: now().day };
  });

  route("POST", "/api/bookings/:id/cancel", ({ params, req }) => {
    const user = requireUser(req);
    const b = repo.bookingById(params.id);
    if (!b || b.user_id !== user.id) throw new HttpError(404, "No encontramos esa cita.");
    const n = now();
    if (!ACTIVE.has(b.status)) throw new HttpError(409, "Esta cita ya no está activa.");
    if (b.day < n.day || (b.day === n.day && b.start <= n.minutes)) throw new HttpError(409, "Esta cita ya pasó.");
    const hours = cancelHours();
    const minutesLeft = (Date.parse(b.day + "T00:00:00Z") - Date.parse(n.day + "T00:00:00Z")) / 60000 + b.start - n.minutes;
    if (hours > 0 && minutesLeft < hours * 60)
      throw new HttpError(409, `Las citas se pueden cancelar desde la app hasta ${hours} ${hours === 1 ? "hora" : "horas"} antes. Escríbenos por WhatsApp.`);
    repo.setCancelled(b.id, "cliente", minutesUntil(b));
    emailClient("cancelada", b, req, { byClient: true });
    send(`Cita cancelada: ${b.name}`, `${b.day} · ${fmtTime(b.start)} quedó libre.`);
    return publicBooking({ ...b, status: "cancelada" });
  });

  /* ---------- Cuentas de clientes ---------- */
  route("POST", "/api/auth/register", ({ body, ip, req, res }) => {
    if (!registerLimit(ip)) throw new HttpError(429, "Demasiados registros desde esta conexión. Intenta más tarde.");
    if (body.website) throw new HttpError(400, "Solicitud inválida.");
    const u = {
      name: cleanText(body.name, 60, "nombre", true),
      phone: cleanPhone(body.phone),
      email: cleanEmail(body.email),
    };
    if (!u.email) throw new HttpError(400, "Escribe tu correo electrónico.");
    const password = cleanPassword(body.password);
    if (body.acceptPrivacy !== true) throw new HttpError(400, "Debes aceptar el aviso de privacidad para crear tu cuenta.");
    const source = sourceIds.has(body.source) ? body.source : "";
    const id = repo.transaction(() => {
      checkUnique(u);
      const newId = repo.userInsert({ ...u, pass_hash: hashPassword(password) });
      repo.userSetSignup(newId, source, config.privacyVersion || "1");
      return newId;
    });
    startSession(req, res, id);
    return { status: 201, body: { user: publicUser(repo.userById(id)) } };
  });

  route("POST", "/api/auth/login", ({ body, ip, req, res }) => {
    if (!userLoginLimit(ip)) throw new HttpError(429, "Demasiados intentos. Espera unos minutos.");
    const raw = String(body.login || "").trim();
    const password = String(body.password || "");
    let key = raw.toLowerCase();
    if (!raw.includes("@")) { try { key = cleanPhone(raw); } catch { key = ""; } }
    const u = key ? repo.userByLogin(key) : null;
    const ok = verifyPassword(password, u ? u.pass_hash : DUMMY) && Boolean(u);
    if (!ok) throw new HttpError(401, "Correo, teléfono o contraseña incorrectos.");
    repo.sessionPurge();
    startSession(req, res, u.id);
    return { user: publicUser(u) };
  });

  route("POST", "/api/auth/logout", ({ req, res }) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) repo.sessionDelete(tokenHash(token));
    const cookies = [`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (secureCookie(req) ? "; Secure" : "")];
    if (platformAuth) cookies.push(`${platformAuth.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (secureCookie(req) ? "; Secure" : ""));
    res.setHeader("set-cookie", cookies);
    return { ok: true };
  });

  route("GET", "/api/me", ({ req }) => {
    const u = currentUser(req);
    const p = platformAuth ? platformAuth.verify(req, config.slug) : null;
    return { user: u ? publicUser(u) : null, platform: p ? { name: p.name, email: p.email } : null };
  });

  route("PATCH", "/api/me", ({ body, req }) => {
    const user = requireUser(req);
    const u = {
      name: cleanText(body.name, 60, "nombre", true),
      phone: cleanPhone(body.phone),
      email: cleanEmail(body.email),
    };
    if (!u.email) throw new HttpError(400, "Escribe tu correo electrónico.");
    repo.transaction(() => { checkUnique(u, user.id); repo.userUpdate(user.id, u); });
    return { user: publicUser(repo.userById(user.id)) };
  });

  route("POST", "/api/me/password", ({ body, req }) => {
    const user = requireUser(req);
    if (!verifyPassword(String(body.current || ""), user.pass_hash))
      throw new HttpError(400, "La contraseña actual no es correcta.");
    repo.userSetPass(user.id, hashPassword(cleanPassword(body.password)));
    repo.sessionDeleteOthers(user.id, user.sessionHash); // cierra la sesión en otros aparatos
    return { ok: true };
  });

  // Siempre responde lo mismo, exista o no la cuenta, para no revelar qué correos están registrados.
  route("POST", "/api/auth/forgot", ({ body, ip, req }) => {
    if (!userLoginLimit(ip)) throw new HttpError(429, "Demasiados intentos. Espera unos minutos.");
    const email = String(body.email || "").trim().toLowerCase();
    const u = email ? repo.userByEmail(email) : null;
    const site = siteUrl(req);
    if (u && site && mail.enabled !== false) {
      const token = newToken();
      repo.resetPurgeUser(u.id);
      repo.resetInsert(tokenHash(token), u.id, Date.now() + 3600e3);
      const msg = renderReset(u, config, `${site}/?reset=${token}`);
      Promise.resolve(mail.send({ to: u.email, replyTo: config.replyTo, ...msg }))
        .catch((e) => console.error("No se pudo enviar el correo de contraseña:", e.message));
    }
    return { ok: true, emailEnabled: mail.enabled !== false };
  });

  route("POST", "/api/auth/reset", ({ body, req, res }) => {
    const password = cleanPassword(body.password);
    const uid = repo.resetTake(tokenHash(String(body.token || "")));
    if (!uid) throw new HttpError(400, "El enlace venció o ya se usó. Pide uno nuevo.");
    repo.userSetPass(uid, hashPassword(password));
    repo.sessionDeleteOthers(uid, "");
    startSession(req, res, uid);
    return { user: publicUser(repo.userById(uid)) };
  });

  /* ---------- Panel ---------- */
  route("GET", "/api/admin/settings", () => ({ cancelHours: cancelHours(), reminderHours: reminderHours(),
    reminderExtraHours: reminderExtraHours(), emailEnabled: mail.enabled !== false }), { admin: true });

  // Las copias de seguridad se manejan desde la plataforma (server/platform-admin.js).

  route("PUT", "/api/admin/settings", ({ body }) => {
    const out = {};
    const take = (key, max, msg) => {
      if (body[key] === undefined) return;
      const h = Number(body[key]);
      if (!Number.isInteger(h) || h < 0 || h > max) throw new HttpError(400, msg);
      repo.settingSet(key, h); out[key] = h;
    };
    take("cancelHours", 72, "El plazo debe ser entre 0 y 72 horas.");
    take("reminderHours", 72, "El recordatorio debe ser entre 0 y 72 horas antes.");
    take("reminderExtraHours", 24, "El segundo recordatorio debe ser entre 0 y 24 horas antes.");
    if (!Object.keys(out).length) throw new HttpError(400, "Nada que cambiar.");
    return out;
  }, { admin: true });

  // "¿Cómo nos conociste?": el resumen está en la plataforma (server/platform-admin.js), no en el panel.

  // Equipo: cuentas con acceso al panel.
  route("GET", "/api/admin/team", () => ({ admins: repo.admins() }), { admin: true });

  route("POST", "/api/admin/team", ({ body }) => {
    const raw = String(body.login || "").trim();
    let key = raw.toLowerCase();
    if (!raw.includes("@")) key = cleanPhoneRaw(raw);
    const u = key ? repo.userByLogin(key) : null;
    if (!u) throw new HttpError(404, "No hay ninguna cuenta con ese correo o teléfono. La persona debe crear su cuenta primero en la app.");
    if (u.role === "admin") throw new HttpError(409, `${u.name} ya tiene acceso al panel.`);
    repo.userSetRole(u.id, "admin");
    return { status: 201, body: { admins: repo.admins() } };
  }, { admin: true });

  // Asignar la agenda que atiende cada persona del equipo ('' = todas).
  route("PUT", "/api/admin/team/:id", ({ params, body }) => {
    const id = Number(params.id);
    const u = repo.userById(id);
    if (!u || u.role !== "admin") throw new HttpError(404, "Esa cuenta no es administradora.");
    const agenda = String(body.agenda || "");
    if (agenda && !categoryIds.has(agenda)) throw new HttpError(400, "Agenda inválida.");
    repo.userSetAgenda(id, agenda);
    return { admins: repo.admins() };
  }, { admin: true });

  route("DELETE", "/api/admin/team/:id", ({ params, req }) => {
    const me = requireAdmin(req);
    const id = Number(params.id);
    if (id === me.id) throw new HttpError(409, "No puedes quitarte el acceso a ti mismo.");
    const u = repo.userById(id);
    if (!u || u.role !== "admin") throw new HttpError(404, "Esa cuenta no es administradora.");
    repo.userSetRole(id, "cliente");
    repo.sessionDeleteOthers(id, ""); // cierra sus sesiones abiertas
    return { admins: repo.admins() };
  }, { admin: true });

  route("GET", "/api/admin/summary", () => ({
    pending: repo.pendingCount(now().day), pendingBy: repo.pendingByCategory(now().day),
    today: now().day, emailEnabled: mail.enabled !== false,
    reminderExtraHours: mail.enabled !== false ? reminderExtraHours() : 0,
  }), { admin: true });

  route("GET", "/api/admin/bookings", ({ query }) => {
    const from = query.get("from") || now().day;
    const to = query.get("to") || addDays(from, 30);
    if (!isDay(from) || !isDay(to)) throw new HttpError(400, "Fecha inválida.");
    const status = query.get("status");
    const list = repo.bookingsRange(from, to).filter((b) => !status || b.status === status);
    const hist = new Map();
    const historyOf = (phone) => { if (!hist.has(phone)) hist.set(phone, clientHistory(phone)); return hist.get(phone); };
    return { bookings: list.map(({ token, ...b }) => ({ ...b, history: historyOf(b.phone) })), blocks: repo.blocksRange(from, to) };
  }, { admin: true });

  route("PATCH", "/api/admin/bookings/:id", ({ params, body, req }) => {
    if (!ADMIN_STATUSES.has(body.status)) throw new HttpError(400, "Estado inválido.");
    const b = repo.bookingById(params.id);
    if (!b) throw new HttpError(404, "Cita no encontrada.");
    if (ACTIVE.has(body.status) && !ACTIVE.has(b.status)) {
      // Reactivar una cita: el espacio tiene que seguir libre.
      const others = repo.bookingsOn(b.day).filter((x) => x.id !== b.id);
      const free = freeSlots({ config, category: b.category, day: b.day, minutes: b.minutes,
        ranges: rangesFor(b.category, b.day), bookings: others, blocks: repo.blocksOn(b.day), now: null });
      if (!free.includes(b.start)) throw new HttpError(409, "Ese espacio ya está ocupado.");
    }
    // Al cancelar, el panel indica quién canceló: el cliente (avisó por WhatsApp, llamada…) o el negocio.
    const by = body.status === "cancelada" ? (body.by === "cliente" ? "cliente" : "negocio") : "";
    if (by) repo.setCancelled(b.id, by, minutesUntil(b)); else repo.setStatus(b.id, body.status);
    const changed = b.status !== body.status;
    const emailed = changed && ["confirmada", "rechazada", "cancelada"].includes(body.status)
      ? emailClient(body.status, b, req, by === "cliente" ? { byRequest: true } : {}) : false;
    const { token, ...rest } = b;
    return { ...rest, status: body.status, cancelled_by: by, emailed, history: clientHistory(b.phone) };
  }, { admin: true });

  // Cita creada por el barbero (llamada, cliente en el local).
  route("POST", "/api/admin/bookings", ({ body, req }) => {
    const { list, category, minutes, total } = resolveServices(body.services);
    parseSlot(body.day, body.start);
    const name = cleanText(body.name, 60, "nombre", true);
    const phone = body.phone ? cleanPhone(body.phone) : "";
    const email = cleanEmail(body.email);
    const note = cleanText(body.note, 200, "nota", false);
    const created = repo.transaction(() => {
      const free = slotsFor(category, body.day, minutes, null);
      if (!body.force && !free.includes(body.start)) throw new HttpError(409, "Ese espacio está ocupado o fuera de horario.");
      const ts = new Date().toISOString();
      const b = {
        id: crypto.randomBytes(6).toString("base64url"), token: crypto.randomBytes(18).toString("base64url"),
        category, day: body.day, start: body.start, minutes, services: list.map((s) => s.id), total,
        name, phone, email, note, status: "confirmada", source: "panel", created_at: ts, updated_at: ts,
      };
      repo.insertBooking(b);
      return b;
    });
    const emailed = emailClient("confirmada", created, req);
    const { token, ...rest } = created;
    return { status: 201, body: { ...rest, emailed } };
  }, { admin: true });

  route("POST", "/api/admin/blocks", ({ body }) => {
    if (!isDay(body.day)) throw new HttpError(400, "Fecha inválida.");
    const start = Number(body.start), end = Number(body.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || end <= start)
      throw new HttpError(400, "Horario inválido.");
    const category = body.category ? String(body.category) : null;
    if (category && !config.categories.some((c) => c.id === category)) throw new HttpError(400, "Categoría inválida.");
    const id = repo.insertBlock({ category, day: body.day, start, end, reason: cleanText(body.reason, 80, "motivo", false) });
    return { status: 201, body: { id } };
  }, { admin: true });

  route("DELETE", "/api/admin/blocks/:id", ({ params }) => {
    if (!repo.deleteBlock(Number(params.id))) throw new HttpError(404, "Bloqueo no encontrado.");
    return { ok: true };
  }, { admin: true });

  /* ---------- Servicios (panel) ---------- */
  function cleanService(body) {
    const category = parseCategory(body.category);
    const name = cleanText(body.name, 60, "nombre", true);
    const description = cleanText(body.description, 200, "descripción", false);
    const minutes = Number(body.minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480 || minutes % 5)
      throw new HttpError(400, "La duración debe ir de 5 en 5 minutos, entre 5 y 480.");
    let price = body.price;
    if (price === "" || price === null || price === undefined) price = null;
    else {
      price = Number(price);
      if (!Number.isInteger(price) || price < 0 || price > 10_000_000) throw new HttpError(400, "Precio inválido.");
    }
    return { category, name, description, minutes, price, popular: Boolean(body.popular), active: body.active !== false };
  }
  function slugFor(name) {
    const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "servicio";
    let id = base, i = 2;
    while (repo.service(id)) id = `${base}-${i++}`;
    return id;
  }

  route("GET", "/api/admin/services", () => ({ services: repo.services() }), { admin: true });

  route("POST", "/api/admin/services", ({ body }) => {
    const s = cleanService(body);
    const all = repo.services();
    const sort = all.length ? Math.max(...all.map((x) => x.sort)) + 10 : 0;
    const id = slugFor(s.name);
    repo.serviceSave({ id, ...s, sort });
    return { status: 201, body: repo.service(id) };
  }, { admin: true });

  route("PUT", "/api/admin/services/:id", ({ params, body }) => {
    const cur = repo.service(params.id);
    if (!cur) throw new HttpError(404, "Servicio no encontrado.");
    repo.serviceSave({ id: cur.id, ...cleanService(body), sort: cur.sort });
    return repo.service(cur.id);
  }, { admin: true });

  // Solo se borran servicios sin citas. Los demás se ocultan, para no perder el historial.
  route("DELETE", "/api/admin/services/:id", ({ params }) => {
    const cur = repo.service(params.id);
    if (!cur) throw new HttpError(404, "Servicio no encontrado.");
    if (repo.serviceUsed(cur.id)) throw new HttpError(409, "Este servicio tiene citas registradas. Ocúltalo en lugar de borrarlo.");
    repo.serviceDelete(cur.id);
    return { ok: true };
  }, { admin: true });

  route("PUT", "/api/admin/services-order", ({ body }) => {
    const ids = body.ids;
    const all = repo.services();
    if (!Array.isArray(ids) || ids.length !== all.length || new Set(ids).size !== ids.length || ids.some((id) => !repo.service(id)))
      throw new HttpError(400, "Orden inválido.");
    repo.transaction(() => ids.forEach((id, i) => { const s = repo.service(id); repo.serviceSave({ ...s, sort: i * 10 }); }));
    return { services: repo.services() };
  }, { admin: true });

  /* ---------- Horario (panel) ---------- */
  function parseCategory(v) {
    const c = String(v || "");
    if (!categoryIds.has(c)) throw new HttpError(400, "Categoría inválida.");
    return c;
  }

  // Horario resuelto de un rango de fechas, con las citas activas de cada día.
  route("GET", "/api/admin/schedule", ({ query }) => {
    const category = parseCategory(query.get("category"));
    const from = query.get("from") || now().day;
    const to = query.get("to") || addDays(from, 41);
    if (!isDay(from) || !isDay(to) || to < from || to > addDays(from, 120)) throw new HttpError(400, "Rango inválido.");
    const week = repo.weekGet(category);
    const special = repo.daysRange(category, from, to);
    const active = {};
    for (const b of repo.bookingsRange(from, to))
      if (b.category === category && ACTIVE.has(b.status)) active[b.day] = (active[b.day] || 0) + 1;
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days.push({ day: d, ranges: special[d] || week[weekday(d)] || [], special: Boolean(special[d]), bookings: active[d] || 0 });
    }
    return { category, week, days, today: now().day };
  }, { admin: true });

  route("PUT", "/api/admin/schedule/week", ({ body }) => {
    const category = parseCategory(body.category);
    const week = body.week || {};
    for (let wd = 0; wd < 7; wd++) {
      const r = week[wd];
      if (!r) throw new HttpError(400, "Falta el horario de algún día.");
      const err = checkRanges(r);
      if (err) throw new HttpError(400, err);
    }
    repo.transaction(() => { for (let wd = 0; wd < 7; wd++) repo.weekSet(category, wd, week[wd]); });
    return { ok: true, week: repo.weekGet(category) };
  }, { admin: true });

  // Abrir, cerrar o cambiar el horario de uno o varios días.
  // ranges: [[inicio, fin], ...] para abrir con ese horario, [] para cerrar, null para volver al horario semanal.
  route("PUT", "/api/admin/schedule/days", ({ body }) => {
    const category = parseCategory(body.category);
    const days = body.days;
    if (!Array.isArray(days) || !days.length || days.length > 400 || days.some((d) => !isDay(d)))
      throw new HttpError(400, "Elige al menos un día válido.");
    const ranges = body.ranges;
    if (ranges !== null) {
      const err = checkRanges(ranges);
      if (err) throw new HttpError(400, err);
    }
    repo.transaction(() => {
      for (const d of days) ranges === null ? repo.dayDelete(category, d) : repo.daySet(category, d, ranges);
    });
    // Citas activas que quedan fuera del nuevo horario: no se cancelan solas, se avisan.
    const outside = [];
    for (const d of days) {
      const r = rangesFor(category, d);
      for (const b of repo.bookingsOn(d))
        if (b.category === category && ACTIVE.has(b.status) &&
            !r.some(([a, z]) => b.start >= a && b.start + b.minutes <= z))
          outside.push({ id: b.id, day: b.day, start: b.start, name: b.name });
    }
    return { ok: true, outside };
  }, { admin: true });

  /* ---------- Manejador HTTP ---------- */
  async function readJson(req) {
    if (!["POST", "PATCH", "PUT"].includes(req.method)) return {};
    let size = 0; const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 16 * 1024) throw new HttpError(413, "Solicitud demasiado grande.");
      chunks.push(c);
    }
    if (!size) return {};
    try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8")); return v && typeof v === "object" ? v : {}; }
    catch { throw new HttpError(400, "JSON inválido."); }
  }

  function sendJson(res, status, data) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  }

  /* ---------- Marca del negocio en las páginas ---------- */
  // Las páginas HTML llevan marcadores {{…}} que se reemplazan con los datos del negocio,
  // y <!--MARCA--> donde se insertan los colores, el ícono y el manifest. Así cada negocio
  // ve su marca desde el primer instante, sin parpadeos.
  const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return "201,162,39";
    const n = parseInt(m[1], 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; };
  const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
  // "de" + lugar, con contracción: "del salón", "de la barbería".
  function dePlace(p) { p = p || "el negocio"; return p.startsWith("el ") ? "del " + p.slice(3) : "de " + p; }
  const brandTokens = {
    name: config.name, shortName: config.shortName || config.name, tagline: config.tagline || "",
    place: config.place || "el negocio", Place: cap(config.place || "el negocio"), dePlace: dePlace(config.place),
    heroTitle: config.hero?.title || "", heroAccent: config.hero?.accent || "",
    slogan: config.slogan || "", city: config.city || config.location || "", location: config.location || "",
    mapsUrl: config.mapsUrl || "#", whatsapp: config.whatsapp || "", description: config.description || config.name,
    phoneFmt: String(config.phone || "").replace(/(\d{4})(\d{4})/, "$1 $2"),
    logo: config.logos.main,
  };
  const brandHead = [
    // "html:root" pesa más que el ":root" de styles.css, que se carga después.
    `<style>html:root{--gold:${config.theme.accent};--gold-2:${config.theme.accent2};--gold-ink:${config.theme.ink};` +
      `--accent-rgb:${hexRgb(config.theme.accent)};--accent2-rgb:${hexRgb(config.theme.accent2)}}</style>`,
    `<link rel="icon" href="${escHtml(config.logos.main)}" type="image/svg+xml" />`,
    config.logos.icon192 ? `<link rel="icon" href="${escHtml(config.logos.icon192)}" sizes="192x192" type="image/png" />` : "",
    config.logos.apple ? `<link rel="apple-touch-icon" href="${escHtml(config.logos.apple)}" />` : "",
    `<link rel="manifest" href="manifest.webmanifest" />`,
    `<meta name="theme-color" content="#0b0a09" />`,
  ].filter(Boolean).join("\n  ");
  const pageCache = new Map();

  /* ---------- Datos de contacto (editables desde la plataforma) ---------- */
  const digits = (s) => String(s ?? "").replace(/\D/g, "");
  function contact() { return { phone: config.phone || "", whatsapp: config.whatsapp || "", replyTo: config.replyTo || "" }; }
  function applyContact(c) {
    if (!c) return;
    Object.assign(config, c);
    brandTokens.whatsapp = config.whatsapp || "";
    brandTokens.phoneFmt = String(config.phone || "").replace(/(\d{4})(\d{4})/, "$1 $2");
    pageCache.clear(); // las páginas llevan el teléfono y el WhatsApp
  }
  // Valida, guarda en la base del negocio y aplica de inmediato. Devuelve los datos como quedaron.
  function setContact(body = {}) {
    const cc = String(config.countryCode || "506");
    const phone = digits(body.phone);
    if (!/^\d{8,15}$/.test(phone)) throw new HttpError(400, "El teléfono debe tener al menos 8 dígitos.");
    let wa = digits(body.whatsapp) || phone;
    if (wa.length === 8) wa = cc + wa;
    if (!/^\d{10,15}$/.test(wa)) throw new HttpError(400, "El WhatsApp debe llevar el código de país (por ejemplo 506 y el número).");
    const replyTo = String(body.replyTo || "").trim().toLowerCase();
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) throw new HttpError(400, "El correo para respuestas no es válido.");
    const c = { phone, whatsapp: wa, replyTo };
    repo.settingSet("contact", c);
    applyContact(c);
    return contact();
  }

  function renderPage(file, st) {
    const hit = pageCache.get(file);
    if (hit && hit.mtime === st.mtimeMs) return hit;
    const html = fs.readFileSync(file, "utf8")
      .replace("<!--MARCA-->", brandHead)
      .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in brandTokens ? escHtml(brandTokens[k]) : m));
    const out = { mtime: st.mtimeMs, body: Buffer.from(html), etag: `W/"${crypto.createHash("sha1").update(html).digest("hex").slice(0, 16)}"` };
    pageCache.set(file, out);
    return out;
  }

  function manifest() {
    const icons = [
      config.logos.icon192 && { src: config.logos.icon192, sizes: "192x192", type: "image/png" },
      config.logos.icon512 && { src: config.logos.icon512, sizes: "512x512", type: "image/png" },
      { src: config.logos.main, sizes: "any", type: "image/svg+xml" },
    ].filter(Boolean);
    return { name: config.name, short_name: config.shortName || config.name, description: config.description || config.name,
      start_url: "/", display: "standalone", background_color: "#0b0a09", theme_color: "#0b0a09", icons };
  }

  function serveStatic(req, res, pathname) {
    if (pathname === "/manifest.webmanifest") {
      res.writeHead(200, { "content-type": "application/manifest+json", "cache-control": "no-cache" });
      return res.end(JSON.stringify(manifest()));
    }
    if (pathname === "/admin" || pathname === "/admin/") pathname = "/admin.html";
    if (pathname === "/plataforma.html" || pathname === "/js/plataforma.js") { res.writeHead(404); return res.end(); }
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end("No encontrado");
      }
      const ext = path.extname(file);
      if (ext === ".html") {
        const page = renderPage(file, st);
        const h = { "content-type": MIME[ext], "cache-control": "no-cache", etag: page.etag };
        if (req.headers["if-none-match"] === page.etag) { res.writeHead(304, h); return res.end(); }
        res.writeHead(200, h);
        return res.end(req.method === "HEAD" ? undefined : page.body);
      }
      // "no-cache": el navegador siempre pregunta si hay una versión nueva; si no cambió,
      // responde 304 sin reenviar el archivo. Así nunca queda una versión vieja de la app.
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      const headers = {
        "content-type": MIME[ext] || "application/octet-stream",
        "cache-control": "no-cache",
        etag,
        "last-modified": st.mtime.toUTCString(),
      };
      if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, headers);
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  /* ---------- Recordatorios por correo ---------- */
  // Se llama periódicamente desde index.js. Envía:
  //  1. un recordatorio a las citas confirmadas que empiezan dentro de las próximas `reminderHours` horas;
  //  2. un segundo recordatorio, `reminderExtraHours` antes, a los clientes con historial de cancelaciones o ausencias.
  function runReminders() {
    if (mail.enabled === false) return 0;
    const n = now();
    const first = reminderHours() * 60, extra = reminderExtraHours() * 60;
    const until = (b) => minutesUntil(b) || -1;
    const recent = (iso, hours) => { const d = clock().getTime() - Date.parse(iso); return Boolean(iso) && d >= 0 && d < hours * 3600e3; };
    const to = addDays(n.day, Math.ceil(Math.max(first, extra) / 1440) + 1);
    let sent = 0;
    if (first > 0) {
      for (const b of repo.reminderCandidates(n.day, to)) {
        const u = until(b);
        if (u <= 30 || u > first) continue;
        repo.setReminded(b.id);
        // Si se confirmó hace muy poco, el correo de confirmación ya sirve de recordatorio.
        if (recent(b.updated_at, 3) && u < 12 * 60) continue;
        if (emailClient("recordatorio", b, null)) sent++;
      }
    }
    // El segundo recordatorio solo tiene sentido si llega después del primero.
    if (extra > 0 && (first === 0 || extra < first)) {
      for (const b of repo.reminder2Candidates(n.day, to)) {
        const u = until(b);
        if (u <= 20 || u > extra) continue;
        const h = clientHistory(b.phone);
        if (!h || !h.flagged) continue;
        repo.setReminded2(b.id);
        if (recent(b.reminded_at, 1) || (recent(b.updated_at, 1))) continue;
        if (emailClient("recordatorio", b, null, { second: true })) sent++;
      }
    }
    return sent;
  }

  handler.runReminders = runReminders;
  handler.contact = contact;
  handler.setContact = setContact;
  applyContact(repo.setting("contact", null));
  return handler;

  async function handler(req, res) {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("x-frame-options", "DENY");
    const url = new URL(req.url, "http://localhost");
    const ip = (env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "") ||
      req.socket.remoteAddress || "?";

    // Entrada desde la plataforma: canjea el pase de un solo uso y abre el panel.
    if (url.pathname === "/__plataforma" && req.method === "GET") {
      const r = platformAuth ? platformAuth.redeem(url.searchParams.get("t"), config.slug) : null;
      if (!r) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        return res.end("El pase venció o ya se usó. Vuelve a la plataforma y toca “Entrar al panel” de nuevo.");
      }
      res.writeHead(302, { location: "/admin", "cache-control": "no-store",
        "set-cookie": `${r.name}=${r.cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${r.maxAge}` + (secureCookie(req) ? "; Secure" : "") });
      return res.end();
    }

    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    }

    try {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, "Ruta no encontrada.");
      if (r.admin) requireAdmin(req);
      const params = r.re.exec(url.pathname).groups || {};
      // Las escrituras deben enviar JSON: un formulario de otro sitio no puede hacerlo sin permiso (CSRF).
      if (["POST", "PUT", "PATCH"].includes(req.method) &&
          !String(req.headers["content-type"] || "").startsWith("application/json"))
        throw new HttpError(415, "Formato no soportado.");
      const body = await readJson(req);
      const out = await r.handler({ params, query: url.searchParams, body, ip, req, res });
      if (out && out.raw) {
        res.writeHead(200, { "content-type": out.raw.type, "cache-control": "no-store",
          "content-disposition": `attachment; filename="${out.raw.filename}"` });
        return res.end(out.raw.data);
      }
      if (out && out.status && out.body) return sendJson(res, out.status, out.body);
      sendJson(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      console.error(e);
      sendJson(res, 500, { error: "Algo salió mal. Intenta de nuevo." });
    }
  };
}

// Aviso al barbero. Compatible con ntfy.sh (notificaciones push gratis al celular):
// NOTIFY_URL=https://ntfy.sh/un-tema-secreto-largo
function makeNotifier(url) {
  if (!url) return () => {};
  return (title, text) => {
    // Las cabeceras HTTP solo aceptan ASCII: se quitan tildes del título.
    const ascii = title.normalize("NFD").replace(/[^\x20-\x7e]/g, "");
    fetch(url, { method: "POST", body: text, headers: { Title: ascii, Tags: "scissors" } })
      .catch((e) => console.error("No se pudo enviar el aviso:", e.message));
  };
}

module.exports = { createApp };
