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
  let emailEnabled = false;
  const shown = new Map(); // citas en pantalla, por id

  const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const asDate = (day) => new Date(day + "T12:00:00");
  const addDays = (day, n) => { const d = asDate(day); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
  const longDate = (day) => asDate(day).toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" });
  const fmtTime = (m) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m < 720 ? "a.m." : "p.m."}`;
  const fmtMoney = (n) => (n == null ? "Consultar" : C.currency + n.toLocaleString("es-CR"));
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const svcNames = (ids) => ids.map((id) => C.services.find((s) => s.id === id)?.name
    || (C.retired || []).find((s) => s.id === id)?.name || id).join(" + ");
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
    shown.set(b.id, b);
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
      ${b.email ? `<p class="bk__meta">✉ ${esc(b.email)}</p>` : ""}
      ${b.note ? `<p class="bk__note">${esc(b.note)}</p>` : ""}
      ${actions.length ? `<div class="bk__actions">${actions.join("")}</div>` : ""}
    </article>`;
  }

  /* ---------- Agenda ---------- */
  async function renderAgenda() {
    agendaDay = agendaDay || C.today;
    const days = Array.from({ length: C.daysAhead + 1 }, (_, i) => addDays(C.today, i - 1));
    // Horario de cada categoría para el rango visible
    const sched = {};
    await Promise.all(C.categories.map(async (c) => {
      const r = await api(`/api/admin/schedule?category=${c.id}&from=${days[0]}&to=${days.at(-1)}`);
      sched[c.id] = Object.fromEntries(r.days.map((d) => [d.day, d.ranges]));
    }));
    const openAny = (d) => C.categories.some((c) => (sched[c.id][d] || []).length);
    $("#adm-days").innerHTML = days.map((d) => `<button class="day ${d === agendaDay ? "is-active" : ""}" data-aday="${d}">
      <small>${d === C.today ? "Hoy" : DOW[asDate(d).getDay()]}</small><strong>${asDate(d).getDate()}</strong><i>${openAny(d) ? "" : "Cerrado"}</i></button>`).join("");
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
    const hoursLine = C.categories.map((c) => {
      const r = sched[c.id][agendaDay] || [];
      return `${esc(c.name)}: ${r.length ? rangesText(r) : "cerrado"}`;
    }).join(" · ");
    $("#agenda-list").innerHTML = `<p class="adm-hint" style="margin:0">${hoursLine}</p>` +
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
      if (v === "schedule") await renderSchedule();
      if (v === "services") await renderSvcAdmin();
    } catch (e) { toast(e.message); }
    renderSelbar();
  }

  async function refreshBadge() {
    try {
      const { pending, today, emailEnabled: mailOn } = await api("/api/admin/summary");
      C.today = today; emailEnabled = mailOn;
      $("#new-email").hidden = !mailOn;
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
      // Si el cliente dejó correo, el aviso le llega por ahí. Si no, abrimos WhatsApp
      // (la ventana se abre antes del await para que el navegador no la bloquee).
      const known = shown.get(ds.id);
      const viaEmail = emailEnabled && known && known.email;
      const notifies = ["confirmada", "rechazada", "cancelada"].includes(status);
      const win = notifies && !viaEmail && known && known.phone ? window.open("", "_blank") : null;
      try {
        const b = await api(`/api/admin/bookings/${ds.id}`, { method: "PATCH", body: { status } });
        const link = waLink(b, status);
        if (win && link) win.location = link; else if (win) win.close();
        toast(b.emailed ? `Cita ${STATUS[status]} · correo enviado al cliente` : `Cita ${STATUS[status]}`);
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
      case "cal-prev": calMonth = shiftMonth(calMonth, -1); return renderSchedule();
      case "cal-next": calMonth = shiftMonth(calMonth, 1); return renderSchedule();
      case "sel-clear": selected.clear(); return renderSchedule();
      case "edit-days": return openDayEditor();
      case "edit-week": return openWeekEditor();
      case "close-sheet": $("#day-editor").hidden = true; $("#week-editor").hidden = true; $("#svc-editor").hidden = true; return;
      case "svc-new": return openSvcEditor(null);
      case "svc-save": return saveSvc();
      case "svc-delete": return deleteSvc();
      case "add-range": return addRangeRow(el.closest(".ranges"));
      case "del-range": el.closest(".range").remove(); return;
      case "days-save": return saveDays(false);
      case "days-reset": return saveDays(true);
      case "week-save": return saveWeek();
    }
    if (ds.cal) {
      selected.has(ds.cal) ? selected.delete(ds.cal) : selected.add(ds.cal);
      return renderSchedule();
    }
    if (ds.schcat) { schCategory = ds.schcat; selected.clear(); return renderSchedule(); }
    if (ds.svcEdit) return openSvcEditor(ds.svcEdit);
    if (ds.svcMove) return moveSvc(ds.svcId, Number(ds.svcMove));
  });

  /* ---------- Servicios ---------- */
  let svcList = [];
  let svcEditing = null;
  const fmtMinutes = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}` : `${m} min`);

  async function reloadConfig() { C = { ...C, ...(await api("/api/config")) }; }

  async function renderSvcAdmin() {
    svcList = (await api("/api/admin/services")).services;
    const el = $("#svc-list");
    el.innerHTML = C.categories.map((c) => {
      const items = svcList.filter((s) => s.category === c.id);
      return `<p class="group">${esc(c.name)} · ${items.filter((s) => s.active).length} visibles</p>` + (items.length
        ? items.map((s) => `<div class="svc-row ${s.active ? "" : "is-hidden"}">
            <button class="svc-row__main" data-svc-edit="${esc(s.id)}">
              <strong>${esc(s.name)}${s.popular ? ' <span class="tag tag--gold">Destacado</span>' : ""}${s.active ? "" : ' <span class="tag">Oculto</span>'}</strong>
              <small>${fmtMinutes(s.minutes)} · ${fmtMoney(s.price)}</small>
            </button>
            <div class="svc-row__move">
              <button class="iconbtn" data-svc-move="-1" data-svc-id="${esc(s.id)}" aria-label="Subir">↑</button>
              <button class="iconbtn" data-svc-move="1" data-svc-id="${esc(s.id)}" aria-label="Bajar">↓</button>
            </div>
          </div>`).join("")
        : `<p class="adm-hint" style="margin:0">Sin servicios en esta categoría.</p>`);
    }).join("");
  }

  function openSvcEditor(id) {
    svcEditing = id ? svcList.find((s) => s.id === id) : null;
    const s = svcEditing || { name: "", category: C.categories[0].id, minutes: 45, price: null, description: "", popular: false, active: true };
    const f = $("#svc-form");
    $("#se-title").textContent = svcEditing ? "Editar servicio" : "Nuevo servicio";
    $("#se-cat").innerHTML = C.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    const mins = new Set([...Array.from({ length: 48 }, (_, i) => (i + 1) * 5).filter((m) => m <= 120 || m % 15 === 0), ...Array.from({ length: 12 }, (_, i) => 135 + i * 15), s.minutes]);
    $("#se-min").innerHTML = [...mins].sort((a, b) => a - b).map((m) => `<option value="${m}">${fmtMinutes(m)}</option>`).join("");
    f.name.value = s.name; f.category.value = s.category; f.minutes.value = String(s.minutes);
    f.price.value = s.price ?? ""; f.description.value = s.description || "";
    f.popular.checked = s.popular; f.active.checked = s.active;
    $("#se-delete").hidden = !svcEditing;
    $("#svc-editor").hidden = false;
    setTimeout(() => !svcEditing && f.name.focus(), 50);
  }

  async function saveSvc() {
    const f = $("#svc-form");
    const body = { name: f.name.value, category: f.category.value, minutes: Number(f.minutes.value),
      price: f.price.value === "" ? null : Number(f.price.value), description: f.description.value,
      popular: f.popular.checked, active: f.active.checked };
    try {
      if (svcEditing) await api(`/api/admin/services/${encodeURIComponent(svcEditing.id)}`, { method: "PUT", body });
      else await api("/api/admin/services", { method: "POST", body });
      $("#svc-editor").hidden = true;
      toast(svcEditing ? "Servicio actualizado" : "Servicio creado");
      await reloadConfig();
      renderSvcAdmin();
    } catch (err) { toast(err.message); }
  }

  async function deleteSvc() {
    if (!svcEditing || !confirm(`¿Borrar “${svcEditing.name}”? Esta acción no se puede deshacer.`)) return;
    try {
      await api(`/api/admin/services/${encodeURIComponent(svcEditing.id)}`, { method: "DELETE" });
      $("#svc-editor").hidden = true;
      toast("Servicio borrado");
      await reloadConfig();
      renderSvcAdmin();
    } catch (err) {
      // Tiene citas: ofrecer ocultarlo
      if (confirm(err.message + "\n\n¿Ocultarlo ahora?")) {
        $("#svc-form").active.checked = false;
        saveSvc();
      }
    }
  }

  async function moveSvc(id, dir) {
    const i = svcList.findIndex((s) => s.id === id);
    // Solo se mueve dentro de su categoría
    let j = i + dir;
    while (j >= 0 && j < svcList.length && svcList[j].category !== svcList[i].category) j += dir;
    if (j < 0 || j >= svcList.length) return;
    const ids = svcList.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api("/api/admin/services-order", { method: "PUT", body: { ids } });
      await reloadConfig();
      renderSvcAdmin();
    } catch (err) { toast(err.message); }
  }

  /* ---------- Horario ---------- */
  let schCategory = null;
  let calMonth = null;          // "YYYY-MM"
  let sched = null;             // respuesta de /api/admin/schedule
  const selected = new Set();   // días seleccionados
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const DOW_LONG = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const shortT = (m) => { const h = ((Math.floor(m / 60) + 11) % 12) + 1; return m % 60 ? `${h}:${String(m % 60).padStart(2, "0")}` : `${h}`; };
  const rangesText = (r) => r.map(([a, b]) => `${fmtTime(a)} – ${fmtTime(b)}`).join(", ");
  const shiftMonth = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

  async function renderSchedule() {
    schCategory = schCategory || C.categories[0].id;
    calMonth = calMonth || C.today.slice(0, 7);
    const minMonth = C.today.slice(0, 7), maxMonth = shiftMonth(minMonth, 4);
    if (calMonth < minMonth) calMonth = minMonth;
    if (calMonth > maxMonth) calMonth = maxMonth;

    $("#sch-cats").innerHTML = C.categories.map((c) =>
      `<button class="${c.id === schCategory ? "is-active" : ""}" data-schcat="${c.id}" role="tab">${esc(c.name)}</button>`).join("");

    const first = calMonth + "-01";
    const last = addDays(shiftMonth(calMonth, 1) + "-01", -1);
    sched = await api(`/api/admin/schedule?category=${schCategory}&from=${first}&to=${last}`);
    const byDay = Object.fromEntries(sched.days.map((d) => [d.day, d]));

    const [y, m] = calMonth.split("-").map(Number);
    $("#cal-title").textContent = new Date(y, m - 1, 1).toLocaleDateString("es-CR", { month: "long", year: "numeric" });
    $("[data-action=cal-prev]").disabled = calMonth <= minMonth;
    $("[data-action=cal-next]").disabled = calMonth >= maxMonth;

    const lead = (asDate(first).getDay() + 6) % 7; // lunes primero
    const cells = Array.from({ length: lead }, () => `<span></span>`);
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const info = byDay[d];
      const past = d < C.today;
      const open = info.ranges.length > 0;
      const label = open ? `${shortT(info.ranges[0][0])}–${shortT(info.ranges.at(-1)[1])}` : "Cerrado";
      cells.push(`<button class="cal__day ${open ? "is-open" : "is-closed"} ${info.special ? "is-special" : ""} ${selected.has(d) ? "is-sel" : ""} ${d === C.today ? "is-today" : ""}"
        data-cal="${d}" ${past ? "disabled" : ""} aria-pressed="${selected.has(d)}" aria-label="${longDate(d)}: ${open ? rangesText(info.ranges) : "cerrado"}">
        <b>${asDate(d).getDate()}</b><small>${label}</small>${info.bookings ? `<em>${info.bookings}</em>` : ""}</button>`);
    }
    $("#cal-grid").innerHTML = cells.join("");

    $("#week-summary").innerHTML = WEEK_ORDER.map((wd) => {
      const r = sched.week[wd] || [];
      return `<div class="week-row"><span>${DOW_LONG[wd]}</span><span class="${r.length ? "" : "muted"}">${r.length ? rangesText(r) : "Cerrado"}</span></div>`;
    }).join("");
    renderSelbar();
  }

  function renderSelbar() {
    const n = selected.size;
    $("#selbar").hidden = !(view === "schedule" && n);
    $("#sel-count").textContent = n === 1 ? longDate([...selected][0]) : `${n} días seleccionados`;
  }

  /* Editor de turnos reutilizable */
  function rangesHTML(ranges) {
    const rows = (ranges.length ? ranges : [[540, 1140]]).map(([a, b]) => rangeRow(a, b)).join("");
    return `<div class="ranges">${rows}<button type="button" class="link add-range" data-action="add-range">+ Agregar turno</button></div>`;
  }
  const rangeRow = (a, b) => `<div class="range">
      <input type="time" step="900" value="${hhmm(a)}" aria-label="Desde" /><span>a</span>
      <input type="time" step="900" value="${hhmm(b)}" aria-label="Hasta" />
      <button type="button" class="iconbtn" data-action="del-range" aria-label="Quitar turno">×</button></div>`;
  function addRangeRow(box) {
    const rows = $$(".range", box);
    if (rows.length >= 4) return toast("Máximo 4 turnos por día");
    const lastEnd = rows.length ? toMin($$("input", rows.at(-1))[1].value || "12:00") : 540;
    const a = Math.min(lastEnd + 60, 1380), b = Math.min(a + 180, 1440);
    box.querySelector(".add-range").insertAdjacentHTML("beforebegin", rangeRow(a, b));
  }
  function readRanges(box) {
    const out = [];
    for (const row of $$(".range", box)) {
      const [f, t] = $$("input", row);
      if (!f.value || !t.value) throw new Error("Completa las horas de cada turno");
      out.push([toMin(f.value), t.value === "00:00" ? 1440 : toMin(t.value)]);
    }
    if (!out.length) throw new Error("Agrega al menos un turno o apaga “Se trabaja”");
    return out;
  }

  function openDayEditor() {
    const days = [...selected].sort();
    if (!days.length) return;
    const infos = days.map((d) => sched.days.find((x) => x.day === d)).filter(Boolean);
    const one = infos.length === 1 ? infos[0] : null;
    const catName = C.categories.find((c) => c.id === schCategory).name;
    $("#de-title").textContent = one ? longDate(one.day) : `${days.length} días`;
    $("#de-sub").textContent = one
      ? `${catName} · ${one.special ? "Horario cambiado solo para este día" : "Usa el horario semanal"}${one.bookings ? ` · ${one.bookings} cita(s)` : ""}`
      : `${catName} · ${days.map((d) => `${DOW[asDate(d).getDay()]} ${asDate(d).getDate()}`).join(", ")}`;
    const base = one ? one.ranges : (infos.find((i) => i.ranges.length) || { ranges: [] }).ranges;
    const open = one ? one.ranges.length > 0 : true;
    $("#de-open").checked = open;
    $("#de-ranges").innerHTML = rangesHTML(base);
    $("#de-ranges").hidden = !open;
    $("#de-warn").hidden = true;
    $("[data-action=days-reset]").hidden = one ? !one.special : !infos.some((i) => i.special);
    $("#day-editor").hidden = false;
  }
  $("#de-open").addEventListener("change", (e) => { $("#de-ranges").hidden = !e.target.checked; });

  async function saveDays(reset) {
    let ranges = null;
    try { if (!reset) ranges = $("#de-open").checked ? readRanges($("#de-ranges")) : []; }
    catch (err) { return toast(err.message); }
    const days = [...selected].sort();
    try {
      const r = await api("/api/admin/schedule/days", { method: "PUT", body: { category: schCategory, days, ranges } });
      $("#day-editor").hidden = true;
      selected.clear();
      await renderSchedule();
      if (r.outside.length) {
        alert(`Atención: ${r.outside.length} cita(s) quedan fuera del nuevo horario y NO se cancelaron:\n\n` +
          r.outside.map((b) => `• ${DOW[asDate(b.day).getDay()]} ${asDate(b.day).getDate()}, ${fmtTime(b.start)} — ${b.name}`).join("\n") +
          `\n\nRevísalas en la Agenda para avisar al cliente o cancelarlas.`);
      } else {
        toast(reset ? "Horario semanal restablecido" : ranges.length ? "Días abiertos con ese horario" : "Días cerrados");
      }
    } catch (err) { toast(err.message); }
  }

  function openWeekEditor() {
    $("#we-days").innerHTML = WEEK_ORDER.map((wd) => {
      const r = sched.week[wd] || [];
      return `<div class="we-day" data-wd="${wd}">
        <label class="switch-row"><span><strong>${DOW_LONG[wd]}</strong></span>
          <input type="checkbox" class="switch" ${r.length ? "checked" : ""} /></label>
        <div class="we-ranges" ${r.length ? "" : "hidden"}>${rangesHTML(r)}</div>
      </div>`;
    }).join("");
    $$("#we-days .switch").forEach((sw) => sw.addEventListener("change", () => {
      sw.closest(".we-day").querySelector(".we-ranges").hidden = !sw.checked;
    }));
    $("#week-editor").hidden = false;
  }

  async function saveWeek() {
    const week = {};
    try {
      for (const el of $$("#we-days .we-day")) {
        const wd = Number(el.dataset.wd);
        week[wd] = el.querySelector(".switch").checked ? readRanges(el.querySelector(".ranges")) : [];
        if (!week[wd].length && el.querySelector(".switch").checked) throw new Error("Revisa los turnos");
      }
    } catch (err) { return toast(err.message); }
    try {
      await api("/api/admin/schedule/week", { method: "PUT", body: { category: schCategory, week } });
      $("#week-editor").hidden = true;
      toast("Horario semanal guardado");
      renderSchedule();
    } catch (err) { toast(err.message); }
  }

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
        phone: f.phone.value, email: f.email.value, note: f.note.value, force: f.force.checked } });
      toast(f.email.value && emailEnabled ? "Cita guardada · confirmación enviada" : "Cita guardada");
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
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    await refreshBadge();
    go(view);
    clearInterval(poll);
    poll = setInterval(refreshBadge, 30000);
  }

  if (localStorage.getItem(TOKEN_KEY)) start(); else logout();
})();
