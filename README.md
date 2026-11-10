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
2. La cita queda **pendiente**. Si el cliente dejó correo, le llega uno que dice "Recibimos tu solicitud", y al barbero le llega un aviso si configuraste `NOTIFY_URL`.
3. En `/admin` el barbero toca **Confirmar** o **Rechazar**. Si el cliente dejó correo, el aviso le llega por ahí; si no, se abre WhatsApp con el mensaje ya escrito.
4. En "Mis citas", el cliente ve el estado de su cita (pendiente, confirmada…) y puede cancelarla, lo que libera el espacio.

### Cuentas de clientes

- **Sin cuenta** se pueden ver servicios y horarios. Para **confirmar una reserva** hay que iniciar sesión o crear una cuenta en ese mismo paso.
- **Registro:** nombre, teléfono, correo y contraseña. Se entra con correo o teléfono y contraseña.
- **Perfil:** datos editables, cambio de contraseña, número de visitas y próxima cita.
- **Mis citas:** próximas (con opción de cancelar y de agregar al calendario) e historial (con "Reservar de nuevo").
- **Olvidé mi contraseña:** llega un enlace por correo que vence en 1 hora. Requiere tener los correos configurados.

### Correos al cliente

Con un estilo parecido a los de Bewe, pero con la imagen negro y dorado de la marca. El correo es opcional para el cliente.

| Cuándo | Correo |
|---|---|
| Al reservar | "Recibimos tu solicitud": pendiente de confirmación |
| El barbero confirma | "Tu cita está confirmada", con la invitación `.ics` para agregarla al calendario |
| Unas 24 h antes | Recordatorio, una sola vez, a las citas confirmadas |
| El barbero rechaza o cancela | Aviso, con un botón para reservar otro horario |
| El cliente cancela | Confirmación de la cancelación |

Cada correo trae un botón **"Ver o cancelar mi cita"** que abre la cita en la app, aunque sea en otro celular.

Se envían con [Resend](https://resend.com), cuyo plan gratis da 3000 correos al mes. Hay que configurar `RESEND_API_KEY`, `EMAIL_FROM` y `PUBLIC_URL` (ver `.env.example`). Para que los correos no caigan en spam, verifica en Resend el dominio desde el que se envían. Si falta la configuración, la app simplemente no pide el correo.

### Panel del barbero (`/admin`)

- **Pendientes:** las citas por confirmar, con un número rojo que avisa cuando entra una nueva. Se revisa cada 30 segundos.
- **Agenda:** las citas por día. Desde aquí se marca a cada cliente como atendido, "no vino", cancelada, o se le manda un recordatorio por WhatsApp.
- **+ Cita:** para agendar a quien llama o llega al local. Esa cita queda confirmada de una vez.
- **Servicios:** crear, editar, ordenar, ocultar o borrar servicios: nombre, categoría, **duración**, precio (en blanco = "Consultar"), descripción y "Destacado" (aparece en la portada).
  - Cada cita guarda la duración y el precio que tenía al reservarse, así que los cambios no afectan las citas existentes.
  - Un servicio que ya tiene citas no se puede borrar, solo ocultar, para conservar el historial.
- **Horario:** el barbero decide qué días y horas se trabaja, por separado para barbería y para salón.
  - **Horario semanal:** el horario normal de cada día. Cada día puede estar cerrado o tener hasta 4 turnos, por ejemplo 9:00–12:00 y 14:00–19:00 para dejar el almuerzo libre.
  - **Calendario:** se tocan uno o varios días y se **abren** con un horario, se **cierran** (vacaciones, feriados) o vuelven al horario semanal.
  - **Sin horario fijo:** se cierran todos los días en el horario semanal y se abren solo los días que se trabaja.
  - **Aviso de citas:** si un cambio deja citas fuera del horario, el panel avisa. Esas citas no se cancelan solas.

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
| `server/config.js` | Datos del negocio, políticas, capacidad, y servicios y horario **iniciales** (después se editan en el panel) |
| `server/auth.js` | Contraseñas y sesiones |
| `server/app.js` | La API: disponibilidad, reservas y panel |
| `server/availability.js` | El cálculo de horas libres |
| `server/db.js` | La base de datos SQLite |
| `server/emails.js`, `server/mailer.js` | Las plantillas de correo y el envío con Resend |
| `public/index.html`, `js/app.js` | La app del cliente |
| `public/admin.html`, `js/admin.js` | El panel del barbero |
| `test/` | Las pruebas automáticas |

## Seguridad

- El panel se protege con un PIN, con un máximo de 6 intentos cada 15 minutos. Las sesiones duran 12 horas.
- **Cuentas de clientes:**
  - Las contraseñas se guardan cifradas con scrypt.
  - La sesión va en una cookie `HttpOnly` y `SameSite=Lax`, que es `Secure` cuando se usa https.
  - El servidor solo acepta escrituras en formato JSON, lo que bloquea formularios enviados desde otros sitios (CSRF).
  - Cambiar la contraseña cierra la sesión en los demás aparatos.
  - La recuperación de contraseña no revela qué correos tienen cuenta.
- Cada cliente solo ve y cancela sus propias citas.
- Las reservas tienen límites: 8 intentos por hora por conexión, 3 citas activas por cliente y un campo invisible que frena a los bots. También hay límites de intentos para iniciar sesión y crear cuentas.
- El cliente nunca ve teléfonos ni datos de otras personas.

## Pendiente de confirmar con la barbería

- **Horarios reales:** se configuran desde el panel, en **Horario**. `server/config.js` solo trae el horario inicial: lunes a viernes de 9:00 a 19:00, sábado de 8:00 a 17:00 y domingo cerrado.
- **Precios de Seimar Salón:** aparecen como "Consultar".
- **Cuántos barberos atienden a la vez:** `capacity` en `server/config.js`. Ahora es 1.
- **El logo real:** en lugar del monograma "VA" provisional.
