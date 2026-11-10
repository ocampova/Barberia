(() => {
  "use strict";
  const TOKEN_KEY = "va-admin-token";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let C; // configuración del negocio
  let view = "pending";
  let agendaDay;
  let lastPending = null;

  const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const asDate = (day) => new Date(day + "T12:00:00");
  const addDays = (day, n) => { const d = asDate(day); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
  const longDate = (day) => asDate(day).toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" });
  const fmtTime = (m) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m < 720 ? "a.m." : "p.m."}`;
  const fmtMoney = (n) => (n == null ? "Consultar" : C.currency + n.toLocaleString("es-CR"));
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const svcNames = (ids) => ids.map((id) => C.services.find((s) => s.id === id)?.name || id).join(" + ");
  const STATUS = { pendiente: "pendiente", confirmada: "confirmada", rechazada: "rechazada", cancelada: "cancelada", completada: "completada", "no-asistio": "no asistió" };

  /* ---------- API ---------- */
  async function api(path, opts = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith("/login")) { logout(); throw new Error(data.error || "Sesión vencida"); }
    if (!res.ok) throw new Error(data.error || "Error de conexión");
    return data;
  }

  /* ---------- Sesión ---------- */
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    $("#panel").hidden = true; $("#login").hidden = false;
  }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const { token } = await api("/api/admin/login", { method: "POST", body: { pin: e.target.pin.value } });
      localStorage.setItem(TOKEN_KEY, token);
      e.target.reset();
      start();
    } catch (err) { toast(err.message); }
  });

  /* ---------- WhatsApp ---------- */
  function waLink(b, kind) {
    if (!b.phone) return null;
    const first = b.name.split(" ")[0];
    const when = `el ${longDate(b.day)} a las ${fmtTime(b.start)}`;
    const text = {
      confirmada: `¡Hola ${first}! Tu cita en ${C.name} Barbería para ${svcNames(b.services)} quedó CONFIRMADA ${when} ¡Te esperamos! 💈`,
      rechazada: `Hola ${first}, lamentablemente no podemos atenderte ${when} ¿Te sirve otro horario? Puedes reservar de nuevo en la app.`,
      recordatorio: `¡Hola ${first}! Te recordamos tu cita en ${C.name} Barbería ${when} ¡Te esperamos!`,
      cancelada: `Hola ${first}, tuvimos que cancelar tu cita ${when} Disculpa las molestias, reserva otro espacio cuando gustes.`,
    }[kind] || "";
    return `https://wa.me/${b.phone}?text=${encodeURIComponent(text)}`;
  }

  /* ---------- Pendientes ---------- */
  async function renderPending() {
    const el = $("#pending-list");
    const { bookings } = await api(`/api/admin/bookings?from=${C.today}&to=${addDays(C.today, C.daysAhead + 1)}&status=pendiente`);
    el.innerHTML = bookings.length
      ? bookings.map((b) => bookingHTML(b, true)).join("")
      : `<p class="empty-state">No hay citas por confirmar. 👌</p>`;
  }

  function bookingHTML(b, showDate) {
    const done = !["pendiente", "confirmada"].includes(b.status);
    const actions = [];
    if (b.status === "pendiente") {
      actions.push(`<button class="btn btn--gold" data-set="confirmada" data-id="${b.id}">Confirmar</button>`);
      actions.push(`<button class="btn btn--ghost" data-set="rechazada" data-id="${b.id}">Rechazar</button>`);
    }
    if (b.status === "confirmada") {
      actions.push(`<button class="btn btn--ghost" data-set="completada" data-id="${b.id}">Atendido</button>`);
      actions.push(`<button class="btn btn--ghost" data-set="no-asistio" data-id="${b.id}">No vino</button>`);
      if (b.phone) actions.push(`<a class="btn btn--ghost" target="_blank" rel="noopener" href="${waLink(b, "recordatorio")}">Recordar</a>`);
      actions.push(`<button class="btn btn--ghost" data-set="cancelada" data-id="${b.id}">Cancelar</button>`);
    }
    if (done && b.status !== "completada") actions.push(`<button class="btn btn--ghost" data-set="confirmada" data-id="${b.id}">Reactivar</button>`);
    const local = b.phone.startsWith("506") && b.phone.length === 11 ? b.phone.slice(3).replace(/(\d{4})(\d{4})/, "$1 $2") : "+" + b.phone;
    const phone = b.phone ? `<a class="link" href="tel:+${esc(b.phone)}">${esc(local)}</a>` : "sin teléfono";
    return `<article class="bk bk--${b.status} ${done ? "bk--done" : ""}">
      <div class="bk__top">
        <span class="bk__time">${showDate ? DOW[asDate(b.day).getDay()] + " " + asDate(b.day).getDate() + " · " : ""}${fmtTime(b.start)} – ${fmtTime(b.start + b.minutes)}</span>
        <span class="bk__status bk__status--${b.status}">${STATUS[b.status]}</span>
      </div>
      <p class="bk__name">${esc(b.name)}</p>
      <p class="bk__meta">${esc(svcNames(b.services))} · ${fmtMoney(b.total)}</p>
      <p class="bk__meta">${phone}${b.source === "panel" ? " · agregada en el panel" : ""}</p>
      ${b.note ? `<p class="bk__note">${esc(b.note)}</p>` : ""}
      ${actions.length ? `<div class="bk__actions">${actions.join("")}</div>` : ""}
    </article>`;
  }

  /* ---------- Agenda ---------- */
  async function renderAgenda() {
    agendaDay = agendaDay || C.today;
    const days = Array.from({ length: C.daysAhead + 1 }, (_, i) => addDays(C.today, i - 1));
    $("#adm-days").innerHTML = days.map((d) => `<button class="day ${d === agendaDay ? "is-active" : ""}" data-aday="${d}">
      <small>${d === C.today ? "Hoy" : DOW[asDate(d).getDay()]}</small><strong>${asDate(d).getDate()}</strong><i>${C.hours[asDate(d).getDay()] ? "" : "Cerrado"}</i></button>`).join("");
    requestAnimationFrame(() => $(".adm-days .is-active")?.scrollIntoView({ inline: "center", block: "nearest" }));
    $("#adm-dayname").textContent = longDate(agendaDay);

    const { bookings, blocks } = await api(`/api/admin/bookings?from=${agendaDay}&to=${agendaDay}`);
    const items = [
      ...bookings.map((b) => ({ t: b.start, html: bookingHTML(b, false) })),
      ...blocks.map((k) => ({ t: k.start, html: `<article class="bk bk--block">
        <div class="bk__top"><span class="bk__time">${fmtTime(k.start)} – ${fmtTime(k.end)}</span><span class="bk__status">bloqueado</span></div>
        <p class="bk__meta">${esc(k.reason || "Sin motivo")} · ${k.category ? esc(C.categories.find((c) => c.id === k.category)?.name) : "Todo el negocio"}</p>
        <div class="bk__actions"><button class="btn btn--ghost" data-unblock="${k.id}">Quitar bloqueo</button></div></article>` })),
    ].sort((a, b) => a.t - b.t);
    const h = C.hours[asDate(agendaDay).getDay()];
    $("#agenda-list").innerHTML = (h ? `<p class="adm-hint" style="margin:0">Horario: ${fmtTime(h[0])} – ${fmtTime(h[1])}</p>` : `<p class="adm-hint" style="margin:0">Cerrado este día.</p>`) +
      (items.length ? items.map((i) => i.html).join("") : `<p class="empty-state">Agenda libre.</p>`);
  }

  /* ---------- Navegación ---------- */
  async function go(v) {
    view = v;
    $$("#panel .view").forEach((el) => (el.hidden = el.dataset.view !== v));
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.goto === v));
    window.scrollTo(0, 0);
    try {
      if (v === "pending") await renderPending();
      if (v === "agenda") await renderAgenda();
    } catch (e) { toast(e.message); }
  }

  async function refreshBadge() {
    try {
      const { pending, today } = await api("/api/admin/summary");
      C.today = today;
      const badge = $("#badge");
      badge.hidden = !pending; badge.textContent = pending;
      document.title = (pending ? `(${pending}) ` : "") + "Panel · Barbería";
      if (lastPending != null && pending > lastPending) {
        toast("Nueva reserva por confirmar");
        if ("Notification" in window && Notification.permission === "granted") new Notification("Nueva reserva", { body: "Tienes citas por confirmar." });
        if (view === "pending") renderPending();
      }
      lastPending = pending;
    } catch {}
  }

  /* ---------- Eventos ---------- */
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("button, a");
    if (!el) return;
    const ds = el.dataset;
    if (ds.goto) return go(ds.goto);
    if (ds.aday) { agendaDay = ds.aday; return renderAgenda().catch((err) => toast(err.message)); }
    if (ds.set) {
      const status = ds.set;
      if (["cancelada", "rechazada"].includes(status) && !confirm(`¿Marcar como ${STATUS[status]}?`)) return;
      // Abrimos la ventana antes del await para que el navegador no la bloquee.
      const win = ["confirmada", "rechazada", "cancelada"].includes(status) ? window.open("", "_blank") : null;
      try {
        const b = await api(`/api/admin/bookings/${ds.id}`, { method: "PATCH", body: { status } });
        const link = waLink(b, status);
        if (win && link) win.location = link; else if (win) win.close();
        toast(`Cita ${STATUS[status]}`);
      } catch (err) { if (win) win.close(); toast(err.message); }
      refreshBadge();
      return go(view);
    }
    if (ds.unblock) {
      if (!confirm("¿Quitar este bloqueo?")) return;
      try { await api(`/api/admin/blocks/${ds.unblock}`, { method: "DELETE" }); toast("Bloqueo quitado"); } catch (err) { toast(err.message); }
      return renderAgenda();
    }
    switch (ds.action) {
      case "logout": return logout();
      case "new-booking": return openNew();
      case "close-new": $("#new-booking").hidden = true; return;
      case "whole-day": {
        const f = $("#block-form"); const day = f.day.value;
        const h = day && C.hours[asDate(day).getDay()];
        if (!h) return toast(day ? "Ese día ya está cerrado" : "Elige primero el día");
        const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        f.from.value = hhmm(h[0]); f.to.value = hhmm(h[1]);
        return;
      }
    }
  });

  $("#block-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("/api/admin/blocks", { method: "POST", body: {
        day: f.day.value, start: toMin(f.from.value), end: toMin(f.to.value), category: f.category.value || null, reason: f.reason.value } });
      toast("Horario bloqueado");
      agendaDay = f.day.value; f.reset(); go("agenda");
    } catch (err) { toast(err.message); }
  });

  function openNew() {
    const f = $("#new-form");
    f.reset();
    f.day.value = agendaDay || C.today;
    $("#new-services").innerHTML = C.services.map((s) =>
      `<label class="adm-check"><input type="checkbox" name="svc" value="${s.id}" /> ${esc(s.name)} · ${s.min} min</label>`).join("");
    $("#new-booking").hidden = false;
  }

  $("#new-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const services = $$("input[name=svc]:checked", f).map((i) => i.value);
    if (!services.length) return toast("Elige al menos un servicio");
    try {
      await api("/api/admin/bookings", { method: "POST", body: {
        services, day: f.day.value, start: toMin(f.time.value), name: f.name.value,
        phone: f.phone.value, note: f.note.value, force: f.force.checked } });
      toast("Cita guardada");
      $("#new-booking").hidden = true;
      agendaDay = f.day.value; go("agenda");
    } catch (err) { toast(err.message); }
  });

  let toastTimer;
  function toast(text) {
    const t = $("#toast"); t.textContent = text; t.classList.add("is-on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("is-on"), 2800);
  }

  let poll;
  async function start() {
    $("#login").hidden = true; $("#panel").hidden = false;
    try { C = await api("/api/config"); } catch (e) { return toast(e.message); }
    $("#block-cat").innerHTML = `<option value="">Todo el negocio</option>` +
      C.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    await refreshBadge();
    go(view);
    clearInterval(poll);
    poll = setInterval(refreshBadge, 30000);
  }

  if (localStorage.getItem(TOKEN_KEY)) start(); else logout();
})();
