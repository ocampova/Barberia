"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const config = require("../server/config");
const { openDb, repo } = require("../server/db");
const { createApp } = require("../server/app");

// Reloj fijo: lunes 9 de noviembre de 2026, 8:00 a.m. en Costa Rica (14:00 UTC).
const clock = () => new Date("2026-11-09T14:00:00Z");

async function setup(t, env = {}, opts = {}) {
  const notices = [];
  const mails = [];
  const handler = createApp({
    repo: repo(openDb(":memory:")), config, clock: opts.clock || clock,
    env: { ADMIN_PIN: "246810", ADMIN_SECRET: "x".repeat(32), PUBLIC_URL: "https://reservas.example.com", ...env },
    notify: (title, text) => notices.push({ title, text }),
    mailer: { enabled: true, send: async (m) => { mails.push(m); return { id: "ok" }; } },
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  return { call, notices, mails, base, handler };
}

const booking = (extra = {}) => ({ services: ["corte"], day: "2026-11-10", start: 600, name: "Juan Pérez", phone: "8888 1234", ...extra });

test("config pública no expone datos internos", async (t) => {
  const { call } = await setup(t);
  const r = await call("GET", "/api/config");
  assert.equal(r.status, 200);
  assert.equal(r.body.today, "2026-11-09");
  assert.ok(r.body.services.length > 5);
  assert.equal(r.body.categories[0].capacity, undefined);
  assert.equal(r.body.hours, undefined);
});

test("flujo completo: reservar, ver, el espacio desaparece, cancelar", async (t) => {
  const { call, notices } = await setup(t);
  let a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(a.body.days[0].slots.includes(600));

  const r = await call("POST", "/api/bookings", booking());
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "pendiente");
  assert.equal(r.body.total, 9000);
  assert.ok(r.body.token);
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /50688881234/);

  a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(!a.body.days[0].slots.includes(600));

  const dup = await call("POST", "/api/bookings", booking({ phone: "87654321", name: "Otra Persona" }));
  assert.equal(dup.status, 409);

  const seen = await call("GET", `/api/bookings/${r.body.id}?token=${r.body.token}`);
  assert.equal(seen.body.name, "Juan"); // solo el nombre de pila
  assert.equal(seen.body.phone, undefined);
  assert.equal((await call("GET", `/api/bookings/${r.body.id}?token=malo`)).status, 404);

  const c = await call("POST", `/api/bookings/${r.body.id}/cancel`, { token: r.body.token });
  assert.equal(c.body.status, "cancelada");
  a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(a.body.days[0].slots.includes(600));
});

test("validaciones", async (t) => {
  const { call } = await setup(t, { BOOKING_RATE_LIMIT: "50" });
  assert.equal((await call("POST", "/api/bookings", booking({ services: ["corte", "color"] }))).status, 400);
  assert.equal((await call("POST", "/api/bookings", booking({ services: ["nope"] }))).status, 400);
  assert.equal((await call("POST", "/api/bookings", booking({ phone: "123" }))).status, 400);
  assert.equal((await call("POST", "/api/bookings", booking({ name: "" }))).status, 400);
  assert.equal((await call("POST", "/api/bookings", booking({ day: "2026-02-30" }))).status, 400);
  assert.equal((await call("POST", "/api/bookings", booking({ start: 605 }))).status, 409); // no es una hora de la grilla
  assert.equal((await call("POST", "/api/bookings", booking({ day: "2026-11-15" }))).status, 409); // domingo
  assert.equal((await call("POST", "/api/bookings", booking({ day: "2026-11-09", start: 480 }))).status, 409); // ya pasó
  assert.equal((await call("POST", "/api/bookings", booking({ website: "spam" }))).status, 400);
});

test("límite de intentos de reserva por hora", async (t) => {
  const { call } = await setup(t, { BOOKING_RATE_LIMIT: "2" });
  await call("POST", "/api/bookings", booking({ phone: "1" }));
  await call("POST", "/api/bookings", booking({ phone: "1" }));
  assert.equal((await call("POST", "/api/bookings", booking())).status, 429);
});

test("límite de citas activas por teléfono", async (t) => {
  const { call } = await setup(t);
  for (const start of [540, 660, 780]) assert.equal((await call("POST", "/api/bookings", booking({ start }))).status, 201);
  assert.equal((await call("POST", "/api/bookings", booking({ start: 900 }))).status, 429);
});

test("panel: requiere PIN y gestiona citas y bloqueos", async (t) => {
  const { call } = await setup(t);
  assert.equal((await call("GET", "/api/admin/bookings")).status, 401);
  assert.equal((await call("POST", "/api/admin/login", { pin: "000000" })).status, 401);
  const { token } = (await call("POST", "/api/admin/login", { pin: "246810" })).body;
  assert.ok(token);
  assert.equal((await call("GET", "/api/admin/bookings", null, token + "x")).status, 401);

  const r = (await call("POST", "/api/bookings", booking())).body;
  assert.equal((await call("GET", "/api/admin/summary", null, token)).body.pending, 1);

  const list = await call("GET", "/api/admin/bookings?from=2026-11-10&to=2026-11-10", null, token);
  assert.equal(list.body.bookings[0].phone, "50688881234");
  assert.equal(list.body.bookings[0].token, undefined);

  const p = await call("PATCH", `/api/admin/bookings/${r.id}`, { status: "confirmada" }, token);
  assert.equal(p.body.status, "confirmada");
  assert.equal((await call("GET", `/api/bookings/${r.id}?token=${r.token}`)).body.status, "confirmada");
  assert.equal((await call("PATCH", `/api/admin/bookings/${r.id}`, { status: "x" }, token)).status, 400);

  // Bloqueo de almuerzo: desaparecen esas horas
  const blk = await call("POST", "/api/admin/blocks", { day: "2026-11-10", start: 720, end: 780, reason: "Almuerzo" }, token);
  assert.equal(blk.status, 201);
  let a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(!a.body.days[0].slots.includes(720));
  await call("DELETE", `/api/admin/blocks/${blk.body.id}`, null, token);
  a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(a.body.days[0].slots.includes(720));

  // Cita del panel: confirmada de una vez; choca → 409 salvo force
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

test("correos: recibida, confirmada con .ics, cancelada por el cliente", async (t) => {
  const { call, mails } = await setup(t);
  const r = (await call("POST", "/api/bookings", booking({ email: "Cliente@Example.com" }))).body;
  await new Promise((ok) => setImmediate(ok));
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "cliente@example.com");
  assert.match(mails[0].subject, /Recibimos tu solicitud/);
  assert.match(mails[0].html, /Pendiente de confirmación/);
  assert.match(mails[0].html, new RegExp(`https://reservas.example.com/\\?cita=${r.id}&amp;t=`));

  const { token } = (await call("POST", "/api/admin/login", { pin: "246810" })).body;
  const p = await call("PATCH", `/api/admin/bookings/${r.id}`, { status: "confirmada" }, token);
  assert.equal(p.body.emailed, true);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(mails.length, 2);
  assert.match(mails[1].subject, /confirmada/);
  assert.match(mails[1].html, /Víctor Aguilar/); // profesional
  assert.match(mails[1].html, /Martes, 10 de noviembre de 2026/);
  const icsText = Buffer.from(mails[1].attachments[0].content, "base64").toString();
  assert.match(icsText, /DTSTART:20261110T160000Z/); // 10:00 a.m. Costa Rica = 16:00 UTC
  assert.match(icsText, /DTEND:20261110T165000Z/);

  // Volver a guardar el mismo estado no reenvía el correo
  assert.equal((await call("PATCH", `/api/admin/bookings/${r.id}`, { status: "confirmada" }, token)).body.emailed, false);

  await call("POST", `/api/bookings/${r.id}/cancel`, { token: r.token });
  await new Promise((ok) => setImmediate(ok));
  assert.equal(mails.length, 3);
  assert.match(mails[2].html, /Cancelaste tu cita/);
});

test("correos: sin correo no se envía nada; correo inválido se rechaza", async (t) => {
  const { call, mails } = await setup(t);
  assert.equal((await call("POST", "/api/bookings", booking())).status, 201);
  assert.equal((await call("POST", "/api/bookings", booking({ start: 660, email: "no-es-correo" }))).status, 400);
  assert.equal((await call("POST", "/api/bookings", booking({ start: 660, email: "a@b.co<script>" }))).status, 400);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(mails.length, 0);
});

test("correos: los datos del cliente se escapan en el HTML", async (t) => {
  const { call, mails } = await setup(t);
  await call("POST", "/api/bookings", booking({ name: "<b>Juan</b> Pérez", email: "j@example.com" }));
  await new Promise((ok) => setImmediate(ok));
  assert.ok(!mails[0].html.includes("<b>Juan</b>"));
  assert.match(mails[0].html, /&lt;b&gt;Juan&lt;\/b&gt;/);
});

test("recordatorios: una sola vez, a citas confirmadas dentro de 24 horas", async (t) => {
  // Lunes 9 de noviembre, 2:00 p.m. en Costa Rica
  const { call, mails, handler } = await setup(t, {}, { clock: () => new Date("2026-11-09T20:00:00Z") });
  const { token } = (await call("POST", "/api/admin/login", { pin: "246810" })).body;
  const mk = async (day, start) => (await call("POST", "/api/admin/bookings",
    { services: ["corte"], day, start, name: "Ana Mora", email: "ana@example.com" }, token)).body;
  const soon = await mk("2026-11-10", 540);     // mañana 9:00 → en 19 h
  await mk("2026-11-11", 540);                   // en 43 h → todavía no
  await new Promise((ok) => setImmediate(ok));
  const before = mails.length;                   // confirmaciones de las dos citas
  assert.equal(before, 2);
  assert.equal(handler.runReminders(), 1);
  assert.equal(handler.runReminders(), 0);       // no se repite
  await new Promise((ok) => setImmediate(ok));
  assert.match(mails[before].subject, /Recordatorio/);
  assert.match(mails[before].html, new RegExp(soon.id));
});

test("horario: abrir un domingo, cerrar un día, volver al semanal", async (t) => {
  const { call } = await setup(t);
  const { token } = (await call("POST", "/api/admin/login", { pin: "246810" })).body;
  const avail = async (day) => (await call("GET", `/api/availability?services=corte&from=${day}&days=1`)).body.days[0];

  // El domingo 15 está cerrado por el horario semanal inicial
  assert.equal((await avail("2026-11-15")).open, false);
  let r = await call("PUT", "/api/admin/schedule/days", { category: "barberia", days: ["2026-11-15"], ranges: [[600, 780]] }, token);
  assert.equal(r.status, 200);
  const sun = await avail("2026-11-15");
  assert.equal(sun.open, true);
  assert.equal(sun.slots[0], 600);
  assert.equal(sun.slots.at(-1), 720); // 12:00 + 50 min cabe antes de la 1:00 p.m.

  // Una cita el martes y luego se cierra ese día: avisa la cita afectada
  const b = (await call("POST", "/api/bookings", booking())).body;
  r = await call("PUT", "/api/admin/schedule/days", { category: "barberia", days: ["2026-11-10", "2026-11-11"], ranges: [] }, token);
  assert.equal(r.body.outside.length, 1);
  assert.equal(r.body.outside[0].id, b.id);
  assert.equal((await avail("2026-11-11")).open, false);

  // El salón no se ve afectado
  const salon = (await call("GET", "/api/availability?services=color&from=2026-11-11&days=1")).body.days[0];
  assert.equal(salon.open, true);

  // Volver al horario semanal
  await call("PUT", "/api/admin/schedule/days", { category: "barberia", days: ["2026-11-11"], ranges: null }, token);
  assert.equal((await avail("2026-11-11")).open, true);

  const sch = (await call("GET", "/api/admin/schedule?category=barberia&from=2026-11-09&to=2026-11-15", null, token)).body;
  assert.equal(sch.days.length, 7);
  assert.deepEqual(sch.days.find((d) => d.day === "2026-11-15"), { day: "2026-11-15", ranges: [[600, 780]], special: true, bookings: 0 });
  assert.equal(sch.days.find((d) => d.day === "2026-11-10").bookings, 1);
});

test("horario semanal: solo días habilitados", async (t) => {
  const { call } = await setup(t);
  const { token } = (await call("POST", "/api/admin/login", { pin: "246810" })).body;
  const week = { 0: [], 1: [], 2: [], 3: [], 4: [[540, 720], [840, 1080]], 5: [], 6: [] }; // solo jueves, con almuerzo
  assert.equal((await call("PUT", "/api/admin/schedule/week", { category: "barberia", week }, token)).status, 200);
  const days = (await call("GET", "/api/availability?services=corte&from=2026-11-09&days=7")).body.days;
  assert.deepEqual(days.filter((d) => d.open).map((d) => d.day), ["2026-11-12"]);
  const thu = days.find((d) => d.day === "2026-11-12").slots;
  assert.ok(!thu.includes(720) && thu.includes(840));

  assert.equal((await call("PUT", "/api/admin/schedule/week", { category: "barberia", week: { ...week, 1: [[600, 500]] } }, token)).status, 400);
  assert.equal((await call("PUT", "/api/admin/schedule/days", { category: "nope", days: ["2026-11-12"], ranges: [] }, token)).status, 400);
  assert.equal((await call("PUT", "/api/admin/schedule/week", { category: "barberia", week })).status, 401);
});

test("config pública: estado abierto/cerrado según el horario", async (t) => {
  // lunes 9 de noviembre, 8:00 a.m.: abre a las 9:00
  const { call } = await setup(t);
  const st = (await call("GET", "/api/config")).body.status;
  assert.deepEqual(st, { open: false, opensAt: 540, opensDay: "2026-11-09" });
});
