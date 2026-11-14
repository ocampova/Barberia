"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const config = require("./fixtures/dos-agendas");
const { openDb, repo } = require("../server/db");
const { createApp } = require("../server/app");
const { render } = require("../server/emails");

// Lunes 9 de noviembre de 2026, 8:00 a.m. en Costa Rica
const clock = () => new Date("2026-11-09T14:00:00Z");

async function setup(t) {
  const mails = [];
  const handler = createApp({ repo: repo(openDb(":memory:")), config, clock,
    env: { ADMIN_EMAIL: "victor@example.com", ADMIN_PASSWORD: "clave-de-victor", PUBLIC_URL: "https://x.example.com",
      REGISTER_RATE_LIMIT: "100", LOGIN_RATE_LIMIT: "100" },
    mailer: { enabled: true, send: async (m) => { mails.push(m); } } });
  const server = http.createServer(handler);
  await new Promise((ok) => server.listen(0, ok));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = () => {
    let cookie = "";
    return async (method, path, body) => {
      const res = await fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) } });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  return { browser, mails };
}

test("cada agenda tiene su profesional y su nombre comercial", async (t) => {
  const { browser } = await setup(t);
  const cats = (await browser()("GET", "/api/config")).body.categories;
  assert.deepEqual(cats.map((c) => [c.id, c.staff, c.brand]), [
    ["barberia", "Víctor Aguilar", "Víctor Aguilar Barbería"],
    ["salon", "Seidy Matamoros", "Seimar Salón"],
  ]);
  assert.equal(cats[0].capacity, undefined); // no se expone la capacidad
});

test("las agendas son independientes: una cita del salón no ocupa la barbería", async (t) => {
  const { browser } = await setup(t);
  const c = browser();
  await c("POST", "/api/auth/register", { name: "Rosa Vargas", phone: "86001122", email: "rosa@example.com", password: "secreto123", acceptPrivacy: true });
  assert.equal((await c("POST", "/api/bookings", { services: ["color"], day: "2026-11-10", start: 600 })).status, 201);
  const pub = browser();
  const barb = (await pub("GET", "/api/availability?services=corte&from=2026-11-10&days=1")).body.days[0].slots;
  const salon = (await pub("GET", "/api/availability?services=corte-peinado&from=2026-11-10&days=1")).body.days[0].slots;
  assert.ok(barb.includes(600));
  assert.ok(!salon.includes(600));
});

test("equipo: cada cuenta se asigna a su agenda y el resumen separa las pendientes", async (t) => {
  const { browser } = await setup(t);
  const victor = browser();
  assert.equal((await victor("POST", "/api/auth/login", { login: "victor@example.com", password: "clave-de-victor" })).status, 200);
  const seidy = browser();
  await seidy("POST", "/api/auth/register", { name: "Seidy Matamoros", phone: "87001234", email: "seidy@example.com", password: "clave-de-seidy", acceptPrivacy: true });
  await victor("POST", "/api/admin/team", { login: "seidy@example.com" });

  const team = (await victor("GET", "/api/admin/team")).body.admins;
  const seidyId = team.find((a) => a.email === "seidy@example.com").id;
  assert.equal((await victor("PUT", `/api/admin/team/${seidyId}`, { agenda: "nope" })).status, 400);
  const r = await victor("PUT", `/api/admin/team/${seidyId}`, { agenda: "salon" });
  assert.equal(r.body.admins.find((a) => a.id === seidyId).agenda, "salon");
  assert.equal((await seidy("GET", "/api/me")).body.user.agenda, "salon");

  // Una pendiente en cada agenda
  const cli = browser();
  await cli("POST", "/api/auth/register", { name: "Luis Solano", phone: "86001133", email: "luis@example.com", password: "secreto123", acceptPrivacy: true });
  await cli("POST", "/api/bookings", { services: ["corte"], day: "2026-11-10", start: 600 });
  await cli("POST", "/api/bookings", { services: ["unas"], day: "2026-11-10", start: 600 });
  const sum = (await seidy("GET", "/api/admin/summary")).body;
  assert.equal(sum.pending, 2);
  assert.deepEqual(sum.pendingBy, { barberia: 1, salon: 1 });

  // Un cliente no puede cambiar agendas
  assert.equal((await cli("PUT", `/api/admin/team/${seidyId}`, { agenda: "" })).status, 403);
});

test("correos del salón: nombre comercial y profesional correctos", () => {
  const b = { id: "x1", category: "salon", day: "2026-11-10", start: 600, minutes: 90, services: ["color"], total: null, name: "Rosa Vargas" };
  const svc = config.services.map((s) => ({ id: s.id, name: s.name }));
  const m = render("confirmada", b, { ...config, services: svc }, { link: "https://x/?citas=1" });
  assert.equal(m.subject, "Tu cita en Seimar Salón está confirmada");
  assert.match(m.html, /Seidy Matamoros/);
  assert.match(m.html, /aprobada por el salón/);
  assert.ok(!/Barbería está confirmada/.test(m.subject));
  const ics = Buffer.from(m.attachments[0].content, "base64").toString();
  assert.match(ics, /SUMMARY:Color · Seimar Salón/);
  assert.match(ics, /DESCRIPTION:Cita en el salón · Seimar Salón/); // la alarma del calendario no dice "barbería"
  assert.ok(!/barber/i.test(ics), "el .ics del salón no menciona la barbería");

  const r = render("recibida", { ...b, category: "barberia", services: ["corte"] }, { ...config, services: svc });
  assert.equal(r.subject, "Recibimos tu solicitud de cita · Víctor Aguilar Barbería");
  assert.match(r.html, /La barbería la revisará/);
});

test("cerrar un rango largo de fechas (vacaciones) en una o ambas agendas", async (t) => {
  const { browser } = await setup(t);
  const v = browser();
  await v("POST", "/api/auth/login", { login: "victor@example.com", password: "clave-de-victor" });
  const days = [];
  for (let d = new Date("2026-12-20T12:00:00Z"); days.length < 200; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  assert.equal((await v("PUT", "/api/admin/schedule/days", { category: "barberia", days, ranges: [] })).status, 200);
  const big = [...days, ...days.map((d) => d.replace("2026", "2028")), ...days.map((d) => d.replace("2026", "2029"))];
  assert.equal((await v("PUT", "/api/admin/schedule/days", { category: "barberia", days: big, ranges: [] })).status, 400); // más de 400 días

  const sch = (await v("GET", "/api/admin/schedule?category=barberia&from=2026-12-19&to=2027-01-06")).body.days;
  assert.deepEqual(sch.find((d) => d.day === "2026-12-19").ranges.length > 0, true); // el día antes sigue abierto
  assert.ok(sch.filter((d) => d.day >= "2026-12-20").every((d) => d.ranges.length === 0 && d.special));
  // El salón sigue abierto esos días
  const salon = (await v("GET", "/api/admin/schedule?category=salon&from=2026-12-21&to=2026-12-21")).body.days[0];
  assert.ok(salon.ranges.length > 0);
});
