"use strict";
const { addDays } = require("./time");

const ACTIVE = new Set(["pendiente", "confirmada"]);

/**
 * Horas de inicio libres para una cita de `minutes` minutos.
 * ranges:   turnos de trabajo de ese día, [[inicio, fin], ...] en minutos ([] = cerrado).
 * bookings: [{category, start, minutes, status}] del mismo día.
 * blocks:   [{category|null, start, end}] del mismo día (null = todo el negocio).
 * now:      {day, minutes} en la zona del negocio, o null para el panel (sin límites de fecha).
 */
function freeSlots({ config, category, day, minutes, ranges, bookings, blocks, now }) {
  if (!ranges || !ranges.length || !minutes) return [];
  if (now && (day < now.day || day > addDays(now.day, config.daysAhead))) return [];

  const step = config.slotStepMinutes;
  const cat = config.categories.find((c) => c.id === category);
  const capacity = (cat && cat.capacity) || 1;
  const earliest = now && day === now.day ? now.minutes + config.leadMinutes : 0;

  const busy = bookings.filter((b) => b.category === category && ACTIVE.has(b.status));
  const closed = blocks.filter((b) => !b.category || b.category === category);

  const out = [];
  for (const [open, close] of ranges) {
    for (let t = open; t + minutes <= close; t += step) {
      if (t < earliest) continue;
      const end = t + minutes;
      if (closed.some((b) => t < b.end && end > b.start)) continue;
      const overlapping = busy.filter((b) => t < b.start + b.minutes && end > b.start).length;
      if (overlapping < capacity) out.push(t);
    }
  }
  return out;
}

/** Valida y normaliza una lista de turnos. Devuelve un mensaje de error o null. */
function checkRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length > 4) return "Puedes tener hasta 4 turnos por día.";
  const sorted = [];
  for (const r of ranges) {
    if (!Array.isArray(r) || r.length !== 2) return "Turno inválido.";
    const [a, b] = r;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 1440 || a % 5 || b % 5)
      return "Las horas deben ir de 5 en 5 minutos.";
    if (b <= a) return "Cada turno debe terminar después de empezar.";
    sorted.push([a, b]);
  }
  sorted.sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i][0] < sorted[i - 1][1]) return "Los turnos no pueden cruzarse.";
  ranges.splice(0, ranges.length, ...sorted);
  return null;
}

module.exports = { freeSlots, checkRanges, ACTIVE };
