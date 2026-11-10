(() => {
  "use strict";

  const STORE_KEY = "va-barberia-citas"; // [{id, token}] de las citas hechas en este celular

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let B, SERVICES, CATEGORIES;
  const byId = (id) => SERVICES.find((s) => s.id === id);

  const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const fmtMoney = (n) => (n == null ? "Consultar" : B.currency + n.toLocaleString("es-CR"));
  const fmtTime = (m) => {
    const h = Math.floor(m / 60), mm = m % 60;
    return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`;
  };
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}` : `${m} min`);
  const asDate = (day) => new Date(day + "T12:00:00");
  const weekday = (day) => asDate(day).getDay();
  const longDate = (day) => asDate(day).toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" });
  const STATUS_LABEL = {
    pendiente: "Pendiente de confirmación", confirmada: "Confirmada", rechazada: "No disponible",
    cancelada: "Cancelada", completada: "Completada", "no-asistio": "No asistió",
  };

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || "No pudimos conectar. Revisa tu internet."); e.status = res.status; throw e; }
    return data;
  }

  /* ---------------- Estado ---------------- */
  const state = { cart: [], category: "barberia", query: "", step: 1, day: null, slot: null, avail: null, availKey: "" };

  const loadMine = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } };
  const saveMine = (a) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(a)); } catch {} };

  const cartItems = () => state.cart.map(byId);
  const cartMinutes = () => cartItems().reduce((t, s) => t + s.min, 0);
  const cartTotal = () => {
    const items = cartItems();
    return items.some((s) => s.price == null) ? null : items.reduce((t, s) => t + s.price, 0);
  };

  function toggleService(id) {
    const s = byId(id);
    if (state.cart.includes(id)) { state.cart = state.cart.filter((x) => x !== id); }
    else {
      if (state.cart.length && byId(state.cart[0]).cat !== s.cat) {
        state.cart = [];
        toast("Barbería y salón se reservan por separado");
      }
      state.cart.push(id);
    }
    state.avail = null;
  }

  async function loadAvailability() {
    const key = state.cart.join(",");
    if (state.avail && state.availKey === key) return state.avail;
    const data = await api(`/api/availability?services=${encodeURIComponent(key)}&days=${B.daysAhead + 1}`);
    state.avail = data.days; state.availKey = key;
    return data.days;
  }

  /* ---------------- Inicio ---------------- */
  async function renderHome() {
    const hours = B.hours[weekday(B.today)];
    const now = B.nowMinutes;
    const open = hours && now >= hours[0] && now < hours[1];
    const st = $("#open-status");
    st.textContent = open ? `Abierto · cierra ${fmtTime(hours[1])}` : "Cerrado ahora";
    st.classList.toggle("is-open", !!open);

    $("#popular").innerHTML = SERVICES.filter((s) => s.popular).map(cardHTML).join("");
    $("#wa-link").href = `https://wa.me/${B.whatsapp}`;
    $("#phone-label").textContent = B.phone.replace(/(\d{4})(\d{4})/, "$1 $2");

    try {
      const { days } = await api("/api/availability?services=corte&days=1");
      const slots = days[0].slots;
      $("#today-count").textContent = slots.length ? `${slots.length} disponibles` : "Sin espacios";
      $("#today-slots").innerHTML = slots.length
        ? slots.slice(0, 12).map((m) => `<button class="slot" data-quick="${m}">${fmtTime(m)}</button>`).join("")
        : `<p class="empty">Hoy ya no hay espacios. Reserva para otro día.</p>`;
    } catch (e) {
      $("#today-count").textContent = "";
      $("#today-slots").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    }
  }

  const cardHTML = (s) => `
    <button class="card" data-book="${s.id}">
      <div class="card__body">
        <p class="card__title">${esc(s.name)}</p>
        <p class="card__meta">${fmtMin(s.min)}</p>
      </div>
      <span class="card__price">${fmtMoney(s.price)}</span>
    </button>`;

  const svcHTML = (s) => {
    const on = state.cart.includes(s.id);
    return `
    <div class="svc ${on ? "is-selected" : ""}">
      <button class="card" data-toggle="${s.id}" aria-pressed="${on}">
        <div class="card__body">
          <p class="card__title">${esc(s.name)}</p>
          <p class="card__meta">${fmtMin(s.min)} · <span class="card__price">${fmtMoney(s.price)}</span></p>
          <p class="svc__desc">${esc(s.desc)}</p>
        </div>
      </button>
      <span class="svc__add" aria-hidden="true">${on ? "✓" : "+"}</span>
    </div>`;
  };

  /* ---------------- Servicios ---------------- */
  function renderServices() {
    $("#cat-chips").innerHTML = CATEGORIES.map((c) =>
      `<button class="chip ${c.id === state.category ? "is-active" : ""}" data-cat="${c.id}" role="tab">${esc(c.name)}</button>`
    ).join("");
    const q = state.query.trim().toLowerCase();
    const list = SERVICES.filter((s) => (q ? s.name.toLowerCase().includes(q) : s.cat === state.category));
    $("#service-list").innerHTML = list.length
      ? list.map(svcHTML).join("")
      : `<p class="empty-state">No encontramos “${esc(state.query)}”.</p>`;
  }

  function renderCartbar() {
    const n = state.cart.length;
    const onServices = !$("#view-services").hidden;
    $("#cartbar").hidden = !(n && onServices) || !$("#flow").hidden;
    if (!n) return;
    $("#cart-count").textContent = n === 1 ? "1 servicio" : `${n} servicios`;
    $("#cart-total").textContent = `${fmtMoney(cartTotal())} · ${fmtMin(cartMinutes())}`;
  }

  /* ---------------- Mis citas ---------------- */
  async function renderAppointments() {
    const el = $("#appt-list");
    const mine = loadMine();
    if (!mine.length) {
      el.innerHTML = `<div class="empty-state"><p>Todavía no tienes citas.</p>
        <button class="btn btn--gold" data-action="start-booking">Reservar ahora</button></div>`;
      return;
    }
    el.innerHTML = `<p class="empty-state">Cargando…</p>`;
    const results = await Promise.all(mine.map((m) =>
      api(`/api/bookings/${encodeURIComponent(m.id)}?token=${encodeURIComponent(m.token)}`)
        .then((b) => ({ ...b, token: m.token }))
        .catch((e) => (e.status === 404 ? { gone: m.id } : null))));
    // Olvida las citas que el servidor ya no reconoce.
    const gone = results.filter((r) => r && r.gone).map((r) => r.gone);
    if (gone.length) saveMine(mine.filter((m) => !gone.includes(m.id)));
    const appts = results.filter((r) => r && !r.gone).sort((a, b) => (b.day + b.start).localeCompare(a.day + a.start));
    if (!appts.length) {
      el.innerHTML = results.includes(null)
        ? `<p class="empty-state">No pudimos cargar tus citas. Revisa tu internet.</p>`
        : `<div class="empty-state"><p>Todavía no tienes citas.</p><button class="btn btn--gold" data-action="start-booking">Reservar ahora</button></div>`;
      return;
    }
    const today = B.today;
    const upcoming = appts.filter((a) => a.day >= today && ["pendiente", "confirmada"].includes(a.status)).reverse();
    const rest = appts.filter((a) => !upcoming.includes(a));
    el.innerHTML = [...upcoming, ...rest].map((a) => {
      const active = upcoming.includes(a);
      const d = asDate(a.day);
      return `<article class="appt ${active ? "" : "is-past"}">
        <div class="appt__top">
          <span class="appt__when">${DOW[d.getDay()]} ${d.getDate()} · ${fmtTime(a.start)}</span>
          <span class="appt__tag appt__tag--${a.status}">${STATUS_LABEL[a.status] || a.status}</span>
        </div>
        <p class="appt__svc">${a.services.map((id) => esc(byId(id)?.name || id)).join(" + ")} · ${fmtMoney(a.total)}</p>
        ${active ? `<div class="appt__actions">
          <a class="btn btn--ghost" href="${calendarLink(a)}" target="_blank" rel="noopener">Agregar al calendario</a>
          <button class="btn btn--ghost" data-cancel="${esc(a.id)}">Cancelar</button>
        </div>` : ""}
      </article>`;
    }).join("");
  }

  /* ---------------- Navegación ---------------- */
  function go(view) {
    $$(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.goto === view));
    if (view === "home") renderHome();
    if (view === "services") renderServices();
    if (view === "appointments") renderAppointments();
    renderCartbar();
    window.scrollTo(0, 0);
  }

  /* ---------------- Flujo de reserva ---------------- */
  function openFlow({ step = 1, slot = null, day = null } = {}) {
    Object.assign(state, { step, day, slot });
    $("#flow").hidden = false;
    document.body.style.overflow = "hidden";
    renderFlow();
  }
  function closeFlow() {
    $("#flow").hidden = true;
    document.body.style.overflow = "";
    renderCartbar();
  }

  async function renderFlow() {
    const step = state.step;
    $$(".pane").forEach((p) => (p.hidden = p.dataset.pane !== String(step)));
    $$(".step").forEach((s) => s.classList.toggle("is-done", step === "done" || +s.dataset.step <= step));
    $("#flow-foot").hidden = step === "done";
    $("[data-action=flow-back]").style.visibility = step === 1 || step === "done" ? "hidden" : "visible";

    $("#foot-total").textContent = state.cart.length ? fmtMoney(cartTotal()) : "—";
    $("#foot-label").textContent = state.cart.length ? `Total · ${fmtMin(cartMinutes())}` : "Total";
    const next = $("#flow-next");

    if (step === 1) {
      $("#flow-services").innerHTML = CATEGORIES.map((c) =>
        `<p class="group">${esc(c.name)}</p>` + SERVICES.filter((s) => s.cat === c.id).map(svcHTML).join("")).join("");
      next.textContent = "Elegir día y hora";
      next.disabled = !state.cart.length;
    }

    if (step === 2) {
      $("#duration-note").textContent = `Tu cita dura ${fmtMin(cartMinutes())}. Te mostramos solo horas donde cabe completa.`;
      next.disabled = true;
      next.textContent = "Elige una hora";
      if (!state.avail) $("#slots").innerHTML = `<p class="no-slots">Buscando espacios…</p>`;
      let days;
      try { days = await loadAvailability(); }
      catch (e) { $("#slots").innerHTML = `<p class="no-slots">${esc(e.message)}</p>`; return; }
      if (state.step !== 2) return;

      if (!state.day || !days.some((d) => d.day === state.day && d.slots.length))
        state.day = (days.find((d) => d.slots.length) || days[0]).day;
      $("#days").innerHTML = days.map((d, i) => {
        const n = d.slots.length;
        const label = i === 0 ? "Hoy" : i === 1 ? "Mañana" : DOW[weekday(d.day)];
        const sub = B.hours[weekday(d.day)] ? (n ? `${n} libres` : "Lleno") : "Cerrado";
        return `<button class="day ${d.day === state.day ? "is-active" : ""}" data-day="${d.day}" ${n ? "" : "disabled"}>
          <small>${label}</small><strong>${asDate(d.day).getDate()}</strong><i>${sub}</i></button>`;
      }).join("");

      const slots = days.find((d) => d.day === state.day).slots;
      if (state.slot != null && !slots.includes(state.slot)) state.slot = null;
      const part = (from, to) => slots.filter((m) => m >= from && m < to);
      const sections = [["Mañana", part(0, 720)], ["Tarde", part(720, 1020)], ["Noche", part(1020, 1440)]].filter(([, s]) => s.length);
      $("#slots").innerHTML = sections.length
        ? sections.map(([t, s]) => `<div class="slot-group"><h3>${t}</h3><div class="slot-grid">
            ${s.map((m) => `<button class="slot ${m === state.slot ? "is-active" : ""}" data-slot="${m}">${fmtTime(m).replace(/ [ap]\.m\./, "")}</button>`).join("")}
          </div></div>`).join("")
        : `<p class="no-slots">No hay espacios disponibles en los próximos días. Escríbenos por WhatsApp.</p>`;
      requestAnimationFrame(() => $(".day.is-active")?.scrollIntoView({ inline: "center", block: "nearest" }));
      next.textContent = state.slot != null ? `Reservar ${fmtTime(state.slot)}` : "Elige una hora";
      next.disabled = state.slot == null;
    }

    if (step === 3) {
      $("#summary").innerHTML = `
        <p class="summary__when">${longDate(state.day)} · ${fmtTime(state.slot)}</p>
        ${cartItems().map((s) => `<div class="summary__row"><span>${esc(s.name)}</span><span>${fmtMoney(s.price)}</span></div>`).join("")}
        <div class="summary__row"><span>Termina aprox.</span><span>${fmtTime(state.slot + cartMinutes())}</span></div>`;
      $("#policy-list").innerHTML = B.policies.map((p) => `<li>${esc(p)}</li>`).join("");
      next.textContent = "Confirmar reserva";
      next.disabled = false;
    }
  }

  let submitting = false;
  async function submitBooking() {
    if (submitting) return;
    const form = $("#details");
    const name = form.name.value.trim();
    const phone = form.phone.value.replace(/\D/g, "");
    form.name.parentElement.classList.toggle("is-invalid", name.length < 2);
    form.phone.parentElement.classList.toggle("is-invalid", phone.length < 8);
    if (name.length < 2 || phone.length < 8) { toast("Revisa tu nombre y teléfono"); return; }

    submitting = true;
    const next = $("#flow-next");
    next.disabled = true; next.textContent = "Reservando…";
    try {
      const b = await api("/api/bookings", {
        method: "POST",
        body: { services: state.cart, day: state.day, start: state.slot, name, phone,
          note: form.note.value.trim(), website: form.website.value },
      });
      saveMine([...loadMine(), { id: b.id, token: b.token }]);
      try { localStorage.setItem("va-cliente", JSON.stringify({ name, phone: form.phone.value })); } catch {}
      showTicket(b, name);
      state.cart = []; state.avail = null;
      form.note.value = "";
    } catch (e) {
      toast(e.message);
      if (e.status === 409) { state.avail = null; state.slot = null; state.step = 2; renderFlow(); }
      else { next.disabled = false; next.textContent = "Confirmar reserva"; }
    } finally { submitting = false; }
  }

  function showTicket(a, fullName) {
    const svc = a.services.map((id) => byId(id).name).join(" + ");
    const msg = `Hola, soy ${fullName}. Acabo de reservar ${svc} para el ${longDate(a.day)} a las ${fmtTime(a.start)} (reserva ${a.id}).`;
    $("#ticket").innerHTML = `
      <div class="monogram" aria-hidden="true">VA</div>
      <h2>Cita reservada</h2>
      <span class="ticket__state">Pendiente de confirmación</span>
      <p class="ticket__time">${fmtTime(a.start)}</p>
      <p class="ticket__date">${longDate(a.day)}</p>
      <p class="ticket__svc">${esc(svc)} · ${fmtMoney(a.total)}</p>
      <div class="ticket__actions">
        <a class="btn btn--gold" target="_blank" rel="noopener"
           href="https://wa.me/${B.whatsapp}?text=${encodeURIComponent(msg)}">Avisar por WhatsApp</a>
        <a class="btn btn--ghost" target="_blank" rel="noopener" href="${calendarLink(a)}">Agregar al calendario</a>
        <button class="btn btn--ghost" data-action="done">Listo</button>
      </div>`;
    state.step = "done";
    renderFlow();
  }

  function calendarLink(a) {
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = (m) => a.day.replace(/-/g, "") + "T" + pad(Math.floor(m / 60)) + pad(m % 60) + "00";
    const p = new URLSearchParams({
      action: "TEMPLATE",
      text: `${a.services.map((id) => byId(id)?.name || id).join(" + ")} · ${B.name} Barbería`,
      dates: `${stamp(a.start)}/${stamp(a.start + a.minutes)}`,
      ctz: "America/Costa_Rica",
      location: B.location,
    });
    return `https://calendar.google.com/calendar/render?${p}`;
  }

  let toastTimer;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), 2800);
  }

  /* ---------------- Eventos ---------------- */
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("button, a");
    if (!el || !B) return;
    const ds = el.dataset;

    if (ds.goto) return go(ds.goto);
    if (ds.cat) { state.category = ds.cat; state.query = ""; $("#search").value = ""; return renderServices(); }
    if (ds.toggle) {
      toggleService(ds.toggle);
      $("#flow").hidden ? renderServices() : renderFlow();
      return renderCartbar();
    }
    if (ds.book) { state.cart = [ds.book]; state.avail = null; return openFlow({ step: 2 }); }
    if (ds.quick) { state.cart = ["corte"]; state.avail = null; return openFlow({ step: 2, day: B.today, slot: +ds.quick }); }
    if (ds.day) { state.day = ds.day; state.slot = null; return renderFlow(); }
    if (ds.slot) { state.slot = +ds.slot; return renderFlow(); }
    if (ds.cancel) {
      if (!confirm("¿Cancelar esta cita? El espacio quedará libre para otra persona.")) return;
      const m = loadMine().find((x) => x.id === ds.cancel);
      try {
        await api(`/api/bookings/${encodeURIComponent(m.id)}/cancel`, { method: "POST", body: { token: m.token } });
        toast("Cita cancelada");
      } catch (err) { toast(err.message); }
      return renderAppointments();
    }

    switch (ds.action) {
      case "start-booking": return openFlow({ step: state.cart.length ? 2 : 1 });
      case "flow-close": return closeFlow();
      case "flow-back": state.step = Math.max(1, state.step - 1); return renderFlow();
      case "flow-next":
        if (state.step === 3) return submitBooking();
        state.step += 1;
        if (state.step === 3) prefill();
        return renderFlow();
      case "done": closeFlow(); return go("appointments");
      case "retry": return boot();
    }
  });

  function prefill() {
    try {
      const c = JSON.parse(localStorage.getItem("va-cliente"));
      const f = $("#details");
      if (c && !f.name.value) { f.name.value = c.name || ""; f.phone.value = c.phone || ""; }
    } catch {}
  }

  $("#search").addEventListener("input", (e) => { state.query = e.target.value; renderServices(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#flow").hidden) closeFlow(); });

  async function boot() {
    const err = $("#boot-error");
    try {
      const cfg = await api("/api/config");
      B = cfg; SERVICES = cfg.services; CATEGORIES = cfg.categories;
      err.hidden = true;
      go("home");
    } catch (e) {
      $("#boot-error p").textContent = e.message;
      err.hidden = false;
      B = B || {}; // permite que funcione el botón Reintentar
    }
  }
  boot();
})();
