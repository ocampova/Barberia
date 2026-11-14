"use strict";
// Plantillas de correo para el cliente. El HTML usa tablas y estilos en línea,
// porque así lo exigen Gmail, Outlook y el resto de clientes de correo.
const { fmtTime } = require("./time");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function longDate(day) {
  const d = new Date(day + "T12:00:00Z");
  return d.toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Mezcla un color con el fondo oscuro (para fondos suaves compatibles con todos los correos).
function mix(hex, alpha, bg = [11, 10, 9]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#2a2312";
  const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  return "#" + c.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}

const KINDS = {
  recibida: {
    subject: (b) => `Recibimos tu solicitud de cita · ${b.brand}`,
    badge: "Pendiente de confirmación",
    title: (b) => `¡Hola ${b.first}!`,
    lead: (b) => `Recibimos tu solicitud. ${cap(b.place)} la revisará y te avisaremos por este medio cuando quede confirmada.`,
    calendar: false,
  },
  confirmada: {
    subject: (b) => `Tu cita en ${b.brand} está confirmada`,
    badge: "Cita confirmada",
    title: (b) => `¡Hola ${b.first}!`,
    lead: (b) => `Tu cita fue aprobada por ${b.place}. Te esperamos. Si no puedes llegar, avísanos para liberar el espacio.`,
    calendar: true,
  },
  recordatorio: {
    subject: (b) => `Recordatorio: tu cita es ${b.whenShort}`,
    badge: "Recordatorio",
    title: (b) => `¡Hola ${b.first}!`,
    lead: (b) => b.second
      ? "Tu cita es en pocas horas. ¡Te esperamos! Si al final no puedes llegar, avísanos cuanto antes para que otro cliente pueda usar el espacio."
      : "Te recordamos tu cita. Si no puedes llegar, cancélala desde el enlace de abajo para que otro cliente pueda usar el espacio.",
    calendar: false,
  },
  rechazada: {
    subject: (b) => `No pudimos confirmar tu cita · ${b.brand}`,
    badge: "No disponible",
    title: (b) => `Hola ${b.first},`,
    lead: (b) => `Lo sentimos, ${b.place} no puede atenderte en ese horario. Puedes reservar otro espacio cuando gustes.`,
    calendar: false,
    cta: "Reservar otro horario",
  },
  cancelada: {
    subject: (b) => `Tu cita fue cancelada · ${b.brand}`,
    badge: "Cita cancelada",
    title: (b) => `Hola ${b.first},`,
    lead: (b) => b.byClient
      ? "Cancelaste tu cita y el espacio quedó libre. ¡Te esperamos en otra ocasión!"
      : b.byRequest
        ? "Cancelamos tu cita como nos pediste y el espacio quedó libre. ¡Te esperamos en otra ocasión!"
        : `${b.place.charAt(0).toUpperCase() + b.place.slice(1)} tuvo que cancelar tu cita. Disculpa las molestias. Puedes reservar otro espacio cuando gustes.`,
    calendar: false,
    cta: "Reservar de nuevo",
  },
};

/**
 * @param kind  recibida | confirmada | recordatorio | rechazada | cancelada
 * @param b     la cita (con services como ids)
 * @param link  URL para ver o cancelar la cita, o null
 */
function render(kind, b, config, { link = null, siteUrl = null, byClient = false, byRequest = false, second = false } = {}) {
  const k = KINDS[kind];
  if (!k) throw new Error("Tipo de correo desconocido: " + kind);
  const svc = b.services.map((id) => config.services.find((s) => s.id === id)?.name || id);
  const cat = config.categories.find((c) => c.id === b.category);
  const ctx = {
    first: b.name.split(" ")[0],
    whenShort: `${longDate(b.day).split(",")[0]} a las ${fmtTime(b.start)}`,
    byClient,
    byRequest,
    second,
    brand: (cat && cat.brand) || config.name,
    place: (cat && cat.place) || "la barbería",
  };
  const total = b.total == null ? "Por confirmar" : config.currency + b.total.toLocaleString("es-CR");
  const rows = [
    ["Servicio", svc.join(" + ")],
    ["Día", cap(longDate(b.day))],
    ["Hora", `${fmtTime(b.start)} – ${fmtTime(b.start + b.minutes)}`],
    ...(cat && cat.staff ? [["Profesional", cat.staff]] : []),
    ["Total", total],
    ["Lugar", config.location],
  ];
  const active = ["recibida", "confirmada", "recordatorio"].includes(kind);
  const button = active && link ? { href: link, label: "Ver o cancelar mi cita" }
    : !active && siteUrl ? { href: siteUrl, label: k.cta || "Reservar" } : null;
  // Los correos no pueden mostrar SVG: se usa el PNG publicado por la app.
  const origin = siteUrl || (link ? new URL(link).origin : null);
  const logoUrl = origin && config.logos?.email ? `${origin}/${config.logos.email}` : null;
  const gold = config.theme?.accent || "#c9a227", ink = config.theme?.ink || "#1a1405";
  const bg = "#0b0a09", card = "#151311", line = "#2b2622", text = "#f3eee6", muted = "#a39a8e";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="dark light"><title>${esc(k.subject(ctx, config))}</title></head>
<body style="margin:0;padding:0;background:${bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};">
<tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:Helvetica,Arial,sans-serif;color:${text};">
  <tr><td align="center" style="padding:6px 0 22px;">
    ${logoUrl
      ? `<img src="${esc(logoUrl)}" width="140" height="140" alt="${esc(config.name)}" style="display:block;width:140px;height:auto;border:0;">`
      : `<div style="font:bold 18px Helvetica,Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${text};">${esc(config.name)}</div>
    <div style="margin-top:4px;font-size:11px;letter-spacing:4px;text-transform:uppercase;color:${gold};">${esc(config.tagline)}</div>`}
  </td></tr>
  <tr><td style="background:${card};border:1px solid ${gold};border-radius:18px;padding:30px 24px;">
    <div style="text-align:center;">
      <span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${mix(gold, 0.18)};color:${gold};font-size:12px;letter-spacing:1px;text-transform:uppercase;">${esc(k.badge)}</span>
      <h1 style="margin:18px 0 8px;font-size:24px;color:${text};">${esc(k.title(ctx))}</h1>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:${muted};">${esc(k.lead(ctx))}</p>
      <div style="font:bold 40px Helvetica,Arial,sans-serif;color:${text};">${esc(fmtTime(b.start))}</div>
      <div style="margin:4px 0 22px;font-size:15px;color:${muted};">${esc(cap(longDate(b.day)))}</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${line};">
      ${rows.map(([l, v]) => `<tr>
        <td style="padding:11px 0;border-bottom:1px solid ${line};font-size:13px;color:${muted};text-transform:uppercase;letter-spacing:1px;">${esc(l)}</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${line};font-size:15px;color:${text};">${esc(v)}</td>
      </tr>`).join("")}
    </table>
    ${button ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td align="center" style="border-radius:999px;background:${gold};">
      <a href="${esc(button.href)}" style="display:block;padding:15px 20px;color:${ink};font-weight:bold;font-size:15px;text-decoration:none;">${esc(button.label)}</a>
    </td></tr></table>` : ""}
    ${k.calendar ? `<p style="margin:16px 0 0;text-align:center;font-size:13px;color:${muted};">Adjuntamos la invitación para agregarla a tu calendario.</p>` : ""}
  </td></tr>
  <tr><td style="padding:22px 10px 0;text-align:center;font-size:13px;line-height:1.6;color:${muted};">
    ¿Dudas? Escríbenos por WhatsApp al <a href="https://wa.me/${esc(config.whatsapp)}" style="color:${gold};">${esc(config.phone.replace(/(\d{4})(\d{4})/, "$1 $2"))}</a><br>
    ${esc(config.location)}<br>
    <span style="font-size:11px;letter-spacing:3px;text-transform:uppercase;">${esc(config.slogan)}</span>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const textBody = [
    k.title(ctx), "", k.lead(ctx), "",
    ...rows.map(([l, v]) => `${l}: ${v}`),
    "", button ? `${button.label}: ${button.href}` : "",
    `WhatsApp: ${config.phone}`, config.name + " " + config.tagline,
  ].join("\n");

  const attachments = k.calendar
    ? [{ filename: "cita.ics", content: Buffer.from(ics(b, config, svc, ctx.brand)).toString("base64") }]
    : undefined;

  return { subject: k.subject(ctx, config), html, text: textBody, attachments };
}

// Invitación de calendario (.ics). Costa Rica no tiene horario de verano: UTC-6 todo el año.
function ics(b, config, svcNames, brand = config.name) {
  const pad = (n) => String(n).padStart(2, "0");
  const toUtc = (min) => {
    const d = new Date(`${b.day}T00:00:00-06:00`);
    d.setUTCMinutes(d.getUTCMinutes() + min);
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };
  const fold = (s) => s.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Barberia//Reservas//ES", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.id}@barberia`, `DTSTAMP:${now}`,
    `DTSTART:${toUtc(b.start)}`, `DTEND:${toUtc(b.start + b.minutes)}`,
    `SUMMARY:${fold(`${svcNames.join(" + ")} · ${brand}`)}`,
    `LOCATION:${fold(config.location)}`,
    `DESCRIPTION:${fold(`Reserva ${b.id}. WhatsApp: ${config.phone}`)}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Cita en la barbería", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

// Correo para restablecer la contraseña.
function renderReset(user, config, link) {
  const gold = config.theme?.accent || "#c9a227", ink = config.theme?.ink || "#1a1405", text = "#f3eee6", muted = "#a39a8e";
  const first = esc(user.name.split(" ")[0]);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#0b0a09;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0a09;"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:Helvetica,Arial,sans-serif;color:${text};">
<tr><td style="background:#151311;border:1px solid ${gold};border-radius:18px;padding:30px 24px;text-align:center;">
  <h1 style="margin:0 0 10px;font-size:22px;">Hola ${first}</h1>
  <p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:${muted};">Recibimos una solicitud para cambiar la contraseña de tu cuenta en ${esc(config.name)}. El enlace vence en 1 hora.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="border-radius:999px;background:${gold};">
    <a href="${esc(link)}" style="display:block;padding:15px 20px;color:${ink};font-weight:bold;font-size:15px;text-decoration:none;">Crear contraseña nueva</a>
  </td></tr></table>
  <p style="margin:18px 0 0;font-size:13px;color:${muted};">Si no lo pediste, ignora este correo: tu contraseña no cambia.</p>
</td></tr></table></td></tr></table></body></html>`;
  const textBody = `Hola ${user.name.split(" ")[0]},\n\nPara crear una contraseña nueva abre este enlace (vence en 1 hora):\n${link}\n\nSi no lo pediste, ignora este correo.`;
  return { subject: `Cambia tu contraseña · ${config.name}`, html, text: textBody };
}

module.exports = { render, renderReset, ics };
