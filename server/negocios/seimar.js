"use strict";
// Seimar Salón (Seidy Matamoros). Precios por confirmar: Bewe no los mostraba (price: null = "Consultar").

module.exports = {
  slug: "seimar",

  name: "Seimar Salón",
  shortName: "Seimar",
  tagline: "Salón de belleza",
  place: "el salón",
  hero: { title: "Tu belleza,", accent: "nuestro arte" },
  slogan: "Un espacio para consentirte",
  description: "Reserva color, cortes, uñas y tratamientos en Seimar Salón, San Roque de Grecia.",

  city: "San Roque de Grecia",
  location: "San Roque de Grecia, Alajuela",
  mapsUrl: "https://maps.google.com/?q=San+Roque+de+Grecia,+Alajuela",
  phone: "83704499",          // por confirmar: teléfono / WhatsApp propio del salón
  whatsapp: "50683704499",

  // Negro con rosa dorado (provisional, se cambia aquí).
  theme: { accent: "#c8917c", accent2: "#e9c0ae", ink: "#2a1510" },
  logos: {
    main: "img/negocios/seimar/logo.svg",
    email: "img/negocios/seimar/email.png",
    icon192: "img/negocios/seimar/icon-192.png",
    icon512: "img/negocios/seimar/icon-512.png",
    apple: "img/negocios/seimar/apple-touch-icon.png",
  },

  related: [{ slug: "victoraguilar", pitch: "Cortes y barba para él, con Víctor Aguilar." }],

  policies: [
    "Si por alguna razón no puedes asistir, avísanos con anticipación para liberar el espacio a otra clienta.",
    "Algunos servicios (color, alisados) pueden variar de precio según el largo y el tipo de cabello.",
    "Tu reserva queda pendiente hasta que el salón la confirme. Te avisaremos por correo o WhatsApp.",
  ],

  categories: [
    { id: "salon", name: "Salón", capacity: 1, staff: "Seidy Matamoros", brand: "Seimar Salón", place: "el salón" },
  ],

  services: [
    { id: "color", cat: "salon", name: "Color", price: null, min: 90, popular: true, desc: "Tintes, mechas y matices." },
    { id: "corte-peinado", cat: "salon", name: "Corte y peinado", price: null, min: 60, popular: true, desc: "Corte y peinado de dama." },
    { id: "depilacion", cat: "salon", name: "Depilación", price: null, min: 30, desc: "Cejas, rostro y cuerpo." },
    { id: "lisos", cat: "salon", name: "Lisos", price: null, min: 120, desc: "Alisados y keratina." },
    { id: "maquillaje", cat: "salon", name: "Maquillaje", price: null, min: 60, desc: "Social y para eventos." },
    { id: "tratamiento", cat: "salon", name: "Tratamiento capilar", price: null, min: 45, desc: "Hidratación y reparación." },
    { id: "facial", cat: "salon", name: "Tratamiento facial", price: null, min: 60, desc: "Limpieza y cuidado de la piel." },
    { id: "unas", cat: "salon", name: "Uñas", price: null, min: 60, popular: true, desc: "Manicure y pedicure." },
  ],
};
