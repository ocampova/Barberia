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

### Plataforma multi-negocio

Un solo servidor atiende a **varios negocios independientes**, cada uno en su dirección:

| Negocio | Dirección | Profesional |
|---|---|---|
| Víctor Aguilar Barbería | `victoraguilar.elcorte.app` | Víctor Aguilar |
| Seimar Salón | `seimar.elcorte.app` | Seidy Matamoros |

- **Cada negocio tiene su propia base de datos:** clientes, citas, servicios, horario, ajustes y equipo. Los clientes de un negocio no existen en otro, aunque usen el mismo correo, y la sesión de uno no abre el otro.
- **Marca por negocio:** nombre, logo, colores (`theme`), frase de portada (`hero`), lema, ubicación, teléfono, políticas, ícono de la app, manifest, correos y aviso de privacidad. El diseño de las pantallas es el mismo para todos.
- **Negocios relacionados:** la tarjeta "En el mismo local" (`related`) enlaza a la app del otro negocio.
- **El equipo de cada negocio** (por ejemplo Víctor o Seidy) se maneja desde la plataforma o desde **Ajustes → Equipo** del panel. Cada quien solo entra al panel de su negocio.
- Dentro de un negocio sigue habiendo **agendas** (`categories`): un negocio con varias sillas o profesionales puede tener varias, cada una con su horario y su cupo.

**Agregar un negocio nuevo:**
1. Copia `server/negocios/seimar.js` como `server/negocios/<slug>.js` y cambia la marca, los servicios y la agenda.
2. Pon su logo en `public/img/negocios/<slug>/logo.svg` y genera los íconos con `node brand/export.js`.
3. Agrégalo a la lista en `server/negocios/index.js`.
4. En Railway, ve a **Settings → Networking → Custom Domain** y escribe `<slug>.elcorte.app`, con su CNAME en Cloudflare.

### Plataforma (`plataforma.elcorte.app`)

Es la vista del dueño de la aplicación, para administrar todos los negocios:

- **Su propia cuenta:** se crea con `ADMIN_EMAIL`. Si ya tenías una cuenta de administrador en algún negocio con ese correo, se usa la misma contraseña. Esa cuenta del negocio pasa a ser de cliente, así que el panel de cada negocio queda solo para su equipo.
- **Tablero:**
  - por negocio: clientes, clientes nuevos, citas del mes, citas por confirmar, próximos 7 días, última reserva y última copia de seguridad;
  - acciones: **Copia ahora** y **Abrir app**.
- **Entrar al panel:** abre el panel de ese negocio con un pase de un solo uso de 60 segundos. La entrada dura 8 horas, sirve solo para ese negocio y muestra el aviso "Modo plataforma".
- **Equipo de cada negocio:** la persona crea su cuenta en la app del negocio, y después le das acceso con su correo o teléfono.
- **Registro de accesos:** inicios de sesión (también los fallidos), entradas a cada panel y cambios de equipo.

Si olvidas la contraseña de la plataforma, pon `ADMIN_PASSWORD` con una nueva y `ADMIN_FORCE=1`, despliega y entra. Luego **borra `ADMIN_FORCE`**.

La primera vez que arrancó la plataforma, una **migración** pasó los datos del salón (servicios, horario, citas y las cuentas de quienes reservaron ahí) de la base de Víctor a la de Seimar, después de guardar una copia de seguridad (`/data/backups/antes-de-separar-salon-*.db`).

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

Se entra con correo o teléfono y contraseña, con una cuenta de **administrador**. En **Equipo** se da o quita acceso a otras personas (por ejemplo, la persona del salón), que primero deben crear su cuenta en la app.


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
  - **Rango de fechas** (vacaciones, feriados): se eligen **desde** y **hasta**, y el rango completo se cierra, se abre con un horario especial o vuelve al horario semanal. Hasta un año de una vez.
  - **Ambas agendas:** al editar días o rangos, la casilla "Aplicar también a…" aplica el cambio a la barbería y al salón al mismo tiempo.
  - **Aviso de citas:** si un cambio deja citas fuera del horario, el panel avisa. Esas citas no se cancelan solas.

## Correr en tu computadora

Requiere Node 22.5 o más reciente. No usa dependencias externas, así que no hace falta `npm install`.

```bash
npm run dev          # http://localhost:8080   panel: /admin   admin@barberia.test / admin12345
npm test             # pruebas automáticas
```

## Publicarla en Railway

1. **New Project → Deploy from GitHub repo**, elegir este repositorio y la rama a publicar. Railway usa el `Dockerfile` y `railway.json`, que ya traen la verificación en `/api/health` y el reinicio automático si falla.
2. En el servicio: **Settings → Volumes → New Volume** con *mount path* `/data`. Ahí vive la base de datos; sin el volumen, los datos se pierden en cada nueva versión.
3. **Variables:**

| Variable | Valor |
|---|---|
| `ADMIN_EMAIL` | correo de tu cuenta de la plataforma |
| `ADMIN_PASSWORD` | contraseña inicial de la plataforma (mínimo 8 caracteres); se cambia después desde la plataforma |
| `ADMIN_NAME` | tu nombre |
| `TRUST_PROXY` | `1` |
| `RAILWAY_RUN_UID` | `0` (el volumen de Railway se monta como root) |
| `ADMIN_FORCE` | Solo para recuperar el acceso a la plataforma: con `1`, al arrancar le pone a `ADMIN_EMAIL` la contraseña `ADMIN_PASSWORD`. **Bórrala después de entrar.** |
| `PUBLIC_URL` | `https://victoraguilar.elcorte.app` (cuando el dominio esté conectado) |

Al arrancar, los registros (**Deployments → View logs**) muestran un resumen: si ve `ADMIN_EMAIL`, `TRUST_PROXY`, la ruta de la base de datos y si se creó el administrador.

4. **Settings → Networking → Generate Domain** para probar con una dirección `*.up.railway.app`, y luego **Custom Domain** para conectar el dominio propio.

## Publicarla en otro hosting

Cualquier hosting que corra Node o Docker y tenga **disco persistente** para la base de datos sirve: Railway, Render, Fly.io o un VPS.

```bash
docker build -t barberia .
docker run -d -p 8080:8080 -v barberia-data:/data \
  -e ADMIN_EMAIL=tu@correo.com -e ADMIN_PASSWORD='una-contraseña-larga' \
  -e NOTIFY_URL=https://ntfy.sh/tu-tema-secreto -e TRUST_PROXY=1 barberia
```

Las variables están explicadas en `.env.example`. Importante: haz copias de seguridad del volumen `/data`, porque ahí viven todas las citas.

## Estructura

| Archivo | Qué es |
|---|---|
| `server/negocios/` | Un archivo por negocio: marca, contacto, políticas, agendas, y servicios y horario **iniciales** (después se editan en el panel) |
| `server/platform.js` | Elige el negocio según la dirección, abre su base de datos y hace las migraciones |
| `server/platform-admin.js`, `server/platform-db.js` | La plataforma: tu cuenta, el tablero, la entrada a cada panel y el registro |
| `public/plataforma.html`, `js/plataforma.js` | La pantalla de la plataforma |
| `server/auth.js` | Contraseñas y sesiones |
| `server/backup.js` | Copias de seguridad diarias, locales y externas (S3/R2) |
| `server/app.js` | La API: disponibilidad, reservas y panel |
| `server/availability.js` | El cálculo de horas libres |
| `server/db.js` | La base de datos SQLite |
| `server/emails.js`, `server/mailer.js` | Las plantillas de correo y el envío con Resend |
| `public/index.html`, `js/app.js` | La app del cliente |
| `public/admin.html`, `js/admin.js` | El panel del barbero |
| `test/` | Las pruebas automáticas |

## Copias de seguridad

- **Automáticas:** todos los días a partir de las 3:00 a.m. (hora de Costa Rica) se hace una copia de la base de datos, consistente aunque la app esté en uso. Se comprime y se guardan las últimas 7 en `/data/backups`.
- **Fuera del servidor:** si se configuran las variables `BACKUP_S3_*`, cada copia se sube también a Cloudflare R2 (o a cualquier almacenamiento compatible con S3). Así no se pierde nada aunque falle Railway.
- **Desde el panel**, en **Ajustes → Copias de seguridad**: "Hacer copia ahora" y "Descargar copia" (un archivo `.db.gz`).
- **Restaurar:**
  1. Descomprime la copia: `gunzip barberia-....db.gz`.
  2. Detén el servicio.
  3. Reemplaza `/data/barberia.db` con el archivo descomprimido y borra `barberia.db-wal` y `barberia.db-shm` si existen.
  4. Vuelve a arrancar el servicio.

### Configurar Cloudflare R2

1. En Cloudflare, ve a **R2 Object Storage** y luego a **Create bucket**, con el nombre `elcorte-backups`.
2. En **R2 → Manage API tokens → Create API token**, elige permiso **Object Read & Write** solo para ese bucket. Copia el *Access Key ID*, el *Secret Access Key* y el *endpoint* (`https://<cuenta>.r2.cloudflarestorage.com`).
3. En Railway, agrega `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID` y `BACKUP_S3_SECRET_ACCESS_KEY`.
4. En el panel, ve a **Ajustes → Hacer copia ahora**: debe decir "guardada fuera del servidor".

## Seguridad

- **Panel:** se entra con una cuenta de rol administrador (correo o teléfono y contraseña), igual que los clientes. Una cuenta de cliente no puede entrar.
  - Para dar o quitar acceso: desde la plataforma, desde **Ajustes → Equipo** del panel, o desde la terminal del servidor con `npm run admin -- <negocio> correo@ejemplo.com` (o `--quitar`).
  - La plataforma tiene su propia base de datos (`plataforma.db`) y su propia cookie (`SameSite=Strict`).
  - La entrada a un panel desde la plataforma va firmada (HMAC), está atada a ese negocio y queda en el registro.
  - Quitarle el acceso a alguien cierra sus sesiones abiertas.
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

- **Horarios reales:** se configuran desde el panel, en **Horario**. `server/negocios/<negocio>.js` solo trae el horario inicial: lunes a viernes de 9:00 a 19:00, sábado de 8:00 a 17:00 y domingo cerrado.
- **Precios de Seimar Salón:** aparecen como "Consultar".
- **Cuántos barberos atienden a la vez:** `capacity` de cada agenda en `server/negocios/<negocio>.js`. Ahora es 1.
- **El logo real:** en lugar del monograma "VA" provisional.
