"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const config = require("../server/config");
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
    ["salon", "Sadie Matamoros", "Seimar Salón"],
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
  const sadie = browser();
  await sadie("POST", "/api/auth/register", { name: "Sadie Matamoros", phone: "87001234", email: "sadie@example.com", password: "clave-de-sadie", acceptPrivacy: true });
  await victor("POST", "/api/admin/team", { login: "sadie@example.com" });

  const team = (await victor("GET", "/api/admin/team")).body.admins;
  const sadieId = team.find((a) => a.email === "sadie@example.com").id;
  assert.equal((await victor("PUT", `/api/admin/team/${sadieId}`, { agenda: "nope" })).status, 400);
  const r = await victor("PUT", `/api/admin/team/${sadieId}`, { agenda: "salon" });
  assert.equal(r.body.admins.find((a) => a.id === sadieId).agenda, "salon");
  assert.equal((await sadie("GET", "/api/me")).body.user.agenda, "salon");

  // Una pendiente en cada agenda
  const cli = browser();
  await cli("POST", "/api/auth/register", { name: "Luis Solano", phone: "86001133", email: "luis@example.com", password: "secreto123", acceptPrivacy: true });
  await cli("POST", "/api/bookings", { services: ["corte"], day: "2026-11-10", start: 600 });
  await cli("POST", "/api/bookings", { services: ["unas"], day: "2026-11-10", start: 600 });
  const sum = (await sadie("GET", "/api/admin/summary")).body;
  assert.equal(sum.pending, 2);
  assert.deepEqual(sum.pendingBy, { barberia: 1, salon: 1 });

  // Un cliente no puede cambiar agendas
  assert.equal((await cli("PUT", `/api/admin/team/${sadieId}`, { agenda: "" })).status, 403);
});

test("correos del salón: nombre comercial y profesional correctos", () => {
  const b = { id: "x1", category: "salon", day: "2026-11-10", start: 600, minutes: 90, services: ["color"], total: null, name: "Rosa Vargas" };
  const svc = config.services.map((s) => ({ id: s.id, name: s.name }));
  const m = render("confirmada", b, { ...config, services: svc }, { link: "https://x/?citas=1" });
  assert.equal(m.subject, "Tu cita en Seimar Salón está confirmada");
  assert.match(m.html, /Sadie Matamoros/);
  assert.match(m.html, /aprobada por el salón/);
  assert.ok(!/Barbería está confirmada/.test(m.subject));
  const ics = Buffer.from(m.attachments[0].content, "base64").toString();
  assert.match(ics, /SUMMARY:Color · Seimar Salón/);

  const r = render("recibida", { ...b, category: "barberia", services: ["corte"] }, { ...config, services: svc });
  assert.equal(r.subject, "Recibimos tu solicitud de cita · Víctor Aguilar Barbería");
  assert.match(r.html, /La barbería la revisará/);
});
