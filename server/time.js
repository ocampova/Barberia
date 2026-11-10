"use strict";
// Fechas como texto "YYYY-MM-DD" y horas como minutos desde medianoche,
// siempre en la zona horaria del negocio (no la del servidor).

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDay(s) {
  if (typeof s !== "string" || !DAY_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function weekday(day) {
  return new Date(day + "T12:00:00Z").getUTCDay();
}

function addDays(day, n) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nowIn(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: +parts.hour * 60 + +parts.minute };
}

function fmtTime(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`;
}

module.exports = { isDay, weekday, addDays, nowIn, fmtTime };
