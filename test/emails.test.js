"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../server/config");
const { render, ics } = require("../server/emails");

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
