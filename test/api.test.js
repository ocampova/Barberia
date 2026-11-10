"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const config = require("../server/config");
const { openDb, repo } = require("../server/db");
const { createApp } = require("../server/app");

// Reloj fijo: lunes 9 de noviembre de 2026, 8:00 a.m. en Costa Rica (14:00 UTC).
const clock = () => new Date("2026-11-09T14:00:00Z");
const tick = () => new Promise((ok) => setImmediate(ok));

async function setup(t, env = {}, opts = {}) {
  const notices = [];
  const mails = [];
  const handler = createApp({
    repo: repo(openDb(":memory:")), config, clock: opts.clock || clock,
    env: { ADMIN_PIN: "246810", ADMIN_SECRET: "x".repeat(32), PUBLIC_URL: "https://reservas.example.com",
      REGISTER_RATE_LIMIT: "100", LOGIN_RATE_LIMIT: "100", ...env },
    notify: (title, text) => notices.push({ title, text }),
    mailer: opts.mailer || { enabled: true, send: async (m) => { mails.push(m); return { id: "ok" }; } },
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  // Cada "navegador" guarda su propia cookie de sesión.
  function browser() {
    let cookie = "";
    const call = async (method, path, body, token) => {
      const res = await fetch(base + path, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}),
          ...(token ? { authorization: "Bearer " + token } : {}) },
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
      return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
    };
    call.cookie = () => cookie;
    return call;
  }
  const call = browser();
  let n = 0;
  // Registra un cliente nuevo y devuelve su "navegador" con la sesión iniciada.
  async function user(extra = {}) {
    const c = browser();
    n++;
    const r = await c("POST", "/api/auth/register", {
      name: "Juan Pérez", phone: `8888${String(1000 + n)}`, email: `juan${n}@example.com`, password: "secreto123", ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    c.user = r.body.user;
    return c;
  }
  const admin = async () => (await call("POST", "/api/admin/login", { pin: "246810" })).body.token;
  return { call, browser, user, admin, notices, mails, base, handler };
}

const booking = (extra = {}) => ({ services: ["corte"], day: "2026-11-10", start: 600, ...extra });

/* ---------------- Configuración pública ---------------- */

test("config pública no expone datos internos", async (t) => {
  const { call } = await setup(t);
  const r = await call("GET", "/api/config");
  assert.equal(r.status, 200);
  assert.equal(r.body.today, "2026-11-09");
  assert.ok(r.body.services.length > 5);
  assert.deepEqual(Object.keys(r.body.services[0]).sort(), ["cat", "desc", "id", "min", "name", "popular", "price"]);
  assert.equal(r.body.categories[0].capacity, undefined);
  assert.equal(r.body.hours, undefined);
});

test("config pública: estado abierto/cerrado según el horario", async (t) => {
  const { call } = await setup(t);
  const st = (await call("GET", "/api/config")).body.status;
  assert.deepEqual(st, { open: false, opensAt: 540, opensDay: "2026-11-09" });
});

/* ---------------- Cuentas ---------------- */

test("registro, sesión, perfil y cierre de sesión", async (t) => {
  const { browser, call } = await setup(t);
  const c = browser();
  assert.deepEqual((await c("GET", "/api/me")).body, { user: null });

  const r = await c("POST", "/api/auth/register", { name: "Ana Mora", phone: "8777 6655", email: "Ana@Example.com", password: "secreto123" });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.phone, "50687776655");
  assert.equal(r.body.user.email, "ana@example.com");
  assert.equal(r.body.user.pass_hash, undefined);
  const setCookie = r.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/); // PUBLIC_URL es https

  assert.equal((await c("GET", "/api/me")).body.user.name, "Ana Mora");
  assert.equal((await call("GET", "/api/me")).body.user, null); // otro navegador no tiene sesión

  // Duplicados
  const other = browser();
  assert.equal((await other("POST", "/api/auth/register", { name: "X Y", phone: "87776655", email: "otra@example.com", password: "secreto123" })).status, 409);
  assert.equal((await other("POST", "/api/auth/register", { name: "X Y", phone: "86665544", email: "ANA@example.com", password: "secreto123" })).status, 409);
  assert.equal((await other("POST", "/api/auth/register", { name: "X Y", phone: "86665544", email: "x@example.com", password: "corta" })).status, 400);

  // Editar perfil
  const p = await c("PATCH", "/api/me", { name: "Ana María Mora", phone: "87776655", email: "ana.maria@example.com" });
  assert.equal(p.body.user.name, "Ana María Mora");
  assert.equal(p.body.user.email, "ana.maria@example.com");

  // Cerrar sesión
  await c("POST", "/api/auth/logout");
  assert.equal((await c("GET", "/api/me")).body.user, null);

  // Iniciar sesión con correo o con teléfono
  assert.equal((await c("POST", "/api/auth/login", { login: "ANA.MARIA@example.com", password: "secreto123" })).status, 200);
  await c("POST", "/api/auth/logout");
  assert.equal((await c("POST", "/api/auth/login", { login: "8777-6655", password: "secreto123" })).status, 200);
  assert.equal((await c("GET", "/api/me")).body.user.name, "Ana María Mora");
  assert.equal((await browser()("POST", "/api/auth/login", { login: "8777-6655", password: "mala-clave" })).status, 401);
  assert.equal((await browser()("POST", "/api/auth/login", { login: "nadie@example.com", password: "secreto123" })).status, 401);
});

test("cambiar contraseña cierra las otras sesiones", async (t) => {
  const { user, browser } = await setup(t);
  const c = await user({ phone: "86665544", email: "luis@example.com" });
  const other = browser();
  await other("POST", "/api/auth/login", { login: "luis@example.com", password: "secreto123" });
  assert.ok((await other("GET", "/api/me")).body.user);

  assert.equal((await c("POST", "/api/me/password", { current: "mala", password: "nueva-clave-1" })).status, 400);
  assert.equal((await c("POST", "/api/me/password", { current: "secreto123", password: "nueva-clave-1" })).status, 200);
  assert.ok((await c("GET", "/api/me")).body.user);              // esta sesión sigue
  assert.equal((await other("GET", "/api/me")).body.user, null); // la otra se cerró
  assert.equal((await browser()("POST", "/api/auth/login", { login: "luis@example.com", password: "nueva-clave-1" })).status, 200);
});

test("olvidé mi contraseña: correo con enlace de un solo uso", async (t) => {
  const { user, browser, call, mails } = await setup(t);
  await user({ phone: "86665544", email: "luis@example.com" });
  assert.equal((await call("POST", "/api/auth/forgot", { email: "nadie@example.com" })).status, 200); // no revela nada
  await call("POST", "/api/auth/forgot", { email: "LUIS@example.com" });
  await tick();
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /contraseña/);
  const token = /reset=([\w-]+)/.exec(mails[0].html)[1];

  const c = browser();
  assert.equal((await c("POST", "/api/auth/reset", { token, password: "corta" })).status, 400);
  const r = await c("POST", "/api/auth/reset", { token, password: "otra-clave-9" });
  assert.equal(r.status, 200);
  assert.equal((await c("GET", "/api/me")).body.user.email, "luis@example.com");
  assert.equal((await c("POST", "/api/auth/reset", { token, password: "otra-clave-9" })).status, 400); // ya se usó
});

test("escrituras sin JSON se rechazan (protección CSRF)", async (t) => {
  const { base } = await setup(t);
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "login=a&password=b" });
  assert.equal(r.status, 415);
});

/* ---------------- Reservas ---------------- */

test("reservar requiere sesión; historial y cancelación propios", async (t) => {
  const { call, user, notices } = await setup(t);
  assert.equal((await call("POST", "/api/bookings", booking())).status, 401);

  const c = await user();
  let a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(a.body.days[0].slots.includes(600));

  const r = await c("POST", "/api/bookings", booking({ note: "Degradado bajo" }));
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "pendiente");
  assert.equal(r.body.total, 9000);
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, new RegExp(c.user.phone));

  a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(!a.body.days[0].slots.includes(600));

  const other = await user();
  assert.equal((await other("POST", "/api/bookings", booking())).status, 409);

  const hist = (await c("GET", "/api/me/bookings")).body.bookings;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].note, "Degradado bajo");
  assert.equal((await other("GET", "/api/me/bookings")).body.bookings.length, 0);
  assert.equal((await call("GET", "/api/me/bookings")).status, 401);

  // Otro cliente no puede cancelar la cita
  assert.equal((await other("POST", `/api/bookings/${r.body.id}/cancel`)).status, 404);
  const x = await c("POST", `/api/bookings/${r.body.id}/cancel`);
  assert.equal(x.body.status, "cancelada");
  a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(a.body.days[0].slots.includes(600));
});

test("validaciones de reserva", async (t) => {
  const { user } = await setup(t, { BOOKING_RATE_LIMIT: "50" });
  const c = await user();
  assert.equal((await c("POST", "/api/bookings", booking({ services: ["corte", "color"] }))).status, 400);
  assert.equal((await c("POST", "/api/bookings", booking({ services: ["nope"] }))).status, 400);
  assert.equal((await c("POST", "/api/bookings", booking({ day: "2026-02-30" }))).status, 400);
  assert.equal((await c("POST", "/api/bookings", booking({ start: 605 }))).status, 409); // fuera de la grilla
  assert.equal((await c("POST", "/api/bookings", booking({ day: "2026-11-15" }))).status, 409); // domingo cerrado
  assert.equal((await c("POST", "/api/bookings", booking({ day: "2026-11-09", start: 480 }))).status, 409); // ya pasó
  assert.equal((await c("POST", "/api/bookings", booking({ website: "spam" }))).status, 400);
});

test("límites: intentos por hora y citas activas por cliente", async (t) => {
  const s1 = await setup(t, { BOOKING_RATE_LIMIT: "2" });
  const c1 = await s1.user();
  await c1("POST", "/api/bookings", booking({ day: "2026-02-30" }));
  await c1("POST", "/api/bookings", booking({ day: "2026-02-30" }));
  assert.equal((await c1("POST", "/api/bookings", booking())).status, 429);

  const s2 = await setup(t);
  const c2 = await s2.user();
  for (const start of [540, 660, 780]) assert.equal((await c2("POST", "/api/bookings", booking({ start }))).status, 201);
  assert.equal((await c2("POST", "/api/bookings", booking({ start: 900 }))).status, 429);
});

/* ---------------- Panel ---------------- */

test("panel: requiere PIN y gestiona citas y bloqueos", async (t) => {
  const { call, user, admin } = await setup(t);
  assert.equal((await call("GET", "/api/admin/bookings")).status, 401);
  assert.equal((await call("POST", "/api/admin/login", { pin: "000000" })).status, 401);
  const token = await admin();
  assert.ok(token);
  assert.equal((await call("GET", "/api/admin/bookings", null, token + "x")).status, 401);

  const c = await user();
  const r = (await c("POST", "/api/bookings", booking())).body;
  assert.equal((await call("GET", "/api/admin/summary", null, token)).body.pending, 1);

  const list = await call("GET", "/api/admin/bookings?from=2026-11-10&to=2026-11-10", null, token);
  assert.equal(list.body.bookings[0].phone, c.user.phone);
  assert.equal(list.body.bookings[0].name, "Juan Pérez");
  assert.equal(list.body.bookings[0].token, undefined);

  const p = await call("PATCH", `/api/admin/bookings/${r.id}`, { status: "confirmada" }, token);
  assert.equal(p.body.status, "confirmada");
  assert.equal((await c("GET", "/api/me/bookings")).body.bookings[0].status, "confirmada");
  assert.equal((await call("PATCH", `/api/admin/bookings/${r.id}`, { status: "x" }, token)).status, 400);

  const blk = await call("POST", "/api/admin/blocks", { day: "2026-11-10", start: 720, end: 780, reason: "Almuerzo" }, token);
  assert.equal(blk.status, 201);
  let a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(!a.body.days[0].slots.includes(720));
  await call("DELETE", `/api/admin/blocks/${blk.body.id}`, null, token);
  a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(a.body.days[0].slots.includes(720));

  // Cita del panel (cliente sin cuenta): confirmada de una vez; choca → 409 salvo force
  const w = await call("POST", "/api/admin/bookings", { services: ["barba"], day: "2026-11-10", start: 600, name: "Cliente local" }, token);
  assert.equal(w.status, 409);
  const w2 = await call("POST", "/api/admin/bookings", { services: ["barba"], day: "2026-11-10", start: 600, name: "Cliente local", force: true }, token);
  assert.equal(w2.status, 201);
  assert.equal(w2.body.status, "confirmada");
});

test("panel desactivado sin ADMIN_PIN; login con límite de intentos", async (t) => {
  const off = await setup(t, { ADMIN_PIN: "" });
  assert.equal((await off.call("POST", "/api/admin/login", { pin: "" })).status, 503);
  const { call } = await setup(t);
  let last;
  for (let i = 0; i < 7; i++) last = await call("POST", "/api/admin/login", { pin: "nope" + i });
  assert.equal(last.status, 429);
});

/* ---------------- Servicios administrables ---------------- */

test("servicios: crear, editar duración y precio, ocultar, ordenar, borrar", async (t) => {
  const { call, user, admin } = await setup(t);
  const token = await admin();
  assert.equal((await call("GET", "/api/admin/services")).status, 401);

  // Crear
  const nuevo = await call("POST", "/api/admin/services",
    { category: "barberia", name: "Diseño de cejas", minutes: 20, price: 3000, description: "Perfilado a navaja", popular: true }, token);
  assert.equal(nuevo.status, 201);
  assert.equal(nuevo.body.id, "diseno-de-cejas");
  let cfg = (await call("GET", "/api/config")).body;
  assert.ok(cfg.services.some((s) => s.id === "diseno-de-cejas" && s.min === 20 && s.price === 3000 && s.popular));

  // Validaciones
  assert.equal((await call("POST", "/api/admin/services", { category: "barberia", name: "X", minutes: 7 }, token)).status, 400);
  assert.equal((await call("POST", "/api/admin/services", { category: "nope", name: "Algo", minutes: 30 }, token)).status, 400);
  assert.equal((await call("POST", "/api/admin/services", { category: "barberia", name: "Algo", minutes: 30, price: -5 }, token)).status, 400);

  // Cambiar la duración del corte: la disponibilidad usa la nueva duración
  await call("PUT", "/api/admin/services/corte", { category: "barberia", name: "Corte caballero", minutes: 30, price: 10000, description: "" }, token);
  const a = (await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1")).body;
  assert.equal(a.minutes, 30);
  assert.equal(a.days[0].slots.at(-1), 1140 - 30);

  // Una cita guarda la duración y el precio de ese momento
  const c = await user();
  const b = (await c("POST", "/api/bookings", booking())).body;
  assert.equal(b.minutes, 30);
  assert.equal(b.total, 10000);
  await call("PUT", "/api/admin/services/corte", { category: "barberia", name: "Corte caballero", minutes: 60, price: 12000 }, token);
  assert.equal((await c("GET", "/api/me/bookings")).body.bookings[0].total, 10000);

  // No se puede borrar un servicio con citas, pero sí ocultarlo
  assert.equal((await call("DELETE", "/api/admin/services/corte", null, token)).status, 409);
  await call("PUT", "/api/admin/services/corte", { category: "barberia", name: "Corte caballero", minutes: 60, price: 12000, active: false }, token);
  cfg = (await call("GET", "/api/config")).body;
  assert.ok(!cfg.services.some((s) => s.id === "corte"));
  assert.deepEqual(cfg.retired, [{ id: "corte", name: "Corte caballero" }]);
  assert.equal((await c("POST", "/api/bookings", booking({ start: 780 }))).status, 400); // ya no se puede reservar

  // Borrar uno sin citas
  assert.equal((await call("DELETE", "/api/admin/services/diseno-de-cejas", null, token)).status, 200);

  // Ordenar
  const all = (await call("GET", "/api/admin/services", null, token)).body.services.map((s) => s.id);
  const reversed = [...all].reverse();
  const o = await call("PUT", "/api/admin/services-order", { ids: reversed }, token);
  assert.deepEqual(o.body.services.map((s) => s.id), reversed);
  assert.equal((await call("PUT", "/api/admin/services-order", { ids: reversed.slice(1) }, token)).status, 400);
});

/* ---------------- Archivos ---------------- */

test("archivos estáticos y protección de rutas", async (t) => {
  const { call, base } = await setup(t);
  const home = await fetch(base + "/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Reservar cita/);
  assert.equal((await fetch(base + "/admin")).status, 200);
  assert.equal((await fetch(base + "/..%2fserver%2fconfig.js")).status, 403);
  assert.equal((await fetch(base + "/nada.js")).status, 404);
  assert.equal((await call("GET", "/api/nada")).status, 404);
});

/* ---------------- Correos ---------------- */

test("correos: recibida, confirmada con .ics, cancelada por el cliente", async (t) => {
  const { call, user, admin, mails } = await setup(t);
  const c = await user({ email: "Cliente@Example.com", phone: "86665544" });
  const r = (await c("POST", "/api/bookings", booking())).body;
  await tick();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "cliente@example.com");
  assert.match(mails[0].subject, /Recibimos tu solicitud/);
  assert.match(mails[0].html, /Pendiente de confirmación/);
  assert.match(mails[0].html, /https:\/\/reservas.example.com\/\?citas=1/);

  const token = await admin();
  const p = await call("PATCH", `/api/admin/bookings/${r.id}`, { status: "confirmada" }, token);
  assert.equal(p.body.emailed, true);
  await tick();
  assert.equal(mails.length, 2);
  assert.match(mails[1].subject, /confirmada/);
  assert.match(mails[1].html, /Víctor Aguilar/);
  assert.match(mails[1].html, /Martes, 10 de noviembre de 2026/);
  const icsText = Buffer.from(mails[1].attachments[0].content, "base64").toString();
  assert.match(icsText, /DTSTART:20261110T160000Z/);
  assert.match(icsText, /DTEND:20261110T165000Z/);

  assert.equal((await call("PATCH", `/api/admin/bookings/${r.id}`, { status: "confirmada" }, token)).body.emailed, false);

  await c("POST", `/api/bookings/${r.id}/cancel`);
  await tick();
  assert.equal(mails.length, 3);
  assert.match(mails[2].html, /Cancelaste tu cita/);
});

test("correos: los datos del cliente se escapan en el HTML", async (t) => {
  const { user, mails } = await setup(t);
  const c = await user({ name: "<b>Juan</b> Pérez" });
  await c("POST", "/api/bookings", booking());
  await tick();
  assert.ok(!mails[0].html.includes("<b>Juan</b>"));
  assert.match(mails[0].html, /&lt;b&gt;Juan&lt;\/b&gt;/);
});

test("recordatorios: una sola vez, a citas confirmadas dentro de 24 horas", async (t) => {
  const { call, mails, handler, admin } = await setup(t, {}, { clock: () => new Date("2026-11-09T20:00:00Z") });
  const token = await admin();
  const mk = async (day, start) => (await call("POST", "/api/admin/bookings",
    { services: ["corte"], day, start, name: "Ana Mora", email: "ana@example.com" }, token)).body;
  const soon = await mk("2026-11-10", 540);
  await mk("2026-11-11", 540);
  await tick();
  const before = mails.length;
  assert.equal(before, 2);
  assert.equal(handler.runReminders(), 1);
  assert.equal(handler.runReminders(), 0);
  await tick();
  assert.match(mails[before].subject, /Recordatorio/);
  assert.match(mails[before].html, /Ana/);
  assert.ok(soon.id);
});

/* ---------------- Horario ---------------- */

test("horario: abrir un domingo, cerrar un día, volver al semanal", async (t) => {
  const { call, user, admin } = await setup(t);
  const token = await admin();
  const avail = async (day) => (await call("GET", `/api/availability?services=corte&from=${day}&days=1`)).body.days[0];

  assert.equal((await avail("2026-11-15")).open, false);
  let r = await call("PUT", "/api/admin/schedule/days", { category: "barberia", days: ["2026-11-15"], ranges: [[600, 780]] }, token);
  assert.equal(r.status, 200);
  const sun = await avail("2026-11-15");
  assert.equal(sun.open, true);
  assert.equal(sun.slots[0], 600);
  assert.equal(sun.slots.at(-1), 720);

  const c = await user();
  const b = (await c("POST", "/api/bookings", booking())).body;
  r = await call("PUT", "/api/admin/schedule/days", { category: "barberia", days: ["2026-11-10", "2026-11-11"], ranges: [] }, token);
  assert.equal(r.body.outside.length, 1);
  assert.equal(r.body.outside[0].id, b.id);
  assert.equal((await avail("2026-11-11")).open, false);

  const salon = (await call("GET", "/api/availability?services=color&from=2026-11-11&days=1")).body.days[0];
  assert.equal(salon.open, true);

  await call("PUT", "/api/admin/schedule/days", { category: "barberia", days: ["2026-11-11"], ranges: null }, token);
  assert.equal((await avail("2026-11-11")).open, true);

  const sch = (await call("GET", "/api/admin/schedule?category=barberia&from=2026-11-09&to=2026-11-15", null, token)).body;
  assert.equal(sch.days.length, 7);
  assert.deepEqual(sch.days.find((d) => d.day === "2026-11-15"), { day: "2026-11-15", ranges: [[600, 780]], special: true, bookings: 0 });
  assert.equal(sch.days.find((d) => d.day === "2026-11-10").bookings, 1);
});

test("horario semanal: solo días habilitados", async (t) => {
  const { call, admin } = await setup(t);
  const token = await admin();
  const week = { 0: [], 1: [], 2: [], 3: [], 4: [[540, 720], [840, 1080]], 5: [], 6: [] };
  assert.equal((await call("PUT", "/api/admin/schedule/week", { category: "barberia", week }, token)).status, 200);
  const days = (await call("GET", "/api/availability?services=corte&from=2026-11-09&days=7")).body.days;
  assert.deepEqual(days.filter((d) => d.open).map((d) => d.day), ["2026-11-12"]);
  const thu = days.find((d) => d.day === "2026-11-12").slots;
  assert.ok(!thu.includes(720) && thu.includes(840));

  assert.equal((await call("PUT", "/api/admin/schedule/week", { category: "barberia", week: { ...week, 1: [[600, 500]] } }, token)).status, 400);
  assert.equal((await call("PUT", "/api/admin/schedule/days", { category: "nope", days: ["2026-11-12"], ranges: [] }, token)).status, 400);
  assert.equal((await call("PUT", "/api/admin/schedule/week", { category: "barberia", week })).status, 401);
});
