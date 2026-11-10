// Datos del negocio. Edita este archivo para cambiar servicios, precios u horarios.
// Los precios y duraciones de Barbería vienen de la página de reservas actual.
// Los horarios de atención son un supuesto: confírmalos con la barbería.

window.BUSINESS = {
  name: "Víctor Aguilar",
  tagline: "Barbería · Since 2016",
  partner: "Seimar Salón",
  slogan: "Más que una barbería, un club de amigos",
  location: "San Roque de Grecia, Alajuela",
  phone: "83704499",
  whatsapp: "50683704499",
  currency: "₡",
  // 0 = domingo ... 6 = sábado. [apertura, cierre] en horas de 24h.
  hours: {
    0: null,
    1: [9, 19],
    2: [9, 19],
    3: [9, 19],
    4: [9, 19],
    5: [9, 19],
    6: [8, 17],
  },
  slotStepMinutes: 15,
  daysAhead: 21,
  policies: {
    cancelacion:
      "Si por alguna razón no puedes asistir, avísanos con anticipación para liberar el espacio a otro cliente.",
    acompanantes:
      "Te agradecemos venir sin acompañantes, salvo que lo requieras por alguna condición especial.",
    preconfirmacion:
      "Tu reserva queda pendiente hasta que la barbería la confirme. Te avisaremos por WhatsApp.",
  },
};

window.CATEGORIES = [
  { id: "barberia", name: "Barbería", icon: "scissors" },
  { id: "salon", name: "Seimar Salón", icon: "sparkle" },
];

window.SERVICES = [
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

  // Seimar Salón: la página actual no muestra precios para estas categorías.
  { id: "color", cat: "salon", name: "Color", price: null, min: 90, desc: "Tintes, mechas y matices." },
  { id: "corte-peinado", cat: "salon", name: "Corte y peinado", price: null, min: 60, desc: "Corte y peinado de dama." },
  { id: "depilacion", cat: "salon", name: "Depilación", price: null, min: 30, desc: "Cejas, rostro y cuerpo." },
  { id: "lisos", cat: "salon", name: "Lisos", price: null, min: 120, desc: "Alisados y keratina." },
  { id: "maquillaje", cat: "salon", name: "Maquillaje", price: null, min: 60, desc: "Social y para eventos." },
  { id: "tratamiento", cat: "salon", name: "Tratamiento capilar", price: null, min: 45, desc: "Hidratación y reparación." },
  { id: "facial", cat: "salon", name: "Tratamiento facial", price: null, min: 60, desc: "Limpieza y cuidado de la piel." },
  { id: "unas", cat: "salon", name: "Uñas", price: null, min: 60, desc: "Manicure y pedicure." },
];
