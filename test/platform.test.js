"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const { negocios } = require("../server/negocios");
const { createPlatform } = require("../server/platform");
const { openDb, repo } = require("../server/db");
const { createApp } = require("../server/app");
const dosAgendas = require("./fixtures/dos-agendas");

const clock = () => new Date("2026-11-09T14:00:00Z"); // lunes 8:00 a.m. en Costa Rica
const quiet = { log() {}, warn() {}, error() {} };
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "plat-")); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const ENV = { PUBLIC_URL: "https://victoraguilar.elcorte.app", ADMIN_EMAIL: "allan@example.com", ADMIN_PASSWORD: "clave-del-dueno",
  REGISTER_RATE_LIMIT: "100", LOGIN_RATE_LIMIT: "100" };
const noMail = { enabled: false, send() {} };

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((ok) => server.listen(0, ok));
  t.after(() => server.close());
  const port = server.address().port;
  // Cliente HTTP que permite fijar el Host (para simular cada subdominio) y guarda cookies por host.
  const jars = {};
  return (host, method, p, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port, method, path: p,
      headers: { host, "content-type": "application/json", ...(jars[host] ? { cookie: jars[host] } : {}),
        ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        const set = res.headers["set-cookie"];
        if (set) jars[host] = set[0].split(";")[0];
        let json = null; try { json = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode, body: json, text: buf, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

test("cada dirección muestra su negocio; un subdominio desconocido no existe", async (t) => {
  const p = createPlatform({ negocios, dataDir: tmp(t), env: ENV, clock, mailer: noMail, log: quiet });
  t.after(() => p.close());
  assert.equal(p.domain, "elcorte.app");
  assert.equal(p.resolve("victoraguilar.elcorte.app").slug, "victoraguilar");
  assert.equal(p.resolve("SEIMAR.elcorte.app:443").slug, "seimar");
  assert.equal(p.resolve("seimar.localhost:8080").slug, "seimar");
  assert.equal(p.resolve("barberia-production.up.railway.app").slug, "victoraguilar"); // por defecto
  assert.equal(p.resolve("nadie.elcorte.app"), null);

  const call = await serve(t, p.handler);
  assert.equal((await call("nadie.elcorte.app", "GET", "/")).status, 404);
  const s = (await call("seimar.elcorte.app", "GET", "/api/config")).body;
  assert.equal(s.name, "Seimar Salón");
  assert.equal(s.theme.accent, "#c8917c");
  assert.deepEqual(s.categories.map((c) => c.staff), ["Seidy Matamoros"]);
  assert.ok(s.services.every((x) => x.cat === "salon"));
  assert.deepEqual(s.related.map((r) => [r.name, r.url]), [["Víctor Aguilar Barbería", "https://victoraguilar.elcorte.app"]]);
  const v = (await call("victoraguilar.elcorte.app", "GET", "/api/config")).body;
  assert.equal(v.name, "Víctor Aguilar Barbería");
  assert.ok(v.services.every((x) => x.cat === "barberia"));
  assert.deepEqual(v.related.map((r) => r.url), ["https://seimar.elcorte.app"]);
});

test("las páginas llevan la marca de su negocio (sin rastros del otro)", async (t) => {
  const p = createPlatform({ negocios, dataDir: tmp(t), env: ENV, clock, mailer: noMail, log: quiet });
  t.after(() => p.close());
  const call = await serve(t, p.handler);
  const home = (await call("seimar.elcorte.app", "GET", "/")).text;
  assert.match(home, /<title>Seimar Salón · Reservas<\/title>/);
  assert.match(home, /html:root\{--gold:#c8917c/);
  assert.match(home, /img\/negocios\/seimar\/logo\.svg/);
  assert.match(home, /Tu belleza,<br \/><em>nuestro arte<\/em>/);
  assert.ok(!/Víctor|\{\{/.test(home.replace(/<script[\s\S]*?<\/script>/g, "")), "no debe quedar nada de Víctor ni marcadores sin reemplazar");
  const admin = (await call("seimar.elcorte.app", "GET", "/admin")).text;
  assert.match(admin, /<h1>Panel del salón<\/h1>/);
  const priv = (await call("seimar.elcorte.app", "GET", "/privacidad.html")).text;
  assert.match(priv, /Seimar Salón, en San Roque de Grecia/);
  assert.ok(!priv.includes("Víctor"));
  const man = (await call("seimar.elcorte.app", "GET", "/manifest.webmanifest")).body;
  assert.equal(man.name, "Seimar Salón");
  assert.equal(man.icons[0].src, "img/negocios/seimar/icon-192.png");
  const vhome = (await call("victoraguilar.elcorte.app", "GET", "/")).text;
  assert.match(vhome, /html:root\{--gold:#c9a227/);
  assert.match(vhome, /Tu estilo,<br \/><em>nuestra prioridad<\/em>/);
});

test("clientes, citas y sesiones aislados entre negocios", async (t) => {
  const p = createPlatform({ negocios, dataDir: tmp(t), env: ENV, clock, mailer: noMail, log: quiet });
  t.after(() => p.close());
  const call = await serve(t, p.handler);
  const S = "seimar.elcorte.app", V = "victoraguilar.elcorte.app";
  const reg = { name: "Rosa Vargas", phone: "86001122", email: "rosa@example.com", password: "secreto123", acceptPrivacy: true };
  assert.equal((await call(S, "POST", "/api/auth/register", reg)).status, 201);
  assert.equal((await call(S, "POST", "/api/bookings", { services: ["color"], day: "2026-11-10", start: 600 })).status, 201);

  // La cuenta de Seimar no existe en la barbería (se puede registrar aparte con el mismo correo)
  assert.equal((await call(V, "POST", "/api/auth/login", { login: "rosa@example.com", password: "secreto123" })).status, 401);
  assert.equal((await call(V, "GET", "/api/me")).body.user, null);
  assert.equal((await call(V, "POST", "/api/auth/register", reg)).status, 201);
  assert.equal((await call(V, "GET", "/api/me/bookings")).body.bookings.length, 0);
  // Un servicio de un negocio no se puede reservar en el otro
  assert.equal((await call(V, "POST", "/api/bookings", { services: ["color"], day: "2026-11-10", start: 600 })).status, 400);
  // La cita del salón no ocupa la agenda de la barbería
  assert.ok((await call(V, "GET", "/api/availability?services=corte&from=2026-11-10&days=1")).body.days[0].slots.includes(600));

  // El dueño de la plataforma (ADMIN_EMAIL) administra cada negocio por separado
  const owner = { login: "allan@example.com", password: "clave-del-dueno" };
  assert.equal((await call(S, "POST", "/api/auth/login", owner)).status, 200);
  const pend = (await call(S, "GET", "/api/admin/bookings?status=pendiente")).body.bookings;
  assert.deepEqual(pend.map((b) => b.services[0]), ["color"]);
  assert.equal((await call(V, "GET", "/api/admin/bookings")).status, 403); // en V la sesión es la de Rosa (cliente)
});

test("migración: los datos del salón pasan de la base de Víctor a la de Seimar (una sola vez)", async (t) => {
  const dir = tmp(t);
  // Base "antigua" de Víctor con las dos agendas, una clienta del salón y un cliente de la barbería
  const legacyFile = path.join(dir, "barberia.db");
  const legacy = openDb(legacyFile);
  const r = repo(legacy);
  createApp({ repo: r, config: dosAgendas, clock, env: { ADMIN_EMAIL: "allan@example.com", ADMIN_PASSWORD: "clave-del-dueno" }, mailer: noMail });
  const rosa = r.userInsert({ name: "Rosa Vargas", phone: "50686001122", email: "rosa@example.com", pass_hash: "x" });
  const luis = r.userInsert({ name: "Luis Solano", phone: "50686001133", email: "luis@example.com", pass_hash: "y" });
  const mk = (id, category, services, user_id) => r.insertBooking({ id, token: "t" + id, category, day: "2026-11-10", start: 600, minutes: 60,
    services, total: null, name: "x", phone: "1", email: "", note: "", status: "pendiente", source: "web",
    created_at: "2026-11-01", updated_at: "2026-11-01", user_id });
  mk("s1", "salon", ["color"], rosa);
  mk("b1", "barberia", ["corte"], luis);
  r.daySet("salon", "2026-12-24", []);
  r.settingSet("cancelHours", 6);
  legacy.close();

  const p = createPlatform({ negocios, dataDir: dir, env: ENV, clock, mailer: noMail, log: quiet });
  const seimar = p.tenants.find((x) => x.slug === "seimar").repo;
  const victor = p.tenants.find((x) => x.slug === "victoraguilar").repo;
  // Seimar recibió lo suyo
  assert.deepEqual(seimar.bookingsRange("2026-11-01", "2026-12-31").map((b) => b.id), ["s1"]);
  assert.ok(seimar.services().every((s) => s.category === "salon") && seimar.services().length > 0);
  assert.deepEqual(seimar.dayGet("salon", "2026-12-24"), []);
  assert.equal(seimar.setting("cancelHours", 0), 6);
  assert.equal(seimar.userByEmail("rosa@example.com").id, rosa);   // la clienta conserva su cuenta (y su historial)
  assert.equal(seimar.userByEmail("allan@example.com").role, "admin");
  assert.equal(seimar.userByEmail("luis@example.com"), undefined); // cliente solo de la barbería: no se copia
  // Víctor quedó solo con la barbería
  assert.deepEqual(victor.bookingsRange("2026-11-01", "2026-12-31").map((b) => b.id), ["b1"]);
  assert.ok(victor.services().every((s) => s.category === "barberia"));
  // Copia de seguridad previa
  assert.ok(fs.readdirSync(path.join(dir, "backups")).some((f) => f.startsWith("antes-de-separar-salon")));
  p.close();

  // Arrancar de nuevo no repite la migración
  const p2 = createPlatform({ negocios, dataDir: dir, env: ENV, clock, mailer: noMail, log: quiet });
  assert.deepEqual(p2.tenants.find((x) => x.slug === "seimar").repo.bookingsRange("2026-11-01", "2026-12-31").map((b) => b.id), ["s1"]);
  p2.close();
  const check = new DatabaseSync(legacyFile);
  assert.equal(check.prepare("SELECT COUNT(*) AS n FROM bookings WHERE category = 'salon'").get().n, 0);
  check.close();
});
