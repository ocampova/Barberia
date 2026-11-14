"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const zlib = require("node:zlib");
const { DatabaseSync } = require("node:sqlite");
const { negocios } = require("../server/negocios");
const { createPlatform } = require("../server/platform");

const clock = () => new Date("2026-11-09T14:00:00Z");
const quiet = { log() {}, warn() {}, error() {} };
const ENV = { PUBLIC_URL: "https://victoraguilar.elcorte.app", ADMIN_EMAIL: "allan@example.com", ADMIN_PASSWORD: "clave-del-dueno",
  ADMIN_NAME: "Allan", REGISTER_RATE_LIMIT: "100", LOGIN_RATE_LIMIT: "100" };
const P = "plataforma.elcorte.app", S = "seimar.elcorte.app", V = "victoraguilar.elcorte.app";

async function setup(t, env = ENV) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-"));
  const p = createPlatform({ negocios, dataDir: dir, env, clock, mailer: { enabled: false, send() {} }, log: quiet });
  const server = http.createServer(p.handler);
  await new Promise((ok) => server.listen(0, ok));
  t.after(() => { server.close(); p.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const port = server.address().port;
  // Cada "navegador" guarda cookies por host
  const browser = () => {
    const jar = {};
    return (host, method, p_, body, extraCookie) => new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const cookie = [jar[host], extraCookie].filter(Boolean).join("; ");
      const req = http.request({ host: "127.0.0.1", port, method, path: p_, headers: { host, "content-type": "application/json",
        ...(cookie ? { cookie } : {}), ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
        let buf = ""; const parts = []; res.on("data", (c) => { parts.push(c); buf += c; });
        res.on("end", () => {
          for (const c of res.headers["set-cookie"] || []) {
            const [kv] = c.split(";"); const [k] = kv.split("=");
            const others = (jar[host] || "").split("; ").filter((x) => x && !x.startsWith(k + "="));
            jar[host] = (kv.endsWith("=") ? others : [...others, kv]).join("; ");
          }
          let json = null; try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, body: json, text: buf, raw: Buffer.concat(parts), headers: res.headers });
        });
      });
      req.on("error", reject); if (data) req.write(data); req.end();
    });
  };
  return { p, browser };
}

test("plataforma: inicio de sesión y tablero de todos los negocios", async (t) => {
  const { browser } = await setup(t);
  const me = browser();
  assert.equal((await me(P, "GET", "/api/plataforma/negocios")).status, 401);
  assert.match((await me(P, "GET", "/")).text, /<title>Plataforma · El Corte<\/title>/);
  assert.equal((await me(P, "POST", "/api/plataforma/login", { email: "allan@example.com", password: "mala" })).status, 401);
  const ok = await me(P, "POST", "/api/plataforma/login", { email: "ALLAN@example.com", password: "clave-del-dueno" });
  assert.equal(ok.status, 200);
  assert.match(ok.headers["set-cookie"][0], /SameSite=Strict/);

  // Una clienta reserva en Seimar → aparece en el tablero
  const rosa = browser();
  await rosa(S, "POST", "/api/auth/register", { name: "Rosa Vargas", phone: "86001122", email: "rosa@example.com", password: "secreto123", acceptPrivacy: true });
  await browser()(S, "POST", "/api/auth/register", { name: "Ana Mora", phone: "86001133", email: "ana@example.com", password: "secreto123", acceptPrivacy: true, source: "instagram" });
  const bk = await rosa(S, "POST", "/api/bookings", { services: ["color"], day: "2026-11-10", start: 600 });
  assert.equal(bk.status, 201, JSON.stringify(bk.body));

  const list = (await me(P, "GET", "/api/plataforma/negocios")).body.negocios;
  assert.deepEqual(list.map((n) => n.slug), ["victoraguilar", "seimar"]);
  const s = list.find((n) => n.slug === "seimar");
  assert.deepEqual(s.stats.sources.d30, [{ label: "Instagram", count: 1 }, { label: "Sin respuesta", count: 1 }]);
  assert.deepEqual(list.find((n) => n.slug === "victoraguilar").stats.sources.all, []);
  assert.equal(s.url, "https://seimar.elcorte.app");
  assert.equal(s.stats.clients, 2, "clientes");
  assert.equal(s.stats.pending, 1, "pendientes");
  assert.deepEqual(s.stats.team, []); // el dueño de la plataforma no es parte del equipo del negocio
  // La plataforma no se confunde con un negocio
  assert.equal((await me(P, "GET", "/api/config")).status, 404);
  assert.equal((await me(S, "GET", "/plataforma.html")).status, 404);
});

test("entrar al panel de un negocio: pase de un solo uso, válido solo para ese negocio", async (t) => {
  const { browser } = await setup(t);
  const me = browser();
  await me(P, "POST", "/api/plataforma/login", { email: "allan@example.com", password: "clave-del-dueno" });
  assert.equal((await me(S, "GET", "/api/admin/summary")).status, 401);

  const { url } = (await me(P, "POST", "/api/plataforma/negocios/seimar/entrar")).body;
  assert.match(url, /^https:\/\/seimar\.elcorte\.app\/__plataforma\?t=[\w-]+$/);
  const pathQs = new URL(url).pathname + new URL(url).search;
  // Un pase de Seimar no sirve en la barbería
  assert.equal((await me(V, "GET", pathQs)).status, 403);
  // …y ese intento lo consumió: hay que pedir otro
  const { url: url2 } = (await me(P, "POST", "/api/plataforma/negocios/seimar/entrar")).body;
  const pq2 = new URL(url2).pathname + new URL(url2).search;
  const go = await me(S, "GET", pq2);
  assert.equal(go.status, 302);
  assert.equal(go.headers.location, "/admin");
  assert.match(go.headers["set-cookie"][0], /^va_plat=.*HttpOnly; SameSite=Lax; Max-Age=28800/);
  assert.equal((await me(S, "GET", pq2)).status, 403); // ya se usó

  assert.equal((await me(S, "GET", "/api/admin/summary")).status, 200);
  assert.deepEqual((await me(S, "GET", "/api/me")).body.platform, { name: "Allan", email: "allan@example.com" });
  // La cookie de Seimar no abre la barbería aunque se envíe allá
  const stolen = go.headers["set-cookie"][0].split(";")[0];
  assert.equal((await browser()(V, "GET", "/api/admin/summary", null, stolen)).status, 401);
  // Una cookie alterada no sirve
  assert.equal((await browser()(S, "GET", "/api/admin/summary", null, stolen.slice(0, -3) + "abc")).status, 401);
  // Cerrar sesión en el negocio quita también la entrada de plataforma
  await me(S, "POST", "/api/auth/logout");
  assert.equal((await me(S, "GET", "/api/admin/summary")).status, 401);

  const log = (await me(P, "GET", "/api/plataforma/registro")).body.entries;
  assert.equal(log.filter((l) => l.action === "entrar" && l.negocio === "seimar").length, 1);
  assert.ok(log.some((l) => l.action === "login" && l.who === "Allan"));
});

test("equipo de cada negocio administrado desde la plataforma", async (t) => {
  const { browser } = await setup(t);
  const me = browser();
  await me(P, "POST", "/api/plataforma/login", { email: "allan@example.com", password: "clave-del-dueno" });
  const seidy = browser();
  await seidy(S, "POST", "/api/auth/register", { name: "Seidy Matamoros", phone: "87001234", email: "seidy@example.com", password: "clave-de-seidy", acceptPrivacy: true });
  assert.equal((await seidy(S, "GET", "/api/admin/summary")).status, 403);

  // No se puede dar acceso en un negocio donde la persona no tiene cuenta
  assert.equal((await me(P, "POST", "/api/plataforma/negocios/victoraguilar/equipo", { login: "seidy@example.com" })).status, 404);
  const add = await me(P, "POST", "/api/plataforma/negocios/seimar/equipo", { login: "8700 1234" });
  assert.equal(add.status, 201);
  assert.deepEqual(add.body.team.map((a) => a.email), ["seidy@example.com"]);
  assert.equal((await seidy(S, "GET", "/api/admin/summary")).status, 200);
  // Seidy no ve la plataforma
  assert.equal((await seidy(P, "GET", "/api/plataforma/negocios")).status, 401);

  const id = add.body.team[0].id;
  assert.equal((await me(P, "DELETE", `/api/plataforma/negocios/seimar/equipo/${id}`)).status, 200);
  assert.equal((await seidy(S, "GET", "/api/admin/summary")).status, 401); // se cerraron sus sesiones
  assert.equal((await me(P, "POST", "/api/plataforma/negocios/nadie/equipo", { login: "x@example.com" })).status, 404);
});

test("contraseña de la plataforma: exige la actual y cierra otras sesiones", async (t) => {
  const { browser } = await setup(t);
  const a = browser(), b = browser();
  for (const x of [a, b]) await x(P, "POST", "/api/plataforma/login", { email: "allan@example.com", password: "clave-del-dueno" });
  assert.equal((await a(P, "POST", "/api/plataforma/password", { current: "mala", password: "otra-clave-larga" })).status, 400);
  assert.equal((await a(P, "POST", "/api/plataforma/password", { current: "clave-del-dueno", password: "corta" })).status, 400);
  assert.equal((await a(P, "POST", "/api/plataforma/password", { current: "clave-del-dueno", password: "otra-clave-larga" })).status, 200);
  assert.equal((await a(P, "GET", "/api/plataforma/negocios")).status, 200);
  assert.equal((await b(P, "GET", "/api/plataforma/negocios")).status, 401);
  assert.equal((await browser()(P, "POST", "/api/plataforma/login", { email: "allan@example.com", password: "otra-clave-larga" })).status, 200);
});

test("PLATFORM_HOST: la plataforma también responde en otra dirección (p. ej. la de Railway)", async (t) => {
  const R = "barberia-production-b09e4724.up.railway.app";
  const { browser } = await setup(t, { ...ENV, PLATFORM_HOST: `https://${R}/` });
  const me = browser();
  assert.match((await me(R, "GET", "/")).text, /<title>Plataforma · El Corte<\/title>/);
  assert.equal((await me(R, "POST", "/api/plataforma/login", { email: "allan@example.com", password: "clave-del-dueno" })).status, 200);
  const { url } = (await me(R, "POST", "/api/plataforma/negocios/seimar/entrar")).body;
  assert.match(url, /^https:\/\/seimar\.elcorte\.app\/__plataforma/);
  // Los negocios siguen en sus direcciones
  assert.equal((await me(V, "GET", "/api/config")).body.slug, "victoraguilar");
});

test("copias de seguridad de cada negocio desde la plataforma", async (t) => {
  const { browser } = await setup(t);
  const me = browser();
  assert.equal((await me(P, "GET", "/api/plataforma/negocios/seimar/copia/descargar")).status, 401);
  await me(P, "POST", "/api/plataforma/login", { email: "allan@example.com", password: "clave-del-dueno" });
  const rosa = browser();
  await rosa(S, "POST", "/api/auth/register", { name: "Rosa Vargas", phone: "86001122", email: "rosa@example.com", password: "secreto123", acceptPrivacy: true });

  const made = await me(P, "POST", "/api/plataforma/negocios/seimar/copia");
  assert.equal(made.status, 201);
  const s = (await me(P, "GET", "/api/plataforma/negocios")).body.negocios.find((n) => n.slug === "seimar");
  assert.ok(s.stats.lastBackup.at);

  const dl = await me(P, "GET", "/api/plataforma/negocios/seimar/copia/descargar");
  assert.equal(dl.status, 200);
  assert.equal(dl.headers["content-type"], "application/gzip");
  assert.match(dl.headers["content-disposition"], /attachment; filename="seimar-.*\.db\.gz"/);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dl-")), "seimar.db");
  fs.writeFileSync(file, zlib.gunzipSync(dl.raw));
  const copy = new DatabaseSync(file);
  assert.deepEqual(copy.prepare("SELECT email FROM users").all().map((u) => u.email), ["rosa@example.com"]);
  copy.close();
  // El panel del negocio ya no tiene copias
  assert.equal((await me(S, "GET", "/api/admin/backups")).status, 404);
  const log = (await me(P, "GET", "/api/plataforma/registro")).body.entries;
  assert.ok(log.some((l) => l.action === "descarga" && l.negocio === "seimar"));
});

test("datos de contacto de cada negocio: se editan en la plataforma y se aplican al instante", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mails = [];
  const start = async () => {
    const p = createPlatform({ negocios, dataDir: dir, env: ENV, clock, log: quiet,
      mailer: { enabled: true, send: async (m) => { mails.push(m); return {}; } } });
    const server = http.createServer(p.handler);
    await new Promise((ok) => server.listen(0, ok));
    const port = server.address().port;
    const jar = {};
    const call = (host, method, url, body) => new Promise((ok) => {
      const data = body ? JSON.stringify(body) : null;
      const r = http.request({ host: "127.0.0.1", port, method, path: url, headers: { host, "content-type": "application/json",
        ...(jar[host] ? { cookie: jar[host] } : {}), ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
        let b = ""; res.on("data", (c) => (b += c));
        res.on("end", () => { const sc = res.headers["set-cookie"]; if (sc) jar[host] = sc[0].split(";")[0];
          let j = null; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, body: j, text: b }); });
      });
      if (data) r.write(data); r.end();
    });
    return { call, stop: () => { server.close(); p.close(); } };
  };

  let srv = await start();
  t.after(() => srv.stop());
  const { call } = srv;
  assert.equal((await call(P, "PUT", "/api/plataforma/negocios/seimar/contacto", { phone: "88887777" })).status, 401);
  await call(P, "POST", "/api/plataforma/login", { email: "allan@example.com", password: "clave-del-dueno" });
  // Al inicio, los datos del archivo de Seimar (los de su página de Facebook)
  const list0 = (await call(P, "GET", "/api/plataforma/negocios")).body.negocios;
  assert.deepEqual(list0.find((n) => n.slug === "seimar").contact,
    { phone: "24442141", whatsapp: "50624442141", replyTo: "seimarsaloncr@gmail.com", instagram: "", facebook: "seimarsalon" });

  // Validaciones
  for (const bad of [{ phone: "123" }, { phone: "88887777", whatsapp: "12" }, { phone: "88887777", replyTo: "no-es-correo" }])
    assert.equal((await call(P, "PUT", "/api/plataforma/negocios/seimar/contacto", bad)).status, 400, JSON.stringify(bad));
  assert.equal((await call(P, "PUT", "/api/plataforma/negocios/nadie/contacto", { phone: "88887777" })).status, 404);

  const ok = await call(P, "PUT", "/api/plataforma/negocios/seimar/contacto", { phone: "8888 7777", whatsapp: "", replyTo: " Seidy@Example.com " });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.contact, { phone: "88887777", whatsapp: "50688887777", replyTo: "seidy@example.com", instagram: "", facebook: "seimarsalon" });

  // La app, las páginas y los correos de Seimar lo usan de inmediato; la barbería no cambia
  const cfg = (await call(S, "GET", "/api/config")).body;
  assert.deepEqual([cfg.phone, cfg.whatsapp], ["88887777", "50688887777"]);
  assert.ok(!("replyTo" in cfg), "el correo de respuesta no se publica en la app");
  assert.match((await call(S, "GET", "/privacidad.html")).text, /wa\.me\/50688887777">8888 7777</);
  assert.notEqual((await call(V, "GET", "/api/config")).body.phone, "88887777");
  await call(S, "POST", "/api/auth/register", { name: "Rosa Vargas", phone: "86001122", email: "rosa@example.com", password: "secreto123", acceptPrivacy: true });
  await call(S, "POST", "/api/bookings", { services: ["color"], day: "2026-11-10", start: 600 });
  await new Promise((r) => setTimeout(r, 20));
  const m = mails.at(-1);
  assert.equal(m.replyTo, "seidy@example.com");
  assert.match(m.html, /wa\.me\/50688887777/);
  assert.match(m.html, /8888 7777/);

  // Queda en el registro
  const log = (await call(P, "GET", "/api/plataforma/registro")).body.entries;
  assert.ok(log.some((l) => l.action === "contacto" && l.negocio === "seimar" && /correo para respuestas: seidy@example.com/.test(l.detail)));

  // Sobrevive a un reinicio del servidor
  srv.stop();
  srv = await start();
  assert.equal((await srv.call(S, "GET", "/api/config")).body.phone, "88887777");
});


test("cada negocio mantiene sus datos de contacto y redes desde su panel", async (t) => {
  const { browser, p } = await setup(t);
  const me = browser();
  await me(P, "POST", "/api/plataforma/login", { email: "allan@example.com", password: "clave-del-dueno" });
  // Seidy: cuenta en Seimar con acceso al panel
  const seidy = browser();
  await seidy(S, "POST", "/api/auth/register", { name: "Seidy Matamoros", phone: "87001234", email: "seidy@example.com", password: "clave-de-seidy", acceptPrivacy: true });
  const cliente = browser();
  await cliente(S, "POST", "/api/auth/register", { name: "Rosa Vargas", phone: "86001122", email: "rosa@example.com", password: "secreto123", acceptPrivacy: true });
  assert.equal((await seidy(S, "PUT", "/api/admin/contact", { phone: "88887777" })).status, 403);
  await me(P, "POST", "/api/plataforma/negocios/seimar/equipo", { login: "seidy@example.com" });

  assert.equal((await cliente(S, "PUT", "/api/admin/contact", { phone: "88887777" })).status, 403);
  for (const bad of [{ instagram: "no válido!" }, { facebook: "x y z" }, { replyTo: "nope" }])
    assert.equal((await seidy(S, "PUT", "/api/admin/contact", bad)).status, 400, JSON.stringify(bad));

  const r = await seidy(S, "PUT", "/api/admin/contact", {
    phone: "8888-7777", whatsapp: "", instagram: "https://www.instagram.com/seimar.salon/?hl=es",
    facebook: "https://m.facebook.com/SeimarSalon/", replyTo: "Seidy@Example.com" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.contact, { phone: "88887777", whatsapp: "50688887777", replyTo: "seidy@example.com",
    instagram: "seimar.salon", facebook: "SeimarSalon" });
  // Cambiar solo un campo mantiene los demás
  const r2 = await seidy(S, "PUT", "/api/admin/contact", { instagram: "@seimarsalon" });
  assert.deepEqual([r2.body.contact.instagram, r2.body.contact.facebook, r2.body.contact.phone], ["seimarsalon", "SeimarSalon", "88887777"]);
  assert.equal((await seidy(S, "PUT", "/api/admin/contact", { facebook: "https://facebook.com/profile.php?id=1234567" })).body.contact.facebook, "profile.php?id=1234567");

  // La app pública muestra las redes; el correo de respuestas no se publica
  const cfg = (await cliente(S, "GET", "/api/config")).body;
  assert.deepEqual([cfg.instagram, cfg.facebook, cfg.phone], ["seimarsalon", "profile.php?id=1234567", "88887777"]);
  assert.ok(!("replyTo" in cfg));
  // La barbería no cambia
  assert.deepEqual([(await me(V, "GET", "/api/config")).body.instagram], [""]);
  // La plataforma lo ve y queda en su registro, con el nombre de quien lo cambió
  const sm = (await me(P, "GET", "/api/plataforma/negocios")).body.negocios.find((n) => n.slug === "seimar");
  assert.equal(sm.contact.instagram, "seimarsalon");
  const log = (await me(P, "GET", "/api/plataforma/registro")).body.entries;
  assert.ok(log.some((l) => l.action === "contacto-panel" && l.negocio === "seimar" && /^Seidy Matamoros · .*Instagram: seimarsalon/.test(l.detail)));
  assert.ok(p);
});
