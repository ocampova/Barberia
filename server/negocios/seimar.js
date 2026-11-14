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
  location: "150 m oeste de la plaza de deportes, San Roque de Grecia",
  mapsUrl: "https://maps.google.com/?q=Seimar+Salon,+San+Roque,+Grecia,+Costa+Rica",
  // Datos de su página de Facebook. Son los valores iniciales: el salón los cambia en su panel (Ajustes → Datos de contacto).
  phone: "24442141",
  whatsapp: "50624442141",     // por confirmar: el fijo; cambiar si el WhatsApp es otro número
  replyTo: "seimarsaloncr@gmail.com",
  facebook: "seimarsalon",

  // Crema y rosa dorado, con fondo claro.
  theme: {
    accent: "#b87a63", accent2: "#9a5c47", ink: "#ffffff",
    palette: {
      scheme: "light", bg: "#faf6f1", surface: "#ffffff", surface2: "#f3ece4", line: "#e9dfd5", text: "#3a2a24",
      muted: "#8a776c", muted2: "#b3a497", heroTop: "#f1e3d8", backdrop: "#efe7df", warn: "#a8641c",
      shadow: "rgba(80, 50, 30, .12)", ok: "#3f9a63", danger: "#c0533f",
    },
  },
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
