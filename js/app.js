(() => {
  "use strict";

  const B = window.BUSINESS;
  const SERVICES = window.SERVICES;
  const CATEGORIES = window.CATEGORIES;
  const STORE_KEY = "va-barberia-citas";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const byId = (id) => SERVICES.find((s) => s.id === id);

  const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const fmtMoney = (n) => (n == null ? "Consultar" : B.currency + n.toLocaleString("es-CR"));
  const fmtTime = (m) => {
    const h = Math.floor(m / 60), mm = m % 60;
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${String(mm).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`;
  };
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}` : `${m} min`);
  const dayKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const longDate = (d) => d.toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" });
  const nowMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  /* ---------------- Estado ---------------- */
  const state = {
    cart: new Set(),
    category: "barberia",
    query: "",
    step: 1,
    day: null,
    slot: null,
  };

  const loadAppts = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } };
  const saveAppts = (a) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(a)); } catch {} };

  const cartItems = () => [...state.cart].map(byId);
  const cartMinutes = () => cartItems().reduce((t, s) => t + s.min, 0);
  const cartTotal = () => {
    const items = cartItems();
    if (items.some((s) => s.price == null)) return null;
    return items.reduce((t, s) => t + s.price, 0);
  };

  /* ---------------- Disponibilidad (simulada) ----------------
     Sin backend todavía: se generan espacios ocupados de forma determinista por fecha
     para que la demo se vea real. Reemplazar por una llamada a la API de reservas. */
  function seeded(seed) {
    let s = seed;
    return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  }
  function busyBlocks(date) {
    const key = dayKey(date);
    const rnd = seeded([...key].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 233280);
    const hours = B.hours[date.getDay()];
    if (!hours) return [];
    const blocks = [];
    const n = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const start = hours[0] * 60 + Math.floor(rnd() * ((hours[1] - hours[0]) * 4)) * 15;
      blocks.push([start, start + 45 + Math.floor(rnd() * 3) * 15]);
    }
    loadAppts().filter((a) => a.day === key && a.status !== "cancelada")
      .forEach((a) => blocks.push([a.start, a.start + a.minutes]));
    return blocks;
  }
  function slotsFor(date, minutes) {
    const hours = B.hours[date.getDay()];
    if (!hours) return [];
    const open = hours[0] * 60, close = hours[1] * 60;
    const isToday = dayKey(date) === dayKey(new Date());
    const earliest = isToday ? nowMinutes() + 30 : 0;
    const busy = busyBlocks(date);
    const out = [];
    for (let t = open; t + minutes <= close; t += B.slotStepMinutes) {
      if (t < earliest) continue;
      if (busy.some(([a, b]) => t < b && t + minutes > a)) continue;
      out.push(t);
    }
    return out;
  }

  /* ---------------- Render: inicio ---------------- */
  function renderHome() {
    const hours = B.hours[new Date().getDay()];
    const now = nowMinutes();
    const open = hours && now >= hours[0] * 60 && now < hours[1] * 60;
    const st = $("#open-status");
    st.textContent = open ? `Abierto · cierra ${fmtTime(hours[1] * 60)}` : "Cerrado ahora";
    st.classList.toggle("is-open", !!open);

    const today = startOfDay(new Date());
    const slots = slotsFor(today, 50);
    $("#today-count").textContent = slots.length ? `${slots.length} disponibles` : "Sin espacios";
    $("#today-slots").innerHTML = slots.length
      ? slots.slice(0, 12).map((m) => `<button class="slot" data-quick="${m}">${fmtTime(m)}</button>`).join("")
      : `<p class="empty">Hoy ya no hay espacios. Reserva para otro día.</p>`;

    $("#popular").innerHTML = SERVICES.filter((s) => s.popular).map(cardHTML).join("");

    $("#wa-link").href = `https://wa.me/${B.whatsapp}`;
    $("#phone-label").textContent = B.phone.replace(/(\d{4})(\d{4})/, "$1 $2");
  }

  const cardHTML = (s) => `
    <button class="card" data-book="${s.id}">
      <div class="card__body">
        <p class="card__title">${s.name}</p>
        <p class="card__meta">${fmtMin(s.min)}</p>
      </div>
      <span class="card__price">${fmtMoney(s.price)}</span>
    </button>`;

  const svcHTML = (s) => `
    <div class="svc ${state.cart.has(s.id) ? "is-selected" : ""}">
      <button class="card" data-toggle="${s.id}" aria-pressed="${state.cart.has(s.id)}">
        <div class="card__body">
          <p class="card__title">${s.name}</p>
          <p class="card__meta">${fmtMin(s.min)} · <span class="card__price">${fmtMoney(s.price)}</span></p>
          <p class="svc__desc">${s.desc}</p>
        </div>
      </button>
      <span class="svc__add" aria-hidden="true">${state.cart.has(s.id) ? "✓" : "+"}</span>
    </div>`;

  /* ---------------- Render: servicios ---------------- */
  function renderServices() {
    $("#cat-chips").innerHTML = CATEGORIES.map((c) =>
      `<button class="chip ${c.id === state.category ? "is-active" : ""}" data-cat="${c.id}" role="tab">${c.name}</button>`
    ).join("");
    const q = state.query.trim().toLowerCase();
    const list = SERVICES.filter((s) => (q ? s.name.toLowerCase().includes(q) : s.cat === state.category));
    $("#service-list").innerHTML = list.length
      ? list.map(svcHTML).join("")
      : `<p class="empty-state">No encontramos “${state.query}”.</p>`;
  }

  function renderCartbar() {
    const n = state.cart.size;
    const onServices = !$("#view-services").hidden;
    $("#cartbar").hidden = !(n && onServices) || !$("#flow").hidden;
    if (!n) return;
    $("#cart-count").textContent = n === 1 ? "1 servicio" : `${n} servicios`;
    $("#cart-total").textContent = `${fmtMoney(cartTotal())} · ${fmtMin(cartMinutes())}`;
  }

  /* ---------------- Render: mis citas ---------------- */
  function renderAppointments() {
    const appts = loadAppts().sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
    const el = $("#appt-list");
    if (!appts.length) {
      el.innerHTML = `<div class="empty-state"><p>Todavía no tienes citas.</p>
        <button class="btn btn--gold" data-action="start-booking">Reservar ahora</button></div>`;
      return;
    }
    const todayKey = dayKey(new Date());
    el.innerHTML = appts.map((a) => {
      const past = a.day < todayKey || a.status === "cancelada";
      const d = new Date(a.day + "T12:00:00");
      return `<article class="appt ${past ? "is-past" : ""}">
        <div class="appt__top">
          <span class="appt__when">${DOW[d.getDay()]} ${d.getDate()} · ${fmtTime(a.start)}</span>
          <span class="appt__tag">${a.status}</span>
        </div>
        <p class="appt__svc">${a.services.map((id) => byId(id).name).join(" + ")} · ${fmtMoney(a.total)}</p>
        ${past ? "" : `<div class="appt__actions">
          <a class="btn btn--ghost" href="${calendarLink(a)}" target="_blank" rel="noopener">Agregar al calendario</a>
          <button class="btn btn--ghost" data-cancel="${a.id}">Cancelar</button>
        </div>`}
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
    state.step = step;
    state.day = day;
    state.slot = slot;
    $("#flow").hidden = false;
    document.body.style.overflow = "hidden";
    renderFlow();
  }
  function closeFlow() {
    $("#flow").hidden = true;
    document.body.style.overflow = "";
    renderCartbar();
  }

  function renderFlow() {
    const step = state.step;
    $$(".pane").forEach((p) => (p.hidden = p.dataset.pane !== String(step)));
    $$(".step").forEach((s) => s.classList.toggle("is-done", step === "done" || +s.dataset.step <= step));
    $("#flow-foot").hidden = step === "done";
    $("[data-action=flow-back]").style.visibility = step === 1 || step === "done" ? "hidden" : "visible";

    const total = cartTotal();
    $("#foot-total").textContent = state.cart.size ? fmtMoney(total) : "—";
    $("#foot-label").textContent = state.cart.size ? `Total · ${fmtMin(cartMinutes())}` : "Total";
    const next = $("#flow-next");

    if (step === 1) {
      const groups = CATEGORIES.map((c) => {
        const items = SERVICES.filter((s) => s.cat === c.id);
        return `<p class="group">${c.name}</p>` + items.map(svcHTML).join("");
      });
      $("#flow-services").innerHTML = groups.join("");
      next.textContent = "Elegir día y hora";
      next.disabled = !state.cart.size;
    }

    if (step === 2) {
      const mins = cartMinutes();
      $("#duration-note").textContent = `Tu cita dura ${fmtMin(mins)}. Te mostramos solo horas donde cabe completa.`;
      const today = startOfDay(new Date());
      const days = Array.from({ length: B.daysAhead }, (_, i) => addDays(today, i));
      if (!state.day) state.day = dayKey(days.find((d) => slotsFor(d, mins).length) || today);
      $("#days").innerHTML = days.map((d, i) => {
        const n = slotsFor(d, mins).length;
        const label = i === 0 ? "Hoy" : i === 1 ? "Mañana" : DOW[d.getDay()];
        const sub = B.hours[d.getDay()] ? (n ? `${n} libres` : "Lleno") : "Cerrado";
        return `<button class="day ${dayKey(d) === state.day ? "is-active" : ""}" data-day="${dayKey(d)}" ${n ? "" : "disabled"}>
          <small>${label}</small><strong>${d.getDate()}</strong><i>${sub}</i></button>`;
      }).join("");
      const d = new Date(state.day + "T00:00:00");
      const slots = slotsFor(d, mins);
      if (state.slot != null && !slots.includes(state.slot)) state.slot = null;
      const part = (from, to) => slots.filter((m) => m >= from && m < to);
      const sections = [["Mañana", part(0, 720)], ["Tarde", part(720, 1020)], ["Noche", part(1020, 1440)]]
        .filter(([, s]) => s.length);
      $("#slots").innerHTML = sections.length
        ? sections.map(([t, s]) => `<div class="slot-group"><h3>${t}</h3><div class="slot-grid">
            ${s.map((m) => `<button class="slot ${m === state.slot ? "is-active" : ""}" data-slot="${m}">${fmtTime(m).replace(/ [ap]\.m\./, "")}</button>`).join("")}
          </div></div>`).join("")
        : `<p class="no-slots">No hay espacios este día.</p>`;
      requestAnimationFrame(() => $(".day.is-active")?.scrollIntoView({ inline: "center", block: "nearest" }));
      next.textContent = state.slot != null ? `Reservar ${fmtTime(state.slot)}` : "Elige una hora";
      next.disabled = state.slot == null;
    }

    if (step === 3) {
      const d = new Date(state.day + "T12:00:00");
      $("#summary").innerHTML = `
        <p class="summary__when">${longDate(d)} · ${fmtTime(state.slot)}</p>
        ${cartItems().map((s) => `<div class="summary__row"><span>${s.name}</span><span>${fmtMoney(s.price)}</span></div>`).join("")}
        <div class="summary__row"><span>Termina aprox.</span><span>${fmtTime(state.slot + cartMinutes())}</span></div>`;
      $("#policy-list").innerHTML = Object.values(B.policies).map((p) => `<li>${p}</li>`).join("");
      next.textContent = "Confirmar reserva";
      next.disabled = false;
    }
  }

  function submitBooking() {
    const form = $("#details");
    const name = form.name.value.trim();
    const phone = form.phone.value.replace(/\D/g, "");
    form.name.parentElement.classList.toggle("is-invalid", !name);
    form.phone.parentElement.classList.toggle("is-invalid", phone.length < 8);
    if (!name || phone.length < 8) { toast("Revisa tu nombre y teléfono"); return; }

    const appt = {
      id: Date.now().toString(36),
      day: state.day,
      start: state.slot,
      minutes: cartMinutes(),
      services: [...state.cart],
      total: cartTotal(),
      name, phone,
      note: form.note.value.trim(),
      status: "pendiente",
    };
    saveAppts([...loadAppts(), appt]);
    showTicket(appt);
    state.cart.clear();
    form.reset();
  }

  function showTicket(a) {
    const d = new Date(a.day + "T12:00:00");
    const svc = a.services.map((id) => byId(id).name).join(" + ");
    const msg = `Hola, soy ${a.name}. Reservé ${svc} para el ${longDate(d)} a las ${fmtTime(a.start)}.` +
      (a.note ? ` Nota: ${a.note}` : "");
    $("#ticket").innerHTML = `
      <div class="monogram" aria-hidden="true">VA</div>
      <h2>Cita reservada</h2>
      <span class="ticket__state">Pendiente de confirmación</span>
      <p class="ticket__time">${fmtTime(a.start)}</p>
      <p class="ticket__date">${longDate(d)}</p>
      <p class="ticket__svc">${svc} · ${fmtMoney(a.total)}</p>
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
    const svc = a.services.map((id) => byId(id).name).join(" + ");
    const p = new URLSearchParams({
      action: "TEMPLATE",
      text: `${svc} · ${B.name} Barbería`,
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
    toastTimer = setTimeout(() => t.classList.remove("is-on"), 2200);
  }

  /* ---------------- Eventos ---------------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button, a");
    if (!el) return;
    const ds = el.dataset;

    if (ds.goto) return go(ds.goto);
    if (ds.cat) { state.category = ds.cat; state.query = ""; $("#search").value = ""; return renderServices(); }

    if (ds.toggle) {
      state.cart.has(ds.toggle) ? state.cart.delete(ds.toggle) : state.cart.add(ds.toggle);
      $("#flow").hidden ? renderServices() : renderFlow();
      return renderCartbar();
    }
    if (ds.book) { state.cart.clear(); state.cart.add(ds.book); return openFlow({ step: 2 }); }
    if (ds.quick) {
      state.cart.clear(); state.cart.add("corte");
      return openFlow({ step: 2, day: dayKey(new Date()), slot: +ds.quick });
    }
    if (ds.day) { state.day = ds.day; state.slot = null; return renderFlow(); }
    if (ds.slot) { state.slot = +ds.slot; return renderFlow(); }
    if (ds.cancel) {
      if (!confirm("¿Cancelar esta cita?")) return;
      saveAppts(loadAppts().map((a) => (a.id === ds.cancel ? { ...a, status: "cancelada" } : a)));
      toast("Cita cancelada");
      return renderAppointments();
    }

    switch (ds.action) {
      case "start-booking": return openFlow({ step: state.cart.size ? 2 : 1 });
      case "flow-close": return closeFlow();
      case "flow-back": state.step = Math.max(1, state.step - 1); return renderFlow();
      case "flow-next":
        if (state.step === 3) return submitBooking();
        state.step += 1; return renderFlow();
      case "done": closeFlow(); return go("appointments");
    }
  });

  $("#search").addEventListener("input", (e) => { state.query = e.target.value; renderServices(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#flow").hidden) closeFlow(); });

  go("home");
})();
