"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { freeSlots, checkRanges, ACTIVE } = require("./availability");
const { isDay, addDays, nowIn, fmtTime, weekday } = require("./time");
const { render: renderEmail } = require("./emails");
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

function createApp({ repo, config, env = process.env, clock = () => new Date(), notify, mailer }) {
  const services = new Map(config.services.map((s) => [s.id, s]));
  const secret = env.ADMIN_SECRET || crypto.randomBytes(32).toString("hex");
  const adminPin = env.ADMIN_PIN || "";
  const bookingLimit = limiter(Number(env.BOOKING_RATE_LIMIT || 8), 60 * 60 * 1000);
  const loginLimit = limiter(6, 15 * 60 * 1000);
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
    const link = site ? `${site}/?cita=${encodeURIComponent(b.id)}&t=${encodeURIComponent(b.token)}` : null;
    let msg;
    try { msg = renderEmail(kind, b, config, { link, siteUrl: site, ...extra }); }
    catch (e) { console.error("Plantilla de correo:", e.message); return false; }
    Promise.resolve(mail.send({ to: b.email, ...msg }))
      .catch((e) => console.error(`No se pudo enviar el correo (${kind}) a la cita ${b.id}:`, e.message));
    return mail.enabled !== false;
  }

  const now = () => nowIn(config.timeZone, clock());

  /* ---------- Utilidades ---------- */
  function resolveServices(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 5 || new Set(ids).size !== ids.length)
      throw new HttpError(400, "Elige entre 1 y 5 servicios.");
    const list = ids.map((id) => services.get(id));
    if (list.some((s) => !s)) throw new HttpError(400, "Servicio desconocido.");
    const category = list[0].cat;
    if (list.some((s) => s.cat !== category))
      throw new HttpError(400, "Reserva los servicios de barbería y de salón por separado.");
    const minutes = list.reduce((t, s) => t + s.min, 0);
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
    id: b.id, day: b.day, start: b.start, minutes: b.minutes, services: b.services,
    total: b.total, status: b.status, name: b.name.split(" ")[0],
  });

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

  /* ---------- Autenticación del panel ---------- */
  function signToken(hours = 12) {
    const exp = Date.now() + hours * 3600e3;
    const mac = crypto.createHmac("sha256", secret).update(String(exp)).digest("base64url");
    return `${exp}.${mac}`;
  }
  function checkToken(req) {
    const m = /^Bearer (\d+)\.([\w-]+)$/.exec(req.headers.authorization || "");
    if (!m || Number(m[1]) < Date.now()) return false;
    const want = crypto.createHmac("sha256", secret).update(m[1]).digest();
    const got = Buffer.from(m[2], "base64url");
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  const sameSecret = (a, b) => {
    const ha = crypto.createHash("sha256").update(a).digest();
    const hb = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
  };

  /* ---------- Rutas ---------- */
  const routes = [];
  const route = (method, pattern, handler, opts = {}) =>
    routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[\\w-]+)") + "$"), handler, ...opts });

  route("GET", "/api/health", () => ({ ok: true }));

  route("GET", "/api/config", () => {
    const { name, tagline, partner, slogan, location, mapsUrl, phone, whatsapp, currency,
      slotStepMinutes, daysAhead, policies, categories, services: svc } = config;
    return { name, tagline, partner, slogan, location, mapsUrl, phone, whatsapp, currency,
      slotStepMinutes, daysAhead, policies, categories: categories.map(({ id, name }) => ({ id, name })),
      status: openStatus(categories[0].id),
      services: svc, today: now().day, nowMinutes: now().minutes, emailEnabled: mail.enabled !== false };
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
    if (!bookingLimit(ip)) throw new HttpError(429, "Demasiados intentos. Prueba de nuevo más tarde.");
    const { list, category, minutes, total } = resolveServices(body.services);
    parseSlot(body.day, body.start);
    const name = cleanText(body.name, 60, "nombre", true);
    const phone = cleanPhone(body.phone);
    const email = cleanEmail(body.email);
    const note = cleanText(body.note, 200, "nota", false);
    if (body.website) throw new HttpError(400, "Solicitud inválida."); // campo trampa para bots

    const booking = repo.transaction(() => {
      if (repo.activeByPhone(phone, now().day) >= config.maxActivePerPhone)
        throw new HttpError(429, "Ya tienes varias citas activas. Escríbenos por WhatsApp si necesitas otra.");
      if (!slotsFor(category, body.day, minutes).includes(body.start))
        throw new HttpError(409, "Ese espacio acaba de ocuparse. Elige otra hora.");
      const ts = new Date().toISOString();
      const b = {
        id: crypto.randomBytes(6).toString("base64url"),
        token: crypto.randomBytes(18).toString("base64url"),
        category, day: body.day, start: body.start, minutes, services: list.map((s) => s.id), total,
        name, phone, email, note, status: "pendiente", source: "web", created_at: ts, updated_at: ts,
      };
      repo.insertBooking(b);
      return b;
    });
    emailClient("recibida", booking, req);

    send(`Nueva reserva: ${name}`, `${list.map((s) => s.name).join(" + ")}\n${booking.day} · ${fmtTime(booking.start)}\nTel: ${phone}${note ? "\nNota: " + note : ""}`);
    return { status: 201, body: { ...publicBooking(booking), token: booking.token } };
  });

  function ownBooking(id, token) {
    const b = repo.bookingById(id);
    const ok = b && typeof token === "string" && token.length === b.token.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(b.token));
    if (!ok) throw new HttpError(404, "No encontramos esa cita.");
    return b;
  }

  route("GET", "/api/bookings/:id", ({ params, query }) => publicBooking(ownBooking(params.id, query.get("token"))));

  route("POST", "/api/bookings/:id/cancel", ({ params, body, req }) => {
    const b = ownBooking(params.id, body.token);
    const n = now();
    if (!ACTIVE.has(b.status)) throw new HttpError(409, "Esta cita ya no está activa.");
    if (b.day < n.day || (b.day === n.day && b.start <= n.minutes)) throw new HttpError(409, "Esta cita ya pasó.");
    repo.setStatus(b.id, "cancelada");
    emailClient("cancelada", b, req, { byClient: true });
    send(`Cita cancelada: ${b.name}`, `${b.day} · ${fmtTime(b.start)} quedó libre.`);
    return publicBooking({ ...b, status: "cancelada" });
  });

  /* ---------- Panel ---------- */
  route("POST", "/api/admin/login", ({ body, ip }) => {
    if (!adminPin) throw new HttpError(503, "Panel desactivado: falta configurar ADMIN_PIN.");
    if (!loginLimit(ip)) throw new HttpError(429, "Demasiados intentos. Espera 15 minutos.");
    if (!sameSecret(String(body.pin || ""), adminPin)) throw new HttpError(401, "PIN incorrecto.");
    return { token: signToken() };
  });

  route("GET", "/api/admin/summary", () => ({
    pending: repo.pendingCount(now().day), today: now().day, emailEnabled: mail.enabled !== false,
  }), { admin: true });

  route("GET", "/api/admin/bookings", ({ query }) => {
    const from = query.get("from") || now().day;
    const to = query.get("to") || addDays(from, 30);
    if (!isDay(from) || !isDay(to)) throw new HttpError(400, "Fecha inválida.");
    const status = query.get("status");
    const list = repo.bookingsRange(from, to).filter((b) => !status || b.status === status);
    return { bookings: list.map(({ token, ...b }) => b), blocks: repo.blocksRange(from, to) };
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
    repo.setStatus(b.id, body.status);
    const changed = b.status !== body.status;
    const emailed = changed && ["confirmada", "rechazada", "cancelada"].includes(body.status)
      ? emailClient(body.status, b, req) : false;
    const { token, ...rest } = b;
    return { ...rest, status: body.status, emailed };
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
    if (!Array.isArray(days) || !days.length || days.length > 120 || days.some((d) => !isDay(d)))
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

  function serveStatic(req, res, pathname) {
    if (pathname === "/admin" || pathname === "/admin/") pathname = "/admin.html";
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end("No encontrado");
      }
      const ext = path.extname(file);
      res.writeHead(200, {
        "content-type": MIME[ext] || "application/octet-stream",
        "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  /* ---------- Recordatorios por correo ---------- */
  // Se llama periódicamente desde index.js. Envía un recordatorio a las citas confirmadas
  // que empiezan dentro de las próximas `reminderHoursBefore` horas (y en más de 1 hora).
  function runReminders() {
    if (mail.enabled === false) return 0;
    const n = now();
    const abs = (day, min) => Date.parse(day + "T00:00:00Z") / 60000 + min;
    const nowAbs = abs(n.day, n.minutes);
    const horizon = (config.reminderHoursBefore || 24) * 60;
    let sent = 0;
    for (const b of repo.reminderCandidates(n.day, addDays(n.day, 2))) {
      const until = abs(b.day, b.start) - nowAbs;
      if (until <= 60 || until > horizon) continue;
      // Si se confirmó hace muy poco, el correo de confirmación ya sirve de recordatorio.
      if (Date.now() - Date.parse(b.updated_at) < 3 * 3600e3 && until < 12 * 60) { repo.setReminded(b.id); continue; }
      repo.setReminded(b.id);
      if (emailClient("recordatorio", b, null)) sent++;
    }
    return sent;
  }

  handler.runReminders = runReminders;
  return handler;

  async function handler(req, res) {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("x-frame-options", "DENY");
    const url = new URL(req.url, "http://localhost");
    const ip = (env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "") ||
      req.socket.remoteAddress || "?";

    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    }

    try {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, "Ruta no encontrada.");
      if (r.admin && !checkToken(req)) throw new HttpError(401, "Inicia sesión de nuevo.");
      const params = r.re.exec(url.pathname).groups || {};
      const body = await readJson(req);
      const out = await r.handler({ params, query: url.searchParams, body, ip, req });
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
