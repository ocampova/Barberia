"use strict";
const { weekday, addDays } = require("./time");

const ACTIVE = new Set(["pendiente", "confirmada"]);

/**
 * Horas de inicio libres para una cita de `minutes` minutos.
 * bookings: [{category, start, minutes, status}] del mismo día.
 * blocks:   [{category|null, start, end}] del mismo día (null = todo el negocio).
 */
function freeSlots({ config, category, day, minutes, bookings, blocks, now }) {
  const hours = config.hours[weekday(day)];
  if (!hours || !minutes) return [];
  // now = null: uso del panel, sin límites de anticipación ni de días hacia adelante.
  if (now && (day < now.day || day > addDays(now.day, config.daysAhead))) return [];

  const [open, close] = hours;
  const step = config.slotStepMinutes;
  const cat = config.categories.find((c) => c.id === category);
  const capacity = (cat && cat.capacity) || 1;
  const earliest = now && day === now.day ? now.minutes + config.leadMinutes : 0;

  const busy = bookings.filter((b) => b.category === category && ACTIVE.has(b.status));
  const closed = blocks.filter((b) => !b.category || b.category === category);

  const out = [];
  for (let t = open; t + minutes <= close; t += step) {
    if (t < earliest) continue;
    const end = t + minutes;
    if (closed.some((b) => t < b.end && end > b.start)) continue;
    const overlapping = busy.filter((b) => t < b.start + b.minutes && end > b.start).length;
    if (overlapping < capacity) out.push(t);
  }
  return out;
}

module.exports = { freeSlots, ACTIVE };
