"use strict";
// Negocio de prueba con DOS agendas (barbería + salón) en la misma base de datos.
// La plataforma sigue permitiendo varias agendas por negocio (p. ej. varias sillas o profesionales).
const { build } = require("../../server/negocios");
const victor = require("../../server/negocios/victoraguilar");
const seimar = require("../../server/negocios/seimar");

module.exports = build({
  ...victor,
  categories: [victor.categories[0], { ...seimar.categories[0], name: "Seimar Salón" }],
  services: [...victor.services, ...seimar.services],
});
