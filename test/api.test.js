"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const config = require("../server/config");
const { openDb, repo } = require("../server/db");
const { createApp } = require("../server/app");

// Reloj fijo: lunes 9 de noviembre de 2026, 8:00 a.m. en Costa Rica (14:00 UTC).
const clock = () => new Date("2026-11-09T14:00:00Z");

async function setup(t, env = {}) {
  const notices = [];
  const handler = createApp({
    repo: repo(openDb(":memory:")), config, clock,
    env: { ADMIN_PIN: "246810", ADMIN_SECRET: "x".repeat(32), ...env },
    notify: (title, text) => notices.push({ title, text }),
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
  return { call, notices, base };
}

const booking = (extra = {}) => ({ services: ["corte"], day: "2026-11-10", start: 600, name: "Juan Pérez", phone: "8888 1234", ...extra });

test("config pública no expone datos internos", async (t) => {
  const { call } = await setup(t);
  const r = await call("GET", "/api/config");
  assert.equal(r.status, 200);
  assert.equal(r.body.today, "2026-11-09");
  assert.ok(r.body.services.length > 5);
  assert.equal(r.body.categories[0].capacity, undefined);
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
