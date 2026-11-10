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

## Cómo funciona

```
Cliente (celular)  ──►  API (/api/…)  ──►  SQLite (data/barberia.db)
                               │
Barbero (/admin)   ◄───────────┘   + aviso push opcional (ntfy)
```

1. El cliente elige servicios, día y hora. El servidor solo ofrece horas realmente libres y vuelve a verificar al guardar, así que dos personas no pueden tomar el mismo espacio.
2. La cita queda **pendiente** y al barbero le llega un aviso, si configuraste `NOTIFY_URL`.
3. En `/admin` el barbero toca **Confirmar** o **Rechazar**. Se abre WhatsApp con el mensaje ya escrito para el cliente.
4. En "Mis citas", el cliente ve el estado de su cita (pendiente, confirmada…) y puede cancelarla, lo que libera el espacio.

### Panel del barbero (`/admin`)

- **Pendientes:** las citas por confirmar, con un número rojo que avisa cuando entra una nueva. Se revisa cada 30 segundos.
- **Agenda:** las citas por día. Desde aquí se marca a cada cliente como atendido, "no vino", cancelada, o se le manda un recordatorio por WhatsApp.
- **+ Cita:** para agendar a quien llama o llega al local. Esa cita queda confirmada de una vez.
- **Bloquear:** cierra horarios (almuerzo, vacaciones), para todo el negocio o solo para barbería o salón.

## Correr en tu computadora

Requiere Node 22.5 o más reciente. No usa dependencias externas, así que no hace falta `npm install`.

```bash
npm run dev          # http://localhost:8080   panel: /admin   PIN: 123456
npm test             # pruebas automáticas
```

## Publicarla en internet

Cualquier hosting que corra Node o Docker y tenga **disco persistente** para la base de datos sirve: Railway, Render, Fly.io o un VPS.

```bash
docker build -t barberia .
docker run -d -p 8080:8080 -v barberia-data:/data \
  -e ADMIN_PIN=xxxxxx -e ADMIN_SECRET=$(openssl rand -hex 32) \
  -e NOTIFY_URL=https://ntfy.sh/tu-tema-secreto -e TRUST_PROXY=1 barberia
```

Las variables están explicadas en `.env.example`. Importante: haz copias de seguridad del volumen `/data`, porque ahí viven todas las citas.

## Estructura

| Archivo | Qué es |
|---|---|
| `server/config.js` | **Lo que se edita:** servicios, precios, horarios, políticas y cuántas citas simultáneas se atienden |
| `server/app.js` | La API: disponibilidad, reservas y panel |
| `server/availability.js` | El cálculo de horas libres |
| `server/db.js` | La base de datos SQLite |
| `public/index.html`, `js/app.js` | La app del cliente |
| `public/admin.html`, `js/admin.js` | El panel del barbero |
| `test/` | Las pruebas automáticas |

## Seguridad

- El panel se protege con un PIN, con un máximo de 6 intentos cada 15 minutos. Las sesiones duran 12 horas.
- Cada cliente ve y cancela sus citas solo con un código secreto que queda guardado en su celular.
- Las reservas tienen límites: 8 intentos por hora por conexión, 3 citas activas por teléfono y un campo invisible que frena a los bots.
- El cliente nunca ve teléfonos ni datos de otras personas.

## Pendiente de confirmar con la barbería

- **Horarios reales:** en `server/config.js`. Ahora dicen lunes a viernes de 9:00 a 19:00, sábado de 8:00 a 17:00 y domingo cerrado.
- **Precios de Seimar Salón:** aparecen como "Consultar".
- **Cuántos barberos atienden a la vez:** `capacity` en `server/config.js`. Ahora es 1.
- **El logo real:** en lugar del monograma "VA" provisional.
