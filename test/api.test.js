"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const config = require("./fixtures/dos-agendas");
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
    env: { ADMIN_EMAIL: "jefe@example.com", ADMIN_PASSWORD: "clave-del-jefe", PUBLIC_URL: "https://reservas.example.com",
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
    const call = async (method, path, body) => {
      const res = await fetch(base + path, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
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
    const r = await c("POST", "/api/auth/register", { acceptPrivacy: true, 
      name: "Juan Pérez", phone: `8888${String(1000 + n)}`, email: `juan${n}@example.com`, password: "secreto123", ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    c.user = r.body.user;
    return c;
  }
  // "Navegador" con la sesión del administrador creado por ADMIN_EMAIL / ADMIN_PASSWORD.
  async function admin() {
    const a = browser();
    const r = await a("POST", "/api/auth/login", { login: "jefe@example.com", password: "clave-del-jefe" });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.admin, true);
    return a;
  }
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
  assert.deepEqual((await c("GET", "/api/me")).body, { user: null, platform: null });

  const r = await c("POST", "/api/auth/register", { acceptPrivacy: true,  name: "Ana Mora", phone: "8777 6655", email: "Ana@Example.com", password: "secreto123" });
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
  assert.equal((await other("POST", "/api/auth/register", { acceptPrivacy: true,  name: "X Y", phone: "87776655", email: "otra@example.com", password: "secreto123" })).status, 409);
  assert.equal((await other("POST", "/api/auth/register", { acceptPrivacy: true,  name: "X Y", phone: "86665544", email: "ANA@example.com", password: "secreto123" })).status, 409);
  assert.equal((await other("POST", "/api/auth/register", { acceptPrivacy: true,  name: "X Y", phone: "86665544", email: "x@example.com", password: "corta" })).status, 400);

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

test("panel: requiere cuenta de administrador y gestiona citas y bloqueos", async (t) => {
  const { call, user, admin } = await setup(t);
  assert.equal((await call("GET", "/api/admin/bookings")).status, 401);
  // Un cliente con sesión no puede entrar al panel
  const cliente = await user();
  assert.equal((await cliente("GET", "/api/admin/bookings")).status, 403);
  assert.equal((await cliente("GET", "/api/me")).body.user.admin, false);
  const adm = await admin();

  const c = await user();
  const r = (await c("POST", "/api/bookings", booking())).body;
  assert.equal((await adm("GET", "/api/admin/summary")).body.pending, 1);

  const list = await adm("GET", "/api/admin/bookings?from=2026-11-10&to=2026-11-10");
  assert.equal(list.body.bookings[0].phone, c.user.phone);
  assert.equal(list.body.bookings[0].name, "Juan Pérez");
  assert.equal(list.body.bookings[0].token, undefined);

  const p = await adm("PATCH", `/api/admin/bookings/${r.id}`, { status: "confirmada" });
  assert.equal(p.body.status, "confirmada");
  assert.equal((await c("GET", "/api/me/bookings")).body.bookings[0].status, "confirmada");
  assert.equal((await adm("PATCH", `/api/admin/bookings/${r.id}`, { status: "x" })).status, 400);

  const blk = await adm("POST", "/api/admin/blocks", { day: "2026-11-10", start: 720, end: 780, reason: "Almuerzo" });
  assert.equal(blk.status, 201);
  let a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(!a.body.days[0].slots.includes(720));
  await adm("DELETE", `/api/admin/blocks/${blk.body.id}`);
  a = await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1");
  assert.ok(a.body.days[0].slots.includes(720));

  // Cita del panel (cliente sin cuenta): confirmada de una vez; choca → 409 salvo force
  const w = await adm("POST", "/api/admin/bookings", { services: ["barba"], day: "2026-11-10", start: 600, name: "Cliente local" });
  assert.equal(w.status, 409);
  const w2 = await adm("POST", "/api/admin/bookings", { services: ["barba"], day: "2026-11-10", start: 600, name: "Cliente local", force: true });
  assert.equal(w2.status, 201);
  assert.equal(w2.body.status, "confirmada");
});

test("primer administrador: se crea con ADMIN_EMAIL, nunca promueve una cuenta existente", async (t) => {
  // Sin ADMIN_EMAIL no hay administradores
  const none = await setup(t, { ADMIN_EMAIL: "" });
  assert.equal((await none.call("POST", "/api/auth/login", { login: "jefe@example.com", password: "clave-del-jefe" })).status, 401);

  // Contraseña corta: no se crea
  const weak = await setup(t, { ADMIN_PASSWORD: "123" });
  assert.equal((await weak.call("POST", "/api/auth/login", { login: "jefe@example.com", password: "123" })).status, 401);

  // Una cuenta de cliente existente con ese correo no se convierte en admin al arrancar
  const { openDb, repo: mkRepo } = require("../server/db");
  const shared = mkRepo(openDb(":memory:"));
  shared.userInsert({ name: "Intruso", phone: "50680000000", email: "jefe@example.com", pass_hash: "x" });
  createApp({ repo: shared, config, clock, env: { ADMIN_EMAIL: "jefe@example.com", ADMIN_PASSWORD: "clave-del-jefe" }, mailer: { enabled: false, send() {} } });
  assert.equal(shared.userByEmail("jefe@example.com").role, "cliente");
});

test("ADMIN_FORCE: recupera el acceso de una cuenta existente", async () => {
  const { openDb, repo: mkRepo } = require("../server/db");
  const shared = mkRepo(openDb(":memory:"));
  shared.userInsert({ name: "Dueño", phone: "50680000001", email: "jefe@example.com", pass_hash: "x" });
  const mk = (env) => createApp({ repo: shared, config, clock, mailer: { enabled: false, send() {} },
    env: { ADMIN_EMAIL: "jefe@example.com", ADMIN_PASSWORD: "nueva-clave-99", ...env } });
  mk({});
  assert.equal(shared.userByEmail("jefe@example.com").role, "cliente"); // sin ADMIN_FORCE no cambia
  mk({ ADMIN_FORCE: "1" });
  const u = shared.userByEmail("jefe@example.com");
  assert.equal(u.role, "admin");
  assert.ok(require("../server/auth").verifyPassword("nueva-clave-99", u.pass_hash));
});

test("límite de intentos de inicio de sesión", async (t) => {
  const { browser } = await setup(t, { LOGIN_RATE_LIMIT: "5" });
  const c = browser();
  let last;
  for (let i = 0; i < 6; i++) last = await c("POST", "/api/auth/login", { login: "jefe@example.com", password: "mala" + i });
  assert.equal(last.status, 429);
});

test("equipo: dar y quitar acceso al panel", async (t) => {
  const { user, admin, browser } = await setup(t);
  const adm = await admin();
  const ana = await user({ name: "Ana Salón", phone: "87776655", email: "ana@example.com" });
  assert.equal((await ana("GET", "/api/admin/team")).status, 403);

  assert.equal((await adm("POST", "/api/admin/team", { login: "nadie@example.com" })).status, 404);
  const r = await adm("POST", "/api/admin/team", { login: "8777 6655" });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.admins.map((a) => a.email).sort(), ["ana@example.com", "jefe@example.com"]);
  assert.equal((await adm("POST", "/api/admin/team", { login: "ana@example.com" })).status, 409);
  assert.equal((await ana("GET", "/api/admin/summary")).status, 200); // ya entra al panel

  // No puede quitarse el acceso a sí mismo
  const me = (await adm("GET", "/api/me")).body.user;
  assert.equal((await adm("DELETE", `/api/admin/team/${me.id}`)).status, 409);
  // Quitarle el acceso a Ana cierra sus sesiones
  const del = await adm("DELETE", `/api/admin/team/${ana.user.id}`);
  assert.deepEqual(del.body.admins.map((a) => a.email), ["jefe@example.com"]);
  assert.equal((await ana("GET", "/api/admin/summary")).status, 401);
  const again = browser();
  await again("POST", "/api/auth/login", { login: "ana@example.com", password: "secreto123" });
  assert.equal((await again("GET", "/api/admin/summary")).status, 403);
});

/* ---------------- Servicios administrables ---------------- */

test("servicios: crear, editar duración y precio, ocultar, ordenar, borrar", async (t) => {
  const { call, user, admin } = await setup(t);
  const adm = await admin();
  assert.equal((await call("GET", "/api/admin/services")).status, 401);

  // Crear
  const nuevo = await adm("POST", "/api/admin/services",
    { category: "barberia", name: "Diseño de cejas", minutes: 20, price: 3000, description: "Perfilado a navaja", popular: true });
  assert.equal(nuevo.status, 201);
  assert.equal(nuevo.body.id, "diseno-de-cejas");
  let cfg = (await call("GET", "/api/config")).body;
  assert.ok(cfg.services.some((s) => s.id === "diseno-de-cejas" && s.min === 20 && s.price === 3000 && s.popular));

  // Validaciones
  assert.equal((await adm("POST", "/api/admin/services", { category: "barberia", name: "X", minutes: 7 })).status, 400);
  assert.equal((await adm("POST", "/api/admin/services", { category: "nope", name: "Algo", minutes: 30 })).status, 400);
  assert.equal((await adm("POST", "/api/admin/services", { category: "barberia", name: "Algo", minutes: 30, price: -5 })).status, 400);

  // Cambiar la duración del corte: la disponibilidad usa la nueva duración
  await adm("PUT", "/api/admin/services/corte", { category: "barberia", name: "Corte caballero", minutes: 30, price: 10000, description: "" });
  const a = (await call("GET", "/api/availability?services=corte&from=2026-11-10&days=1")).body;
  assert.equal(a.minutes, 30);
  assert.equal(a.days[0].slots.at(-1), 1140 - 30);

  // Una cita guarda la duración y el precio de ese momento
  const c = await user();
  const b = (await c("POST", "/api/bookings", booking())).body;
  assert.equal(b.minutes, 30);
  assert.equal(b.total, 10000);
  await adm("PUT", "/api/admin/services/corte", { category: "barberia", name: "Corte caballero", minutes: 60, price: 12000 });
  assert.equal((await c("GET", "/api/me/bookings")).body.bookings[0].total, 10000);

  // No se puede borrar un servicio con citas, pero sí ocultarlo
  assert.equal((await adm("DELETE", "/api/admin/services/corte")).status, 409);
  await adm("PUT", "/api/admin/services/corte", { category: "barberia", name: "Corte caballero", minutes: 60, price: 12000, active: false });
  cfg = (await call("GET", "/api/config")).body;
  assert.ok(!cfg.services.some((s) => s.id === "corte"));
  assert.deepEqual(cfg.retired, [{ id: "corte", name: "Corte caballero" }]);
  assert.equal((await c("POST", "/api/bookings", booking({ start: 780 }))).status, 400); // ya no se puede reservar

  // Borrar uno sin citas
  assert.equal((await adm("DELETE", "/api/admin/services/diseno-de-cejas")).status, 200);

  // Ordenar
  const all = (await adm("GET", "/api/admin/services")).body.services.map((s) => s.id);
  const reversed = [...all].reverse();
  const o = await adm("PUT", "/api/admin/services-order", { ids: reversed });
  assert.deepEqual(o.body.services.map((s) => s.id), reversed);
  assert.equal((await adm("PUT", "/api/admin/services-order", { ids: reversed.slice(1) })).status, 400);
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
  // Los archivos se revalidan siempre (sin versiones viejas en caché) y responden 304 si no cambiaron
  const css = await fetch(base + "/css/styles.css");
  assert.equal(css.headers.get("cache-control"), "no-cache");
  const again = await fetch(base + "/css/styles.css", { headers: { "if-none-match": css.headers.get("etag") } });
  assert.equal(again.status, 304);
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

  const adm = await admin();
  const p = await adm("PATCH", `/api/admin/bookings/${r.id}`, { status: "confirmada" });
  assert.equal(p.body.emailed, true);
  await tick();
  assert.equal(mails.length, 2);
  assert.match(mails[1].subject, /confirmada/);
  assert.match(mails[1].html, /Víctor Aguilar/);
  assert.match(mails[1].html, /Martes, 10 de noviembre de 2026/);
  const icsText = Buffer.from(mails[1].attachments[0].content, "base64").toString();
  assert.match(icsText, /DTSTART:20261110T160000Z/);
  assert.match(icsText, /DTEND:20261110T165000Z/);

  assert.equal((await adm("PATCH", `/api/admin/bookings/${r.id}`, { status: "confirmada" })).body.emailed, false);

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
  const adm = await admin();
  const mk = async (day, start) => (await adm("POST", "/api/admin/bookings",
    { services: ["corte"], day, start, name: "Ana Mora", email: "ana@example.com" })).body;
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
  const adm = await admin();
  const avail = async (day) => (await call("GET", `/api/availability?services=corte&from=${day}&days=1`)).body.days[0];

  assert.equal((await avail("2026-11-15")).open, false);
  let r = await adm("PUT", "/api/admin/schedule/days", { category: "barberia", days: ["2026-11-15"], ranges: [[600, 780]] });
  assert.equal(r.status, 200);
  const sun = await avail("2026-11-15");
  assert.equal(sun.open, true);
  assert.equal(sun.slots[0], 600);
  assert.equal(sun.slots.at(-1), 720);

  const c = await user();
  const b = (await c("POST", "/api/bookings", booking())).body;
  r = await adm("PUT", "/api/admin/schedule/days", { category: "barberia", days: ["2026-11-10", "2026-11-11"], ranges: [] });
  assert.equal(r.body.outside.length, 1);
  assert.equal(r.body.outside[0].id, b.id);
  assert.equal((await avail("2026-11-11")).open, false);

  const salon = (await call("GET", "/api/availability?services=color&from=2026-11-11&days=1")).body.days[0];
  assert.equal(salon.open, true);

  await adm("PUT", "/api/admin/schedule/days", { category: "barberia", days: ["2026-11-11"], ranges: null });
  assert.equal((await avail("2026-11-11")).open, true);

  const sch = (await adm("GET", "/api/admin/schedule?category=barberia&from=2026-11-09&to=2026-11-15")).body;
  assert.equal(sch.days.length, 7);
  assert.deepEqual(sch.days.find((d) => d.day === "2026-11-15"), { day: "2026-11-15", ranges: [[600, 780]], special: true, bookings: 0 });
  assert.equal(sch.days.find((d) => d.day === "2026-11-10").bookings, 1);
});

test("horario semanal: solo días habilitados", async (t) => {
  const { call, admin } = await setup(t);
  const adm = await admin();
  const week = { 0: [], 1: [], 2: [], 3: [], 4: [[540, 720], [840, 1080]], 5: [], 6: [] };
  assert.equal((await adm("PUT", "/api/admin/schedule/week", { category: "barberia", week })).status, 200);
  const days = (await call("GET", "/api/availability?services=corte&from=2026-11-09&days=7")).body.days;
  assert.deepEqual(days.filter((d) => d.open).map((d) => d.day), ["2026-11-12"]);
  const thu = days.find((d) => d.day === "2026-11-12").slots;
  assert.ok(!thu.includes(720) && thu.includes(840));

  assert.equal((await adm("PUT", "/api/admin/schedule/week", { category: "barberia", week: { ...week, 1: [[600, 500]] } })).status, 400);
  assert.equal((await adm("PUT", "/api/admin/schedule/days", { category: "nope", days: ["2026-11-12"], ranges: [] })).status, 400);
  assert.equal((await call("PUT", "/api/admin/schedule/week", { category: "barberia", week })).status, 401);
});

/* ---------------- Fase 1: privacidad, cancelación, origen ---------------- */

test("registro exige aceptar la privacidad y guarda de dónde viene el cliente", async (t) => {
  const { browser, admin } = await setup(t);
  const c = browser();
  const base = { name: "Rosa Vargas", phone: "86001122", email: "rosa@example.com", password: "secreto123" };
  const no = await c("POST", "/api/auth/register", base);
  assert.equal(no.status, 400);
  assert.match(no.body.error, /privacidad/);
  assert.equal((await c("POST", "/api/auth/register", { ...base, acceptPrivacy: "si" })).status, 400);
  assert.equal((await c("POST", "/api/auth/register", { ...base, acceptPrivacy: true, source: "instagram" })).status, 201);
  const d = browser();
  await d("POST", "/api/auth/register", { name: "Luis Solano", phone: "86001133", email: "luis@example.com", password: "secreto123", acceptPrivacy: true, source: "inventado" });

  const adm = await admin();
  const s = (await adm("GET", "/api/admin/sources")).body;
  assert.equal(s.total, 2);
  assert.deepEqual(s.sources.map((x) => [x.label, x.count]).sort(), [["Instagram", 1], ["Sin respuesta", 1]]);
  assert.equal((await c("GET", "/api/admin/sources")).status, 403);
});

test("plazo de cancelación configurable desde el panel", async (t) => {
  // Lunes 9 de noviembre, 8:00 a.m.
  const { call, user, admin } = await setup(t);
  const adm = await admin();
  assert.equal((await call("GET", "/api/config")).body.cancelHours, 2); // valor inicial

  const c = await user();
  const hoy = (await c("POST", "/api/bookings", booking({ day: "2026-11-09", start: 570 }))).body; // 9:30 → en 1.5 h
  const manana = (await c("POST", "/api/bookings", booking({ day: "2026-11-10", start: 600 }))).body;

  const x = await c("POST", `/api/bookings/${hoy.id}/cancel`);
  assert.equal(x.status, 409);
  assert.match(x.body.error, /hasta 2 horas antes/);
  assert.equal((await c("POST", `/api/bookings/${manana.id}/cancel`)).status, 200);

  // El barbero cambia el plazo a 1 hora: ahora sí se puede
  assert.equal((await adm("PUT", "/api/admin/settings", { cancelHours: 99 })).status, 400);
  assert.equal((await adm("PUT", "/api/admin/settings", { cancelHours: 1 })).body.cancelHours, 1);
  assert.equal((await call("GET", "/api/config")).body.cancelHours, 1);
  assert.equal((await c("POST", `/api/bookings/${hoy.id}/cancel`)).status, 200);
  assert.equal((await c("PUT", "/api/admin/settings", { cancelHours: 0 })).status, 403);
});
