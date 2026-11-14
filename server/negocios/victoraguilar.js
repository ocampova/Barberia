"use strict";
// Víctor Aguilar Barbería. Los precios y duraciones iniciales vienen de su página de reservas de Bewe.

module.exports = {
  slug: "victoraguilar",
  dbFile: "barberia.db", // nombre histórico de su base de datos (antes de la plataforma multi-negocio)

  name: "Víctor Aguilar Barbería",
  shortName: "Víctor Aguilar",
  tagline: "Barbería · Since 2016",
  place: "la barbería",
  hero: { title: "Tu estilo,", accent: "nuestra prioridad" },
  slogan: "Más que una barbería, un club de amigos",
  description: "Reserva tu corte o tu barba en Víctor Aguilar Barbería, San Roque de Grecia.",

  city: "San Roque de Grecia",
  location: "San Roque de Grecia, Alajuela",
  mapsUrl: "https://maps.google.com/?q=San+Roque+de+Grecia,+Alajuela",
  phone: "83704499",
  whatsapp: "50683704499",

  theme: { accent: "#c9a227", accent2: "#e3c26a", ink: "#1a1405" },
  logos: {
    main: "img/negocios/victoraguilar/logo.svg",
    email: "img/negocios/victoraguilar/email.png",
    icon192: "img/negocios/victoraguilar/icon-192.png",
    icon512: "img/negocios/victoraguilar/icon-512.png",
    apple: "img/negocios/victoraguilar/apple-touch-icon.png",
  },

  related: [{ slug: "seimar", pitch: "Corte, color, uñas y tratamientos para ella, con Seidy Matamoros." }],

  policies: [
    "Si por alguna razón no puedes asistir, avísanos con anticipación para liberar el espacio a otro cliente.",
    "Te agradecemos venir sin acompañantes, salvo que lo requieras por alguna condición especial.",
    "Tu reserva queda pendiente hasta que la barbería la confirme. Te avisaremos por correo o WhatsApp.",
  ],

  // Cada categoría es una agenda separada, con su horario y su cupo (capacity = citas a la vez).
  categories: [
    { id: "barberia", name: "Barbería", capacity: 1, staff: "Víctor Aguilar", brand: "Víctor Aguilar Barbería", place: "la barbería" },
  ],

  // Servicios INICIALES: se copian a la base de datos la primera vez. Después se administran en el panel.
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
  ],
};
