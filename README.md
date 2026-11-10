# Víctor Aguilar Barbería · Reservas

Rediseño completo de la app de reservas, que hoy vive en Bewe. Está pensada primero para el celular y usa la misma estética negro y dorado de los flyers de la barbería.

## Qué cambia frente a la página actual

| Antes (Bewe) | Ahora |
|---|---|
| Diseño blanco genérico, sin la marca | Negro y dorado, igual que los flyers |
| Hay que iniciar sesión para reservar | Sin cuenta: solo nombre y teléfono |
| El chatbot "Linda" tapa precios y botones | Sin elementos flotantes encima del contenido |
| El calendario se corta ("Dom") y muestra días pasados | Tira de días deslizable, con cuántos espacios quedan cada día |
| Las horas sueltas no dicen si es mañana o tarde | Horas agrupadas en Mañana, Tarde y Noche, solo donde cabe la cita completa |
| Las políticas, largas, aparecen en cada servicio | Se muestran una vez, plegadas, al confirmar |
| No hay confirmación clara | Ticket "Cita reservada", con aviso por WhatsApp y botón para agregar al calendario |
| — | "Espacios para hoy" en la portada (lo que hoy se anuncia con flyers) |
| — | "Mis citas", con opción de cancelar |

## Estructura

- `index.html`: las pantallas Inicio, Servicios, Mis citas y el flujo de reserva.
- `css/styles.css`: el diseño.
- `js/data.js`: **datos editables**: servicios, precios, horarios y políticas.
- `js/app.js`: la lógica.

## Probar localmente

```bash
python3 -m http.server 8080
# abrir http://localhost:8080 en el celular o el navegador
```

## Pendiente

- **Disponibilidad real:** hoy los espacios ocupados se simulan en `busyBlocks()` (`js/app.js`). Hay que conectarlo a un backend o a la API de Bewe.
- **Horarios:** confirmar los de atención en `js/data.js`. Ahora están puestos de lunes a viernes de 9:00 a 19:00, sábado de 8:00 a 17:00 y domingo cerrado.
- **Precios de Seimar Salón:** la página actual no los muestra, así que aparecen como "Consultar".
- **Citas:** ahora se guardan solo en el navegador del cliente (`localStorage`).
