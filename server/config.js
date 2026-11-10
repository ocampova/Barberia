"use strict";
// Configuración del negocio. Edita este archivo para cambiar servicios, precios u horarios.
// Los precios y duraciones de Barbería vienen de la página de reservas de Bewe.
// HORARIOS: son un supuesto. Confírmalos con la barbería.

module.exports = {
  name: "Víctor Aguilar",
  tagline: "Barbería · Since 2016",
  partner: "Seimar Salón",
  slogan: "Más que una barbería, un club de amigos",
  location: "San Roque de Grecia, Alajuela",
  mapsUrl: "https://maps.google.com/?q=San+Roque+de+Grecia,+Alajuela",
  phone: "83704499",
  whatsapp: "50683704499",
  countryCode: "506",
  currency: "₡",
  timeZone: "America/Costa_Rica",

  // Horario INICIAL: se copia a la base de datos la primera vez que arranca el servidor.
  // Después el horario se administra desde el panel (/admin → Horario), no aquí.
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
  leadMinutes: 30, // anticipación mínima para reservar hoy
  daysAhead: 21,
  maxActivePerPhone: 3,
  cancelHours: 2, // valor inicial: hasta cuántas horas antes se puede cancelar desde la app (se cambia en el panel)
  privacyVersion: "2026-11", // cambia si se modifica el aviso de privacidad (public/privacidad.html)
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

  policies: [
    "Si por alguna razón no puedes asistir, avísanos con anticipación para liberar el espacio a otro cliente.",
    "Te agradecemos venir sin acompañantes, salvo que lo requieras por alguna condición especial.",
    "Tu reserva queda pendiente hasta que la barbería la confirme. Te avisaremos por correo o WhatsApp.",
  ],

  // capacity = cuántas citas pueden atenderse a la vez (sillas o profesionales).
  // staff = nombre que aparece como "Profesional" en los correos (opcional).
  categories: [
    { id: "barberia", name: "Barbería", capacity: 1, staff: "Víctor Aguilar" },
    { id: "salon", name: "Seimar Salón", capacity: 1 },
  ],
  reminderHoursBefore: 24, // recordatorio por correo, si el cliente dejó su correo

  // Servicios INICIALES: se copian a la base de datos la primera vez que arranca el servidor.
  // Después se administran desde el panel (/admin → Servicios): nombre, duración, precio, etc.
  services: [
    { id: "corte", cat: "barberia", name: "Corte caballero", price: 9000, min: 50, popular: true,
      desc: "Corte a tijera o máquina, lavado y peinado." },
    { id: "corte-barba", cat: "barberia", name: "Corte + barba", price: 14000, min: 75, popular: true,
      desc: "El combo completo: corte, perfilado y arreglo de barba." },
    { id: "barba", cat: "barberia", name: "Barba", price: 7000, min: 45,
      desc: "Perfilado, toalla caliente y acabado a navaja." },
    { id: "nino-5-11", cat: "barberia", name: "Corte niño 5 a 11 años", price: 7000, min: 40,
      desc: "Corte para los más pequeños de la casa." },
    { id: "nino-0-3", cat: "barberia", name: "Corte niño 0 a 3 años", price: 5000, min: 40,
      desc: "Con paciencia y cariño para su primer corte." },

    // Seimar Salón: Bewe no muestra precios para estas categorías (price: null = "Consultar").
    { id: "color", cat: "salon", name: "Color", price: null, min: 90, desc: "Tintes, mechas y matices." },
    { id: "corte-peinado", cat: "salon", name: "Corte y peinado", price: null, min: 60, desc: "Corte y peinado de dama." },
    { id: "depilacion", cat: "salon", name: "Depilación", price: null, min: 30, desc: "Cejas, rostro y cuerpo." },
    { id: "lisos", cat: "salon", name: "Lisos", price: null, min: 120, desc: "Alisados y keratina." },
    { id: "maquillaje", cat: "salon", name: "Maquillaje", price: null, min: 60, desc: "Social y para eventos." },
    { id: "tratamiento", cat: "salon", name: "Tratamiento capilar", price: null, min: 45, desc: "Hidratación y reparación." },
    { id: "facial", cat: "salon", name: "Tratamiento facial", price: null, min: 60, desc: "Limpieza y cuidado de la piel." },
    { id: "unas", cat: "salon", name: "Uñas", price: null, min: 60, desc: "Manicure y pedicure." },
  ],
};
