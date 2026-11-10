"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { freeSlots } = require("../server/availability");
const config = require("../server/config");

// 2026-11-10 es martes: abre 9:00 a 19:00.
const DAY = "2026-11-10";
const base = { config, category: "barberia", day: DAY, bookings: [], blocks: [], now: { day: "2026-11-09", minutes: 600 } };

test("día libre: horas cada 15 min donde cabe la cita completa", () => {
  const s = freeSlots({ ...base, minutes: 50 });
  assert.equal(s[0], 9 * 60);
  assert.equal(s.at(-1), 19 * 60 - 60); // 18:00 es la última que termina antes del cierre (18:50)
  assert.ok(s.every((m) => m % 15 === 0));
});

test("una cita ocupa su espacio y deja libre el resto", () => {
  const bookings = [{ category: "barberia", start: 600, minutes: 50, status: "confirmada" }];
  const s = freeSlots({ ...base, minutes: 50, bookings });
  assert.ok(!s.includes(600));
  assert.ok(!s.includes(555)); // 9:15 + 50 = 10:05, choca
  assert.ok(s.includes(540)); // 9:00 – 9:50 cabe
  assert.ok(!s.includes(645)); // 10:45 aún choca
  assert.ok(s.includes(660)); // 11:00 libre
});

test("las citas canceladas o rechazadas no ocupan", () => {
  const bookings = [{ category: "barberia", start: 600, minutes: 50, status: "cancelada" },
    { category: "barberia", start: 705, minutes: 50, status: "rechazada" }];
  const s = freeSlots({ ...base, minutes: 50, bookings });
  assert.ok(s.includes(600) && s.includes(705));
});

test("barbería y salón no se bloquean entre sí", () => {
  const bookings = [{ category: "salon", start: 600, minutes: 120, status: "confirmada" }];
  assert.ok(freeSlots({ ...base, minutes: 50, bookings }).includes(600));
});

test("bloqueos: de categoría y de todo el negocio", () => {
  const blocks = [{ category: null, start: 720, end: 780 }];
  const s = freeSlots({ ...base, minutes: 50, blocks });
  assert.ok(!s.includes(720) && !s.includes(690));
  assert.ok(s.includes(780));
  const s2 = freeSlots({ ...base, category: "salon", minutes: 30, blocks: [{ category: "barberia", start: 540, end: 1140 }] });
  assert.ok(s2.length > 0);
});

test("hoy: respeta la anticipación mínima", () => {
  const s = freeSlots({ ...base, minutes: 50, now: { day: DAY, minutes: 10 * 60 + 5 } });
  assert.equal(s[0], 10 * 60 + 45); // 10:05 + 30 min → primera hora de 15 en 15 es 10:45
});

test("domingo cerrado, días pasados y fuera de rango vacíos", () => {
  assert.deepEqual(freeSlots({ ...base, day: "2026-11-15", minutes: 50 }), []);
  assert.deepEqual(freeSlots({ ...base, day: "2026-11-01", minutes: 50 }), []);
  assert.deepEqual(freeSlots({ ...base, day: "2027-01-10", minutes: 50 }), []);
});

test("capacidad 2: se permiten dos citas a la vez", () => {
  const cfg = { ...config, categories: [{ id: "barberia", capacity: 2 }] };
  const one = [{ category: "barberia", start: 600, minutes: 50, status: "pendiente" }];
  assert.ok(freeSlots({ ...base, config: cfg, minutes: 50, bookings: one }).includes(600));
  const two = [...one, { category: "barberia", start: 600, minutes: 50, status: "confirmada" }];
  assert.ok(!freeSlots({ ...base, config: cfg, minutes: 50, bookings: two }).includes(600));
});
