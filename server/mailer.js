"use strict";
// Envío de correos con Resend (https://resend.com), mediante su API HTTP. No usa dependencias.
// Variables: RESEND_API_KEY, EMAIL_FROM y, si quieres, EMAIL_REPLY_TO.
// Sin RESEND_API_KEY los correos no se envían: solo se registran en la consola.

function createMailer(env = process.env, fetchImpl = globalThis.fetch) {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  const replyTo = env.EMAIL_REPLY_TO;
  const enabled = Boolean(key && from);

  // replyTo por correo (el del negocio) tiene prioridad sobre EMAIL_REPLY_TO.
  async function send({ to, subject, html, text, attachments, replyTo: perMail }) {
    if (!enabled) {
      console.log(`[correo desactivado] para ${to}: ${subject}`);
      return { skipped: true };
    }
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject, html, text,
        ...((perMail || replyTo) ? { reply_to: perMail || replyTo } : {}),
        ...(attachments ? { attachments } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Resend respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  return { enabled, send };
}

module.exports = { createMailer };
