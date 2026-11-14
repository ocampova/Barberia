"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("./fixtures/dos-agendas");
const { render, renderReset, ics } = require("../server/emails");

const b = { id: "abc123", token: "t", category: "barberia", day: "2026-10-02", start: 18 * 60, minutes: 50,
  services: ["corte"], total: 9000, name: "Juan Pérez", email: "j@example.com" };

test("cada tipo de correo se arma con asunto, HTML y texto", () => {
  for (const kind of ["recibida", "confirmada", "recordatorio", "rechazada", "cancelada"]) {
    const m = render(kind, b, config, { link: "https://x.test/?cita=abc123&t=t", siteUrl: "https://x.test" });
    assert.ok(m.subject.length > 5, kind);
    assert.match(m.html, /6:00 p\.m\./);
    assert.match(m.html, /Viernes, 2 de octubre de 2026/);
    assert.match(m.text, /Corte caballero/);
  }
});

test("solo la confirmación lleva la invitación de calendario", () => {
  assert.ok(render("confirmada", b, config).attachments);
  assert.equal(render("recibida", b, config).attachments, undefined);
});

test("el enlace: ver/cancelar en citas activas, reservar de nuevo en rechazadas", () => {
  const opts = { link: "https://x.test/?cita=abc123&t=t", siteUrl: "https://x.test" };
  assert.match(render("confirmada", b, config, opts).html, /Ver o cancelar mi cita/);
  const r = render("rechazada", b, config, opts).html;
  assert.match(r, /Reservar otro horario/);
  assert.ok(!r.includes("cita=abc123"));
});

test(".ics en hora de Costa Rica (UTC-6)", () => {
  const s = ics(b, config, ["Corte caballero"]);
  assert.match(s, /DTSTART:20261003T000000Z/); // 6:00 p.m. del 2 de octubre = 00:00 UTC del 3
  assert.match(s, /SUMMARY:Corte caballero · Víctor Aguilar Barbería/);
  assert.ok(s.includes("\r\n"));
});

test("correo de contraseña: logo y colores del negocio, desde su propia dirección", () => {
  const m = renderReset({ name: "Ana Mora" }, { ...config, theme: { accent: "#c8917c", ink: "#2a1510" } }, "https://seimar.elcorte.app/?reset=abc");
  assert.match(m.html, /<img src="https:\/\/seimar\.elcorte\.app\/img\/negocios\/victoraguilar\/email\.png"/);
  assert.match(m.html, /#c8917c/);
  assert.match(m.subject, /Cambia tu contraseña · /);
});


test("pie del correo: Instagram y Facebook solo si el negocio los tiene", () => {
  const sin = render("confirmada", b, config, { link: "https://x/?citas=1" });
  assert.ok(!/instagram\.com|facebook\.com/.test(sin.html));
  const con = render("confirmada", b, { ...config, instagram: "victoraguilarbarberia", facebook: "VictorAguilarBarberia" }, { link: "https://x/?citas=1" });
  assert.match(con.html, /href="https:\/\/instagram\.com\/victoraguilarbarberia"[^>]*>Instagram @victoraguilarbarberia</);
  assert.match(con.html, /href="https:\/\/www\.facebook\.com\/VictorAguilarBarberia"/);
});

test("correos con la paleta del negocio: fondo claro para Seimar, oscuro por defecto", () => {
  const claro = { ...config, theme: { accent: "#b87a63", ink: "#ffffff", palette: { scheme: "light", bg: "#faf6f1", surface: "#ffffff", line: "#e9dfd5", text: "#3a2a24", muted: "#8a776c" } } };
  const m = render("confirmada", b, claro, { link: "https://x/?citas=1" });
  assert.match(m.html, /<body style="margin:0;padding:0;background:#faf6f1;">/);
  assert.match(m.html, /background:#ffffff;border:1px solid #b87a63/);
  assert.match(m.html, /color:#3a2a24/);
  assert.match(m.html, /content="light"/);
  const r = renderReset({ name: "Ana" }, claro, "https://seimar.elcorte.app/?reset=x");
  assert.match(r.html, /background:#faf6f1/);
  const oscuro = render("confirmada", b, config, { link: "https://x/?citas=1" });
  assert.match(oscuro.html, /background:#0b0a09/);
});

