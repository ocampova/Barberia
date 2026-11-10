"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { freeSlots, ACTIVE } = require("./availability");
const { isDay, addDays, nowIn, fmtTime } = require("./time");

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

function createApp({ repo, config, env = process.env, clock = () => new Date(), notify }) {
  const services = new Map(config.services.map((s) => [s.id, s]));
  const secret = env.ADMIN_SECRET || crypto.randomBytes(32).toString("hex");
  const adminPin = env.ADMIN_PIN || "";
  const bookingLimit = limiter(Number(env.BOOKING_RATE_LIMIT || 8), 60 * 60 * 1000);
  const loginLimit = limiter(6, 15 * 60 * 1000);
  const send = notify || makeNotifier(env.NOTIFY_URL);

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

  const slotsFor = (category, day, minutes) =>
    freeSlots({ config, category, day, minutes, bookings: repo.bookingsOn(day), blocks: repo.blocksOn(day), now: now() });

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
    const { name, tagline, partner, slogan, location, mapsUrl, phone, whatsapp, currency, hours,
      slotStepMinutes, daysAhead, policies, categories, services: svc } = config;
    return { name, tagline, partner, slogan, location, mapsUrl, phone, whatsapp, currency, hours,
      slotStepMinutes, daysAhead, policies, categories: categories.map(({ id, name }) => ({ id, name })),
      services: svc, today: now().day, nowMinutes: now().minutes };
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
      out.push({ day, slots: slotsFor(category, day, minutes) });
    }
    return { minutes, days: out };
  });

  route("POST", "/api/bookings", ({ body, ip }) => {
    if (!bookingLimit(ip)) throw new HttpError(429, "Demasiados intentos. Prueba de nuevo más tarde.");
    const { list, category, minutes, total } = resolveServices(body.services);
    parseSlot(body.day, body.start);
    const name = cleanText(body.name, 60, "nombre", true);
    const phone = cleanPhone(body.phone);
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
        name, phone, note, status: "pendiente", source: "web", created_at: ts, updated_at: ts,
      };
      repo.insertBooking(b);
      return b;
    });

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

  route("POST", "/api/bookings/:id/cancel", ({ params, body }) => {
    const b = ownBooking(params.id, body.token);
    const n = now();
    if (!ACTIVE.has(b.status)) throw new HttpError(409, "Esta cita ya no está activa.");
    if (b.day < n.day || (b.day === n.day && b.start <= n.minutes)) throw new HttpError(409, "Esta cita ya pasó.");
    repo.setStatus(b.id, "cancelada");
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

  route("GET", "/api/admin/summary", () => ({ pending: repo.pendingCount(now().day), today: now().day }), { admin: true });

  route("GET", "/api/admin/bookings", ({ query }) => {
    const from = query.get("from") || now().day;
    const to = query.get("to") || addDays(from, 30);
    if (!isDay(from) || !isDay(to)) throw new HttpError(400, "Fecha inválida.");
    const status = query.get("status");
    const list = repo.bookingsRange(from, to).filter((b) => !status || b.status === status);
    return { bookings: list.map(({ token, ...b }) => b), blocks: repo.blocksRange(from, to) };
  }, { admin: true });

  route("PATCH", "/api/admin/bookings/:id", ({ params, body }) => {
    if (!ADMIN_STATUSES.has(body.status)) throw new HttpError(400, "Estado inválido.");
    const b = repo.bookingById(params.id);
    if (!b) throw new HttpError(404, "Cita no encontrada.");
    if (ACTIVE.has(body.status) && !ACTIVE.has(b.status)) {
      // Reactivar una cita: el espacio tiene que seguir libre.
      const others = repo.bookingsOn(b.day).filter((x) => x.id !== b.id);
      const free = freeSlots({ config, category: b.category, day: b.day, minutes: b.minutes,
        bookings: others, blocks: repo.blocksOn(b.day), now: null });
      if (!free.includes(b.start)) throw new HttpError(409, "Ese espacio ya está ocupado.");
    }
    repo.setStatus(b.id, body.status);
    const { token, ...rest } = b;
    return { ...rest, status: body.status };
  }, { admin: true });

  // Cita creada por el barbero (llamada, cliente en el local).
  route("POST", "/api/admin/bookings", ({ body }) => {
    const { list, category, minutes, total } = resolveServices(body.services);
    parseSlot(body.day, body.start);
    const name = cleanText(body.name, 60, "nombre", true);
    const phone = body.phone ? cleanPhone(body.phone) : "";
    const note = cleanText(body.note, 200, "nota", false);
    return repo.transaction(() => {
      const free = freeSlots({ config, category, day: body.day, minutes, bookings: repo.bookingsOn(body.day),
        blocks: repo.blocksOn(body.day), now: null });
      if (!body.force && !free.includes(body.start)) throw new HttpError(409, "Ese espacio está ocupado o fuera de horario.");
      const ts = new Date().toISOString();
      const b = {
        id: crypto.randomBytes(6).toString("base64url"), token: crypto.randomBytes(18).toString("base64url"),
        category, day: body.day, start: body.start, minutes, services: list.map((s) => s.id), total,
        name, phone, note, status: "confirmada", source: "panel", created_at: ts, updated_at: ts,
      };
      repo.insertBooking(b);
      const { token, ...rest } = b;
      return { status: 201, body: rest };
    });
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

  /* ---------- Manejador HTTP ---------- */
  async function readJson(req) {
    if (!["POST", "PATCH"].includes(req.method)) return {};
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

  return async function handler(req, res) {
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
