"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const { openDb, repo } = require("../server/db");
const { createBackups, signV4, sha256hex } = require("../server/backup");
const { createApp } = require("../server/app");
const config = require("../server/config");

const tmpDir = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "bk-")); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test("firma AWS SigV4: vector oficial get-vanilla", () => {
  const h = signV4({ method: "GET", url: "https://example.amazonaws.com/", payloadHash: sha256hex(""), region: "us-east-1",
    service: "service", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    date: new Date("2015-08-30T12:36:00Z") });
  assert.equal(h.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, " +
    "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
});

test("la copia es una base de datos válida y restaurable", (t) => {
  const dir = tmpDir(t);
  const db = openDb(path.join(dir, "app.db"));
  const r = repo(db);
  r.userInsert({ name: "Ana", phone: "50687776655", email: "ana@example.com", pass_hash: "x" });
  const bk = createBackups({ db, dir: path.join(dir, "backups"), env: {}, log: { log() {} } });
  const restored = path.join(dir, "restaurada.db");
  fs.writeFileSync(restored, zlib.gunzipSync(bk.snapshot()));
  const copy = new DatabaseSync(restored);
  assert.equal(copy.prepare("SELECT email FROM users").get().email, "ana@example.com");
  copy.close();
});

test("guarda las últimas N copias y sube cada una al almacenamiento externo", async (t) => {
  const dir = tmpDir(t);
  const db = openDb(path.join(dir, "app.db"));
  const puts = [];
  const fakeFetch = async (url, opts) => { puts.push({ url, opts }); return { ok: true, text: async () => "" }; };
  const bk = createBackups({ db, dir: path.join(dir, "backups"), log: { log() {} }, fetchImpl: fakeFetch,
    env: { BACKUP_KEEP: "2", BACKUP_S3_ENDPOINT: "https://cuenta.r2.cloudflarestorage.com/", BACKUP_S3_BUCKET: "copias",
      BACKUP_S3_ACCESS_KEY_ID: "AKIA", BACKUP_S3_SECRET_ACCESS_KEY: "secreto" } });
  assert.equal(bk.offsite, true);
  for (let i = 0; i < 3; i++) { await bk.run("prueba"); await new Promise((ok) => setTimeout(ok, 5)); }
  assert.equal(bk.list().length, 2);
  assert.equal(puts.length, 3);
  assert.match(puts[0].url, /^https:\/\/cuenta\.r2\.cloudflarestorage\.com\/copias\/backups\/barberia-.*\.db\.gz$/);
  assert.equal(puts[0].opts.method, "PUT");
  assert.match(puts[0].opts.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIA\/\d{8}\/auto\/s3\/aws4_request/);
  assert.equal(puts[0].opts.headers["x-amz-content-sha256"], sha256hex(puts[0].opts.body));
});

test("si el almacenamiento externo falla, el error se informa (y la copia local queda)", async (t) => {
  const dir = tmpDir(t);
  const db = openDb(path.join(dir, "app.db"));
  const bk = createBackups({ db, dir: path.join(dir, "backups"), log: { log() {} },
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => "AccessDenied" }),
    env: { BACKUP_S3_ENDPOINT: "https://x", BACKUP_S3_BUCKET: "b", BACKUP_S3_ACCESS_KEY_ID: "a", BACKUP_S3_SECRET_ACCESS_KEY: "s" } });
  await assert.rejects(bk.run(), /403/);
  assert.equal(bk.list().length, 1);
});

test("panel: hacer y descargar copias solo con cuenta de administrador", async (t) => {
  const dir = tmpDir(t);
  const db = openDb(path.join(dir, "app.db"));
  const backups = createBackups({ db, dir: path.join(dir, "backups"), env: {}, log: { log() {} } });
  const handler = createApp({ repo: repo(db), config, backups, clock: () => new Date("2026-11-09T14:00:00Z"),
    env: { ADMIN_EMAIL: "jefe@example.com", ADMIN_PASSWORD: "clave-del-jefe" }, mailer: { enabled: false, send() {} } });
  const server = http.createServer(handler);
  await new Promise((ok) => server.listen(0, ok));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(base + "/api/admin/backups/download")).status, 401);
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "jefe@example.com", password: "clave-del-jefe" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const H = { cookie, "content-type": "application/json" };

  const made = await fetch(base + "/api/admin/backups", { method: "POST", headers: H });
  assert.equal(made.status, 201);
  const info = await (await fetch(base + "/api/admin/backups", { headers: H })).json();
  assert.equal(info.enabled, true);
  assert.equal(info.backups.length, 1);
  assert.ok(info.last.at);

  const dl = await fetch(base + "/api/admin/backups/download", { headers: H });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "application/gzip");
  assert.match(dl.headers.get("content-disposition"), /attachment; filename="barberia-.*\.db\.gz"/);
  const restored = path.join(dir, "bajada.db");
  fs.writeFileSync(restored, zlib.gunzipSync(Buffer.from(await dl.arrayBuffer())));
  const copy = new DatabaseSync(restored);
  assert.equal(copy.prepare("SELECT email FROM users WHERE role = 'admin'").get().email, "jefe@example.com");
  copy.close();
});
