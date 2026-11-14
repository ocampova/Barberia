(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let B, SERVICES, CATEGORIES, RETIRED = [];
  let USER = null; // cliente con sesión iniciada, o null
  const byId = (id) => SERVICES.find((s) => s.id === id);
  const catOf = (id) => CATEGORIES.find((c) => c.id === id) || {};
  const staffLine = (catId) => (catOf(catId).staff ? `con ${catOf(catId).staff}` : "");
  const svcName = (id) => byId(id)?.name || RETIRED.find((s) => s.id === id)?.name || "Servicio";

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
  const localPhone = (p) => (p && p.startsWith("506") && p.length === 11 ? p.slice(3).replace(/(\d{4})(\d{4})/, "$1 $2") : "+" + p);
  const STATUS_LABEL = {
    pendiente: "Pendiente de confirmación", confirmada: "Confirmada", rechazada: "No disponible",
    cancelada: "Cancelada", completada: "Atendida", "no-asistio": "No asististe",
  };

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || "No pudimos conectar. Revisa tu internet.");
      e.status = res.status;
      if (res.status === 401 && USER && !path.startsWith("/api/auth/")) { USER = null; renderTabs(); }
      throw e;
    }
    return data;
  }

  /* ---------------- Estado ---------------- */
  const state = { cart: [], category: "barberia", query: "", step: 1, day: null, slot: null, avail: null, availKey: "", view: "home" };

  const cartItems = () => state.cart.map(byId).filter(Boolean);
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
        toast("Esos servicios se reservan por separado");
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
    const s = B.status || {};
    const st = $("#open-status");
    st.textContent = s.open ? `Abierto · cierra ${fmtTime(s.closesAt)}`
      : s.opensAt == null ? "Cerrado"
      : s.opensDay === B.today ? `Cerrado · abre a las ${fmtTime(s.opensAt)}`
      : `Cerrado · abre el ${DOW[weekday(s.opensDay)].toLowerCase()} ${asDate(s.opensDay).getDate()}`;
    st.classList.toggle("is-open", !!s.open);

    const popular = SERVICES.filter((x) => x.popular);
    $("#popular").innerHTML = (popular.length ? popular : SERVICES.slice(0, 3)).map(cardHTML).join("");
    $("#wa-link").href = `https://wa.me/${B.whatsapp}`;
    $("#related").innerHTML = (B.related || []).map((r) => `
      <a class="related" href="${esc(r.url)}">
        <img src="${esc(r.logo)}" width="56" height="56" alt="" style="background:${esc(r.logoBg || "transparent")}" />
        <span><small>En el mismo local</small><strong>${esc(r.name)}</strong><em>${esc(r.pitch)}</em></span>
        <span class="related__go" aria-hidden="true">›</span>
      </a>`).join("");
    $("#phone-label").textContent = B.phone.replace(/(\d{4})(\d{4})/, "$1 $2");
    // Redes sociales: solo si el negocio las configuró
    $("#ig-link").hidden = !B.instagram;
    if (B.instagram) { $("#ig-link").href = `https://instagram.com/${encodeURIComponent(B.instagram)}`; $("#ig-label").textContent = "@" + B.instagram; }
    $("#fb-link").hidden = !B.facebook;
    if (B.facebook) $("#fb-link").href = `https://www.facebook.com/${B.facebook.split("?").map(encodeURI).join("?")}`;

    const quick = SERVICES.find((x) => x.popular) || SERVICES[0];
    if (!quick) { $("#today-slots").innerHTML = ""; return; }
    try {
      const { days } = await api(`/api/availability?services=${encodeURIComponent(quick.id)}&days=1`);
      const slots = days[0].slots;
      $("#today-count").textContent = slots.length ? `${slots.length} disponibles` : "Sin espacios";
      $("#today-slots").innerHTML = slots.length
        ? slots.slice(0, 12).map((m) => `<button class="slot" data-quick="${m}" data-svc="${esc(quick.id)}">${fmtTime(m)}</button>`).join("")
        : `<p class="empty">Hoy ya no hay espacios. Reserva para otro día.</p>`;
    } catch (e) {
      $("#today-count").textContent = "";
      $("#today-slots").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    }
  }

  const cardHTML = (s) => `
    <button class="card" data-book="${esc(s.id)}">
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
      <button class="card" data-toggle="${esc(s.id)}" aria-pressed="${on}">
        <div class="card__body">
          <p class="card__title">${esc(s.name)}</p>
          <p class="card__meta">${fmtMin(s.min)} · <span class="card__price">${fmtMoney(s.price)}</span></p>
          ${s.desc ? `<p class="svc__desc">${esc(s.desc)}</p>` : ""}
        </div>
      </button>
      <span class="svc__add" aria-hidden="true">${on ? "✓" : "+"}</span>
    </div>`;
  };

  /* ---------------- Servicios ---------------- */
  function renderServices() {
    $("#cat-chips").hidden = CATEGORIES.length < 2;
    $("#cat-chips").innerHTML = CATEGORIES.map((c) =>
      `<button class="chip ${c.id === state.category ? "is-active" : ""}" data-cat="${c.id}" role="tab">${esc(c.name)}</button>`
    ).join("");
    const cur = catOf(state.category);
    $("#cat-staff").textContent = !state.query.trim() && cur.staff ? `Te atiende ${cur.staff}` : "";
    const q = state.query.trim().toLowerCase();
    const list = SERVICES.filter((s) => (q ? s.name.toLowerCase().includes(q) : s.cat === state.category));
    $("#service-list").innerHTML = list.length
      ? list.map(svcHTML).join("")
      : `<p class="empty-state">${q ? `No encontramos “${esc(state.query)}”.` : "Pronto tendremos servicios aquí."}</p>`;
  }

  function renderCartbar() {
    const n = state.cart.length;
    $("#cartbar").hidden = !(n && state.view === "services") || !$("#flow").hidden;
    if (!n) return;
    $("#cart-count").textContent = n === 1 ? "1 servicio" : `${n} servicios`;
    $("#cart-total").textContent = `${fmtMoney(cartTotal())} · ${fmtMin(cartMinutes())}`;
  }

  /* ---------------- Mis citas ---------------- */
  // ¿Todavía está dentro del plazo para cancelar desde la app?
  function canCancel(a, today) {
    const hours = B.cancelHours || 0;
    if (!hours) return true;
    const days = (asDate(a.day) - asDate(today)) / 86400000;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return days * 1440 + a.start - nowMin >= hours * 60;
  }
  const cancelRule = () => B.cancelHours
    ? `Puedes cancelar desde la app hasta ${B.cancelHours} ${B.cancelHours === 1 ? "hora" : "horas"} antes de tu cita; después, escríbenos por WhatsApp.`
    : "Puedes cancelar desde la app en cualquier momento antes de tu cita.";
  const loginPrompt = (text) => `<div class="empty-state">
      <p>${text}</p>
      <div class="auth-cta">
        <button class="btn btn--gold" data-auth-open="login">Iniciar sesión</button>
        <button class="btn btn--ghost" data-auth-open="register">Crear cuenta</button>
      </div></div>`;

  async function renderAppointments() {
    const el = $("#appt-list");
    if (!USER) { el.innerHTML = loginPrompt("Inicia sesión para ver tus citas y tu historial."); return; }
    el.innerHTML = `<p class="empty-state">Cargando…</p>`;
    let data;
    try { data = await api("/api/me/bookings"); }
    catch (e) { el.innerHTML = e.status === 401 ? loginPrompt("Tu sesión terminó. Inicia sesión de nuevo.") : `<p class="empty-state">${esc(e.message)}</p>`; return; }
    const today = data.today;
    const isActive = (a) => ["pendiente", "confirmada"].includes(a.status) && a.day >= today;
    const upcoming = data.bookings.filter(isActive).sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
    const history = data.bookings.filter((a) => !isActive(a));
    if (!upcoming.length && !history.length) {
      el.innerHTML = `<div class="empty-state"><p>Todavía no tienes citas.</p>
        <button class="btn btn--gold" data-action="start-booking">Reservar ahora</button></div>`;
      return;
    }
    const item = (a, active) => {
      const d = asDate(a.day);
      const again = a.services.every((id) => byId(id));
      return `<article class="appt ${active ? "" : "is-past"}">
        <div class="appt__top">
          <span class="appt__when">${DOW[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString("es-CR", { month: "short" })} · ${fmtTime(a.start)}</span>
          <span class="appt__tag appt__tag--${a.status}">${STATUS_LABEL[a.status] || a.status}</span>
        </div>
        <p class="appt__svc">${a.services.map((id) => esc(svcName(id))).join(" + ")} · ${fmtMoney(a.total)}${staffLine(a.category) ? ` · ${esc(staffLine(a.category))}` : ""}</p>
        ${a.note ? `<p class="appt__note">“${esc(a.note)}”</p>` : ""}
        <div class="appt__actions">
          ${active ? `<a class="btn btn--ghost" href="${calendarLink(a)}" target="_blank" rel="noopener">Agregar al calendario</a>
                      ${canCancel(a, today) ? `<button class="btn btn--ghost" data-cancel="${esc(a.id)}">Cancelar</button>`
                        : `<a class="btn btn--ghost" target="_blank" rel="noopener" href="https://wa.me/${B.whatsapp}?text=${encodeURIComponent(`Hola, necesito cambiar mi cita del ${longDate(a.day)} a las ${fmtTime(a.start)}.`)}">Escribir por WhatsApp</a>`}`
                   : again ? `<button class="btn btn--ghost" data-again="${esc(a.services.join(","))}">Reservar de nuevo</button>` : ""}
        </div>
      </article>`;
    };
    el.innerHTML =
      (upcoming.length ? `<p class="group">Próximas</p>` + upcoming.map((a) => item(a, true)).join("")
        : `<div class="appt appt--cta"><p>No tienes citas próximas.</p><button class="btn btn--gold" data-action="start-booking">Reservar</button></div>`) +
      (history.length ? `<p class="group">Historial</p>` + history.map((a) => item(a, false)).join("") : "");
  }

  /* ---------------- Perfil ---------------- */
  async function renderProfile() {
    const el = $("#profile");
    if (!USER) { el.innerHTML = loginPrompt("Crea tu cuenta para reservar más rápido y ver tu historial."); return; }
    const initials = USER.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    const since = new Date(USER.since).toLocaleDateString("es-CR", { month: "long", year: "numeric" });
    let stats = { done: 0, next: null };
    try {
      const { bookings, today } = await api("/api/me/bookings");
      stats.done = bookings.filter((b) => b.status === "completada").length;
      stats.next = bookings.filter((b) => ["pendiente", "confirmada"].includes(b.status) && b.day >= today)
        .sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start))[0] || null;
    } catch {}
    el.innerHTML = `
      <div class="profile">
        <div class="profile__head">
          <div class="avatar" aria-hidden="true">${esc(initials)}</div>
          <div><p class="profile__name">${esc(USER.name)}</p><p class="profile__since">Cliente desde ${since}</p></div>
        </div>
        <div class="stats">
          <div><strong>${stats.done}</strong><small>Visitas</small></div>
          <div><strong>${stats.next ? `${DOW[weekday(stats.next.day)]} ${asDate(stats.next.day).getDate()}` : "—"}</strong><small>Próxima cita</small></div>
        </div>

        <form id="form-profile" class="card-form" novalidate>
          <h2>Mis datos</h2>
          <label class="field"><span>Nombre y apellido</span><input name="name" maxlength="60" autocomplete="name" value="${esc(USER.name)}" /></label>
          <label class="field"><span>Teléfono</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel" value="${esc(localPhone(USER.phone))}" /></label>
          <label class="field"><span>Correo</span><input name="email" type="email" autocomplete="email" maxlength="120" value="${esc(USER.email)}" /></label>
          <button class="btn btn--gold btn--block">Guardar cambios</button>
        </form>

        <form id="form-password" class="card-form" novalidate>
          <h2>Contraseña</h2>
          <label class="field"><span>Contraseña actual</span><input name="current" type="password" autocomplete="current-password" /></label>
          <label class="field"><span>Contraseña nueva (mínimo 8)</span><input name="password" type="password" autocomplete="new-password" minlength="8" /></label>
          <button class="btn btn--ghost btn--block">Cambiar contraseña</button>
        </form>

        ${USER.admin ? `<a class="btn btn--gold btn--block" href="/admin">Ir al panel ${esc(B.dePlace || "del negocio")}</a>` : ""}
        <button class="btn btn--ghost btn--block logout" data-action="logout">Cerrar sesión</button>
      </div>`;

    $("#form-profile").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const r = await api("/api/me", { method: "PATCH", body: { name: f.name.value, phone: f.phone.value, email: f.email.value } });
        USER = r.user; toast("Datos guardados"); renderProfile();
      } catch (err) { toast(err.message); }
    });
    $("#form-password").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api("/api/me/password", { method: "POST", body: { current: f.current.value, password: f.password.value } });
        f.reset(); toast("Contraseña actualizada");
      } catch (err) { toast(err.message); }
    });
  }

  /* ---------------- Sesión ---------------- */
  let afterAuth = null; // qué hacer al terminar de iniciar sesión
  const AUTH_TEXT = {
    login: ["Hola de nuevo", "Inicia sesión para reservar y ver tus citas."],
    register: ["Crea tu cuenta", "Solo toma un minuto. Así reservas más rápido y ves tu historial."],
    forgot: ["¿Olvidaste tu contraseña?", "Te enviamos un enlace a tu correo para crear una nueva."],
    reset: ["Crea una contraseña nueva", "Escríbela y entrarás de una vez."],
  };
  let resetToken = null;

  function openAuth(mode = "login", then = null) {
    afterAuth = then;
    setAuthMode(mode);
    $("#auth").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => $(`#form-${mode} input`)?.focus(), 50);
  }
  function setAuthMode(mode) {
    const [title, sub] = AUTH_TEXT[mode];
    $("#auth-title").textContent = title;
    $("#auth-sub").textContent = sub;
    $("#auth-seg").hidden = !["login", "register"].includes(mode);
    $$("#auth-seg button").forEach((b) => b.classList.toggle("is-active", b.dataset.auth === mode));
    for (const m of ["login", "register", "forgot", "reset"]) $(`#form-${m}`).hidden = m !== mode;
  }
  function closeAuth() {
    $("#auth").hidden = true;
    if ($("#flow").hidden) document.body.style.overflow = "";
  }
  function signedIn(user, message) {
    USER = user;
    closeAuth();
    renderTabs();
    toast(message);
    const then = afterAuth; afterAuth = null;
    if (then) then();
    else if (["appointments", "profile"].includes(state.view)) go(state.view);
  }

  async function submitAuth(e, path, body, message) {
    e.preventDefault();
    const btn = e.target.querySelector("button:not([type=button])");
    btn.disabled = true;
    try {
      const r = await api(path, { method: "POST", body });
      e.target.reset();
      signedIn(r.user, message(r.user));
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  }
  $("#form-login").addEventListener("submit", (e) => submitAuth(e, "/api/auth/login",
    { login: e.target.login.value, password: e.target.password.value }, (u) => `¡Hola, ${u.name.split(" ")[0]}!`));
  $("#form-register").addEventListener("submit", (e) => {
    const f = e.target;
    if (f.password.value.length < 8) { e.preventDefault(); return toast("La contraseña debe tener al menos 8 caracteres"); }
    if (!f.acceptPrivacy.checked) { e.preventDefault(); return toast("Debes aceptar el aviso de privacidad"); }
    submitAuth(e, "/api/auth/register", { name: f.name.value, phone: f.phone.value, email: f.email.value,
      password: f.password.value, website: f.website.value, source: f.source.value, acceptPrivacy: true },
      (u) => `¡Listo, ${u.name.split(" ")[0]}! Tu cuenta está creada`);
  });
  $("#form-reset").addEventListener("submit", (e) => submitAuth(e, "/api/auth/reset",
    { token: resetToken, password: e.target.password.value }, () => "Contraseña actualizada"));
  $("#form-forgot").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/auth/forgot", { method: "POST", body: { email: e.target.email.value } });
      if (!r.emailEnabled) toast("Escríbenos por WhatsApp para recuperar tu cuenta");
      else { toast("Si el correo está registrado, te llegará un enlace"); setAuthMode("login"); }
    } catch (err) { toast(err.message); }
  });

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
    USER = null;
    renderTabs();
    toast("Sesión cerrada");
    go("home");
  }

  function renderTabs() {
    const tab = $(".tab[data-goto=profile]");
    tab.lastChild.textContent = USER ? USER.name.split(" ")[0] : "Perfil";
  }

  /* ---------------- Navegación ---------------- */
  function go(view) {
    state.view = view;
    $$(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.goto === view));
    if (view === "home") renderHome();
    if (view === "services") renderServices();
    if (view === "appointments") renderAppointments();
    if (view === "profile") renderProfile();
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
    $$(".pane[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== String(step)));
    $$(".step").forEach((s) => s.classList.toggle("is-done", step === "done" || +s.dataset.step <= step));
    $("#flow-foot").hidden = step === "done";
    $("[data-action=flow-back]").style.visibility = step === 1 || step === "done" ? "hidden" : "visible";

    $("#foot-total").textContent = state.cart.length ? fmtMoney(cartTotal()) : "—";
    $("#foot-label").textContent = state.cart.length ? `Total · ${fmtMin(cartMinutes())}` : "Total";
    const next = $("#flow-next");

    if (step === 1) {
      $("#flow-services").innerHTML = CATEGORIES.map((c) => {
        const items = SERVICES.filter((s) => s.cat === c.id);
        return items.length ? `<p class="group">${esc(c.name)}${c.staff ? ` · <span class="group__staff">${esc(c.staff)}</span>` : ""}</p>` + items.map(svcHTML).join("") : "";
      }).join("");
      next.textContent = "Elegir día y hora";
      next.disabled = !state.cart.length;
    }

    if (step === 2) {
      const who = cartItems()[0] ? staffLine(cartItems()[0].cat) : "";
      $("#duration-note").textContent = `Tu cita ${who ? who + " " : ""}dura ${fmtMin(cartMinutes())}. Te mostramos solo horas donde cabe completa.`;
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
        const sub = d.open ? (n ? `${n} libres` : "Lleno") : "Cerrado";
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
      $("#who").innerHTML = USER
        ? `<div class="who"><div class="avatar avatar--sm" aria-hidden="true">${esc(USER.name[0].toUpperCase())}</div>
             <div><strong>${esc(USER.name)}</strong><small>${esc(localPhone(USER.phone))} · ${esc(USER.email)}</small></div></div>`
        : `<div class="who who--guest"><p>Para confirmar necesitas una cuenta. Así podrás ver y cancelar tus citas cuando quieras.</p>
             <div class="auth-cta">
               <button class="btn btn--gold" data-auth-open="login" data-then="confirm">Iniciar sesión</button>
               <button class="btn btn--ghost" data-auth-open="register" data-then="confirm">Crear cuenta</button>
             </div></div>`;
      $("#summary").innerHTML = `
        <p class="summary__when">${longDate(state.day)} · ${fmtTime(state.slot)}</p>
        ${cartItems().map((s) => `<div class="summary__row"><span>${esc(s.name)}</span><span>${fmtMoney(s.price)}</span></div>`).join("")}
        <div class="summary__row"><span>Termina aprox.</span><span>${fmtTime(state.slot + cartMinutes())}</span></div>
        ${cartItems()[0] && catOf(cartItems()[0].cat).staff ? `<div class="summary__row"><span>Te atiende</span><span>${esc(catOf(cartItems()[0].cat).staff)}</span></div>` : ""}`;
      $("#policy-list").innerHTML = [cancelRule(), ...B.policies].map((p) => `<li>${esc(p)}</li>`).join("");
      next.textContent = USER ? "Confirmar reserva" : "Inicia sesión para confirmar";
      next.disabled = false;
    }
  }

  let submitting = false;
  async function submitBooking() {
    if (!USER) return openAuth("login", () => renderFlow());
    if (submitting) return;
    const form = $("#details");
    submitting = true;
    const next = $("#flow-next");
    next.disabled = true; next.textContent = "Reservando…";
    try {
      const b = await api("/api/bookings", {
        method: "POST",
        body: { services: state.cart, day: state.day, start: state.slot, note: form.note.value.trim(), website: form.website.value },
      });
      showTicket(b);
      state.cart = []; state.avail = null;
      form.note.value = "";
    } catch (e) {
      toast(e.message);
      if (e.status === 401) { openAuth("login", () => renderFlow()); renderFlow(); }
      else if (e.status === 409) { state.avail = null; state.slot = null; state.step = 2; renderFlow(); }
      else { next.disabled = false; next.textContent = "Confirmar reserva"; }
    } finally { submitting = false; }
  }

  function showTicket(a) {
    const svc = a.services.map(svcName).join(" + ");
    const msg = `Hola, soy ${USER.name}. Acabo de reservar ${svc}${staffLine(a.category) ? " " + staffLine(a.category) : ""} para el ${longDate(a.day)} a las ${fmtTime(a.start)} (reserva ${a.id}).`;
    $("#ticket").innerHTML = `
      <img class="ticket__logo" src="${esc((B.logos && B.logos.main) || "")}" width="96" height="96" alt="" />
      <h2>Cita reservada</h2>
      <span class="ticket__state">Pendiente de confirmación</span>
      <p class="ticket__time">${fmtTime(a.start)}</p>
      <p class="ticket__date">${longDate(a.day)}</p>
      <p class="ticket__svc">${esc(svc)} · ${fmtMoney(a.total)}${staffLine(a.category) ? `<br><span class="ticket__staff">${esc(staffLine(a.category))}</span>` : ""}</p>
      ${B.emailEnabled ? `<p class="ticket__mail">Te avisaremos a <strong>${esc(USER.email)}</strong> cuando ${esc(B.place || "el negocio")} confirme.</p>` : ""}
      <div class="ticket__actions">
        <a class="btn btn--gold" target="_blank" rel="noopener"
           href="https://wa.me/${B.whatsapp}?text=${encodeURIComponent(msg)}">Avisar por WhatsApp</a>
        <a class="btn btn--ghost" target="_blank" rel="noopener" href="${calendarLink(a)}">Agregar al calendario</a>
        <button class="btn btn--ghost" data-action="done">Ver mis citas</button>
      </div>`;
    state.step = "done";
    renderFlow();
  }

  function calendarLink(a) {
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = (m) => a.day.replace(/-/g, "") + "T" + pad(Math.floor(m / 60)) + pad(m % 60) + "00";
    const p = new URLSearchParams({
      action: "TEMPLATE",
      text: `${a.services.map(svcName).join(" + ")} · ${catOf(a.category).brand || B.name}`,
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

    if (ds.authOpen) {
      const then = ds.then === "confirm" ? () => renderFlow() : null;
      return openAuth(ds.authOpen, then);
    }
    if (ds.auth) return setAuthMode(ds.auth);
    if (ds.goto) return go(ds.goto);
    if (ds.cat) { state.category = ds.cat; state.query = ""; $("#search").value = ""; return renderServices(); }
    if (ds.toggle) {
      toggleService(ds.toggle);
      $("#flow").hidden ? renderServices() : renderFlow();
      return renderCartbar();
    }
    if (ds.book) { state.cart = [ds.book]; state.avail = null; return openFlow({ step: 2 }); }
    if (ds.quick) { state.cart = [ds.svc]; state.avail = null; return openFlow({ step: 2, day: B.today, slot: +ds.quick }); }
    if (ds.again) { state.cart = ds.again.split(","); state.avail = null; return openFlow({ step: 2 }); }
    if (ds.day) { state.day = ds.day; state.slot = null; return renderFlow(); }
    if (ds.slot) { state.slot = +ds.slot; return renderFlow(); }
    if (ds.cancel) {
      if (!confirm("¿Cancelar esta cita? El espacio quedará libre para otra persona.")) return;
      try {
        await api(`/api/bookings/${encodeURIComponent(ds.cancel)}/cancel`, { method: "POST" });
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
        return renderFlow();
      case "done": closeFlow(); return go("appointments");
      case "auth-close": return closeAuth();
      case "logout": return logout();
      case "retry": return boot();
    }
  });

  $("#search").addEventListener("input", (e) => { state.query = e.target.value; renderServices(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#auth").hidden) closeAuth();
    else if (!$("#flow").hidden) closeFlow();
  });

  async function boot() {
    const err = $("#boot-error");
    try {
      const [cfg, me] = await Promise.all([api("/api/config"), api("/api/me")]);
      B = cfg; SERVICES = cfg.services; CATEGORIES = cfg.categories; RETIRED = cfg.retired || [];
      if (!CATEGORIES.some((c) => c.id === state.category)) state.category = CATEGORIES[0]?.id;
      $("#reg-source").innerHTML = `<option value="">Elige una opción</option>` +
        (cfg.sources || []).map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join("");
      USER = me.user;
      err.hidden = true;
      renderTabs();
      const qs = new URLSearchParams(location.search);
      // Enlaces desde el correo: ?citas=1 (ver mis citas) y ?reset=TOKEN (nueva contraseña)
      if (qs.has("citas") || qs.has("cita")) { history.replaceState(null, "", location.pathname); return go("appointments"); }
      if (qs.has("olvide")) { history.replaceState(null, "", location.pathname); go("home"); return openAuth("forgot"); }
      if (qs.get("reset")) {
        resetToken = qs.get("reset");
        history.replaceState(null, "", location.pathname);
        go("home");
        return openAuth("reset");
      }
      go("home");
    } catch (e) {
      $("#boot-error p").textContent = e.message;
      err.hidden = false;
      B = B || {};
    }
  }
  boot();
})();
