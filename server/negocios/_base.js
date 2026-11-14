"use strict";
// Valores comunes a todos los negocios de la plataforma. Cada negocio puede sobrescribirlos.

module.exports = {
  countryCode: "506",
  currency: "₡",
  timeZone: "America/Costa_Rica",

  // Horario INICIAL: se copia a la base de datos del negocio la primera vez. Después se edita en el panel.
  // 0 = domingo ... 6 = sábado. [apertura, cierre] en minutos desde medianoche.
  hours: {
    0: null,
    1: [9 * 60, 19 * 60],
    2: [9 * 60, 19 * 60],
    3: [9 * 60, 19 * 60],
    4: [9 * 60, 19 * 60],
    5: [9 * 60, 19 * 60],
    6: [8 * 60, 17 * 60],
  },
  slotStepMinutes: 15,
  leadMinutes: 30,          // anticipación mínima para reservar hoy
  daysAhead: 21,            // cuántos días hacia adelante se puede reservar
  maxActivePerPhone: 3,     // citas activas por cliente
  cancelHours: 2,           // valor inicial del plazo para cancelar (se cambia en el panel)
  reminderHoursBefore: 24,  // recordatorio por correo
  privacyVersion: "2026-11",

  sources: [ // opciones de "¿Cómo nos conociste?"
    { id: "instagram", label: "Instagram" },
    { id: "facebook", label: "Facebook" },
    { id: "tiktok", label: "TikTok" },
    { id: "google", label: "Google o Google Maps" },
    { id: "referido", label: "Un amigo o familiar" },
    { id: "flyer", label: "Flyer o afiche" },
    { id: "local", label: "Pasé por el local" },
    { id: "cliente", label: "Ya era cliente" },
    { id: "otro", label: "Otro" },
  ],

  // Colores de la marca. accent = color principal; accent2 = versión clara; ink = texto sobre accent.
  theme: { accent: "#c9a227", accent2: "#e3c26a", ink: "#1a1405" },

  related: [], // negocios relacionados ("En el mismo local"): [{ slug, pitch }]
};
