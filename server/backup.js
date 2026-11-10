"use strict";
// Copias de seguridad de la base de datos SQLite.
//  - snapshot(): copia consistente con VACUUM INTO (segura mientras la app sigue funcionando), comprimida con gzip.
//  - Se guardan las últimas N en el disco (BACKUP_KEEP, 7 por defecto).
//  - Si hay BACKUP_S3_* configurado, se sube también a un almacenamiento compatible con S3
//    (Cloudflare R2, Backblaze B2, AWS S3…), firmando con AWS Signature V4 sin dependencias.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

/**
 * Firma AWS Signature Version 4.
 * Devuelve los encabezados a enviar (incluye Authorization y x-amz-date).
 */
function signV4({ method, url, headers = {}, payloadHash, region, service, accessKeyId, secretAccessKey, date = new Date() }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host: u.host, "x-amz-date": amzDate };
  const names = Object.keys(all).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const canonicalHeaders = names.map((h) => `${h}:${lower[h]}\n`).join("");
  const signedHeaders = names.join(";");
  const encodePath = (p) => p.split("/").map((seg) => encodeURIComponent(decodeURIComponent(seg))).join("/");
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("&");
  const canonicalRequest = [method, encodePath(u.pathname || "/"), query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, day), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function s3Config(env) {
  const { BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY } = env;
  if (!BACKUP_S3_ENDPOINT || !BACKUP_S3_BUCKET || !BACKUP_S3_ACCESS_KEY_ID || !BACKUP_S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: BACKUP_S3_ENDPOINT.replace(/\/+$/, ""),
    bucket: BACKUP_S3_BUCKET,
    region: env.BACKUP_S3_REGION || "auto",
    accessKeyId: BACKUP_S3_ACCESS_KEY_ID,
    secretAccessKey: BACKUP_S3_SECRET_ACCESS_KEY,
    prefix: (env.BACKUP_S3_PREFIX || "backups/").replace(/^\/+/, ""),
  };
}

async function uploadS3(cfg, key, body, fetchImpl = globalThis.fetch) {
  const url = `${cfg.endpoint}/${cfg.bucket}/${key}`;
  const headers = signV4({
    method: "PUT", url, payloadHash: sha256hex(body), region: cfg.region, service: "s3",
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
    headers: { "x-amz-content-sha256": sha256hex(body), "content-type": "application/gzip" },
  });
  delete headers.host; // fetch lo pone solo
  const res = await fetchImpl(url, { method: "PUT", headers, body });
  if (!res.ok) throw new Error(`El almacenamiento respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Copia consistente de la base de datos, comprimida. Devuelve un Buffer gzip. */
function snapshot(db, tmpDir) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `.snapshot-${process.pid}-${Date.now()}.db`);
  try {
    db.prepare("VACUUM INTO ?").run(tmp);
    return zlib.gzipSync(fs.readFileSync(tmp), { level: 9 });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function createBackups({ db, dir, env = process.env, fetchImpl, log = console }) {
  const keep = Math.max(1, Number(env.BACKUP_KEEP || 7));
  const s3 = s3Config(env);

  function prune() {
    const files = fs.readdirSync(dir).filter((f) => /^barberia-.*\.db\.gz$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
  }

  /** Hace una copia: la guarda en el disco y, si hay S3, la sube. */
  async function run(reason = "programada") {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `barberia-${stamp}.db.gz`;
    const gz = snapshot(db, dir);
    fs.writeFileSync(path.join(dir, name), gz);
    prune();
    let uploaded = false;
    if (s3) {
      await uploadS3(s3, s3.prefix + name, gz, fetchImpl);
      uploaded = true;
    }
    log.log(`Copia de seguridad (${reason}): ${name} · ${(gz.length / 1024).toFixed(1)} KB` + (uploaded ? " · subida al almacenamiento externo" : ""));
    return { name, bytes: gz.length, uploaded };
  }

  function list() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => /^barberia-.*\.db\.gz$/.test(f)).sort().reverse()
      .map((f) => ({ name: f, bytes: fs.statSync(path.join(dir, f)).size }));
  }

  return { run, list, snapshot: () => snapshot(db, dir), offsite: Boolean(s3) };
}

module.exports = { createBackups, signV4, snapshot, sha256hex };
