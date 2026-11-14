(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("es-CR", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const ACTIONS = { entrar: "entró al panel", login: "inició sesión", "login-fallido": "intento fallido de inicio de sesión",
    "equipo-agregar": "dio acceso a", "equipo-quitar": "quitó el acceso a", copia: "hizo una copia", password: "cambió su contraseña" };

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith("/login")) { showLogin(); throw new Error(data.error || "Sesión vencida"); }
    if (!res.ok) throw new Error(data.error || "Error de conexión");
    return data;
  }

  let toastTimer;
  function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("is-on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("is-on"), 3000); }

  function showLogin() { $("#dash").hidden = true; $("#login").hidden = false; }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button");
    btn.disabled = true;
    try { await api("/api/plataforma/login", { method: "POST", body: { email: f.email.value, password: f.password.value } }); f.reset(); start(); }
    catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  });

  async function render() {
    const { negocios } = await api("/api/plataforma/negocios");
    const sum = (k) => negocios.reduce((t, n) => t + (n.stats[k] || 0), 0);
    $("#totals").innerHTML = [
      [negocios.length, "Negocios"], [sum("clients"), "Clientes"], [sum("bookingsMonth"), "Citas este mes"], [sum("pending"), "Por confirmar"],
    ].map(([v, l]) => `<div><strong>${v}</strong><small>${l}</small></div>`).join("");

    $("#biz-list").innerHTML = negocios.map((n) => {
      const s = n.stats;
      const bk = s.lastBackup ? `${fmtDate(s.lastBackup.at)}${s.lastBackup.uploaded ? " · ✅ también fuera del servidor" : " · solo en el servidor"}` : "todavía ninguna";
      return `<article class="biz" style="--biz:${esc(n.accent)}">
        <div class="biz__head">
          <img src="${esc(n.logo)}" alt="" />
          <div><p class="biz__name">${esc(n.name)}</p>
            <a class="biz__url" href="${esc(n.url || "#")}" target="_blank" rel="noopener">${esc(n.url || "(sin dirección pública)")}</a></div>
        </div>
        <div class="biz__stats">
          <div><strong>${s.clients}</strong><small>Clientes</small></div>
          <div><strong>${s.newClients30}</strong><small>Nuevos (30 días)</small></div>
          <div><strong>${s.bookingsMonth}</strong><small>Citas este mes</small></div>
          <div class="${s.pending ? "is-alert" : ""}"><strong>${s.pending}</strong><small>Por confirmar</small></div>
          <div><strong>${s.next7}</strong><small>Próximos 7 días</small></div>
          <div><strong>${s.dbBytes ? (s.dbBytes / 1024).toFixed(0) + " KB" : "—"}</strong><small>Datos</small></div>
        </div>
        <p class="biz__meta">Profesional: ${esc(n.staff.join(", ") || "—")} · Última reserva: ${esc(fmtDate(s.lastBooking))}</p>
        <p class="biz__meta">Última copia: ${esc(bk)}</p>
        <div class="biz__actions">
          <button class="btn btn--gold" data-enter="${esc(n.slug)}">Entrar al panel</button>
          <a class="btn btn--ghost" href="${esc(n.url || "#")}" target="_blank" rel="noopener">Abrir app</a>
          <button class="btn btn--ghost" data-backup="${esc(n.slug)}">Copia ahora</button>
        </div>
        <details>
          <summary>Equipo del negocio (${s.team.length})</summary>
          ${s.team.length ? s.team.map((a) => `<div class="team-row"><div><strong>${esc(a.name)}</strong><small>${esc(a.email)}</small></div>
              <button class="btn btn--ghost adm-small" data-remove="${esc(n.slug)}:${a.id}" data-name="${esc(a.name)}">Quitar</button></div>`).join("")
            : `<p class="adm-hint" style="margin:8px 0 0">Nadie del negocio tiene acceso todavía.</p>`}
          <form data-add="${esc(n.slug)}"><input name="login" placeholder="Correo o teléfono de su cuenta" aria-label="Correo o teléfono" />
            <button class="btn btn--gold">Dar acceso</button></form>
          <p class="adm-hint" style="margin:6px 0 0">La persona primero crea su cuenta en la app de ${esc(n.name)}.</p>
        </details>
      </article>`;
    }).join("");

    $$("form[data-add]").forEach((f) => f.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api(`/api/plataforma/negocios/${f.dataset.add}/equipo`, { method: "POST", body: { login: f.login.value } }); toast("Acceso otorgado"); render(); renderLog(); }
      catch (err) { toast(err.message); }
    }));
  }

  async function renderLog() {
    const { entries } = await api("/api/plataforma/registro");
    $("#log").innerHTML = entries.length ? entries.slice(0, 40).map((l) => `<div><time>${esc(fmtDate(l.at))}</time>
      <span>${esc(l.who || "Alguien")} ${esc(ACTIONS[l.action] || l.action)}${l.detail && l.action !== "entrar" ? ` <em>${esc(l.detail)}</em>` : ""}${l.negocio ? ` · <em>${esc(l.negocio)}</em>` : ""}</span></div>`).join("")
      : `<p class="adm-hint">Sin actividad todavía.</p>`;
  }

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("button, a");
    if (!el) return;
    const ds = el.dataset;
    if (ds.enter) {
      const win = window.open("", "_blank"); // se abre antes del await para que el navegador no la bloquee
      try {
        const { url } = await api(`/api/plataforma/negocios/${ds.enter}/entrar`, { method: "POST" });
        if (win) win.location = url; else location.href = url;
        renderLog();
      } catch (err) { if (win) win.close(); toast(err.message); }
      return;
    }
    if (ds.backup) {
      el.disabled = true;
      try { const r = await api(`/api/plataforma/negocios/${ds.backup}/copia`, { method: "POST" }); toast(r.uploaded ? "Copia hecha y guardada fuera del servidor" : "Copia hecha"); render(); renderLog(); }
      catch (err) { toast(err.message); } finally { el.disabled = false; }
      return;
    }
    if (ds.remove) {
      const [slug, id] = ds.remove.split(":");
      if (!confirm(`¿Quitarle el acceso al panel a ${ds.name}? Su cuenta de cliente sigue activa.`)) return;
      try { await api(`/api/plataforma/negocios/${slug}/equipo/${id}`, { method: "DELETE" }); toast("Acceso quitado"); render(); renderLog(); }
      catch (err) { toast(err.message); }
      return;
    }
    switch (ds.action) {
      case "logout": await api("/api/plataforma/logout", { method: "POST" }).catch(() => {}); return showLogin();
      case "password": $("#pw-sheet").hidden = false; return;
      case "close-sheet": $("#pw-sheet").hidden = true; return;
    }
  });

  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await api("/api/plataforma/password", { method: "POST", body: { current: f.current.value, password: f.password.value } });
      f.reset(); $("#pw-sheet").hidden = true; toast("Contraseña actualizada"); renderLog(); }
    catch (err) { toast(err.message); }
  });

  async function start() {
    const { admin } = await api("/api/plataforma/me");
    if (!admin) return showLogin();
    $("#login").hidden = true; $("#dash").hidden = false;
    $("#me-name").textContent = admin.name.split(" ")[0];
    try { await render(); await renderLog(); } catch (err) { toast(err.message); }
  }
  start();
})();
