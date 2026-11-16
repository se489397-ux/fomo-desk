// fomo desk app (plan B). Data comes from a secret gist; the gist id arrives once in
// the URL fragment (#d=...) and is kept in localStorage. Fragments are never sent to servers.
(() => {
  const OWNER = "se489397-ux";
  const POLL_MS = 30000;
  const KEY = "fomoDeskData";
  const $ = (id) => document.getElementById(id);

  function dataBase() {
    const m = location.hash.match(/[#&]d=([^&]+)/);
    if (m) {
      localStorage.setItem(KEY, decodeURIComponent(m[1]));
      history.replaceState(null, "", location.pathname + location.search); // drop the id from the bar
    }
    const v = localStorage.getItem(KEY);
    if (!v) return null;
    if (/^https:\/\//.test(v)) return v.replace(/\/$/, "");
    if (/^[0-9a-f]{20,40}$/i.test(v)) return `https://gist.githubusercontent.com/${OWNER}/${v}/raw`;
    return null;
  }

  const base = dataBase();
  let state = null, chart = null, activity = null, lastOk = 0, lastErr = null;

  async function get(name) {
    const r = await fetch(`${base}/${name}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r.json();
  }

  const money = (n) => n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const tz = "Europe/Madrid";
  const hhmm = (iso) => iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—";
  const ago = (iso) => { if (!iso) return "—"; const s = Math.round((Date.now() - new Date(iso)) / 1000); return s < 60 ? `hace ${s}s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`; };

  function renderHome() {
    const s = state;
    const mode = s?.mode || "—";
    const b = $("mode"); b.textContent = mode; b.className = "badge " + (mode === "PAPER" ? "paper" : mode === "LIVE" ? "live" : "");
    if (!s) return;
    const bal = s.balance || {};
    const [i, d] = (bal.equity != null ? Number(bal.equity).toFixed(2) : "").split(".");
    $("bal").innerHTML = bal.equity == null ? "—" : `$${Number(i).toLocaleString("en-US")}<small>.${d}</small>`;
    $("startlbl").textContent = bal.start != null ? `· empezó con ${money(bal.start)}` : "";
    const p = $("pnl"); const up = (bal.pnlUsd || 0) > 0, dn = (bal.pnlUsd || 0) < 0;
    p.className = "pnl " + (up ? "up" : dn ? "down" : "flat");
    p.textContent = bal.pnlUsd == null ? "—" : `${up ? "+" : dn ? "-" : ""}${money(Math.abs(bal.pnlUsd))} (${bal.pnlPct >= 0 ? "+" : ""}${bal.pnlPct}%)`;
    $("updated").textContent = `Datos de ${hhmm(s.updatedAt)} (hora de Madrid) · ${ago(s.updatedAt)}`;

    const c = s.counts || {}, A = Object.fromEntries((s.agents || []).map((a) => [a.agent, a]));
    const card = (key, title, v, sub) => { const a = A[key]; return `<div class="card"><div class="h"><span>${title}</span><span><span class="dot ${a?.alive ? "ok" : ""}"></span>${a?.alive ? "vivo" : "caído"}</span></div><div class="v">${v}</div><div class="s">${sub}</div></div>`; };
    $("cards").innerHTML =
      card("scanner", "1 · Scanner", `${c.pools ?? 0} pools`, `${c.scansPassed ?? 0} → auditor`) +
      card("auditor", "2 · Auditor", `${c.audited ?? 0} taken apart`, `${c.auditRejected ?? 0} rejected`) +
      card("analyst", "3 · Analyst", "Scoring", `${c.scored ?? 0} puntuadas · ${s.analystMode === "rules" ? "reglas" : "Jev"}`) +
      card("executor", "4 · Executor", `${c.trades ?? 0} trades`, "esperando señales") +
      card("risk", "5 · Risk", c.open ? "Guarding" : "Sin posiciones", `stop -${s.settings?.["risk.stop_pct"]}% · trail ${s.settings?.["risk.trail_pct"]}%`) +
      `<div class="card"><div class="h"><span>FOMO</span></div><div class="v">@${esc(s.fomoHandle)}</div><div class="s">PAPER: no se toca dinero</div></div>`;

    const pos = s.positions || [];
    $("positions").innerHTML = pos.length ? pos.map((x) => `<div class="row"><div>${esc(x.name || x.mint.slice(0, 6))}<div class="sub">${money(x.sizeUsd)} · ${esc(x.status)}</div></div><a href="${esc(x.link)}" target="_blank" rel="noopener">FOMO</a></div>`).join("") : `<div class="empty">Ninguna posición abierta</div>`;
  }

  function renderChart() {
    const svg = $("chart"), pts = chart?.points || [];
    $("chartempty").hidden = pts.length > 0;
    if (!pts.length) { svg.innerHTML = ""; return; }
    const W = 340, H = 120, P = 6, vs = pts.map((p) => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const x = (i) => pts.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (pts.length - 1);
    const y = (v) => H - P - ((v - lo) * (H - 2 * P)) / (hi - lo);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    const col = vs[vs.length - 1] >= vs[0] ? "#22c55e" : "#ef4444";
    const last = pts.length - 1;
    svg.innerHTML = (pts.length === 1 ? `<line x1="${P}" x2="${W - P}" y1="${y(vs[0])}" y2="${y(vs[0])}" stroke="${col}" stroke-width="2"/>` :
      `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>`) +
      `<circle cx="${x(last)}" cy="${y(vs[last])}" r="3.5" fill="${col}"/>`;
  }

  function renderActivity() {
    const rows = activity?.rows || [];
    $("activity").innerHTML = rows.length ? rows.map((r) => `<div class="row"><div>${esc(r.title)}<div class="sub">${hhmm(r.ts)} · ${esc(r.detail || "")}</div></div><div>${esc(r.amount || "")}</div></div>`).join("") : `<div class="empty">Sin actividad todavía</div>`;
  }

  function renderAccount() {
    if (!state) return;
    const kv = (o) => Object.entries(o).map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v === null ? "—" : v)}</span></div>`).join("");
    $("account").innerHTML = kv({ "FOMO": "@" + state.fomoHandle, "Modo": state.mode, "Analyst": state.analystMode, "Avisos": "Telegram (al instante)", "Notificaciones web": "No (plan B)", "Pausado": state.paused ? "sí" : "no" });
    $("settings").innerHTML = kv(state.settings || {});
  }

  function renderErr() {
    const e = $("errrow"), msgs = [];
    if (lastErr) msgs.push(`No puedo leer los datos: ${lastErr}`);
    if (state?.updatedAt && Date.now() - new Date(state.updatedAt) > 10 * 60 * 1000) msgs.push(`Datos sin actualizar desde ${hhmm(state.updatedAt)}`);
    for (const x of state?.errors || []) msgs.push(`${x.agent}: ${x.message}`);
    e.hidden = !msgs.length; e.textContent = msgs.slice(0, 3).join(" · ");
  }

  async function tick() {
    try {
      const [s, c, a] = await Promise.all([get("state.json"), get("chart.json"), get("activity.json")]);
      state = s; chart = c; activity = a; lastOk = Date.now(); lastErr = null;
    } catch (err) { lastErr = err.message || String(err); }
    renderHome(); renderChart(); renderActivity(); renderAccount(); renderErr();
  }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    ["home", "activity", "account"].forEach((t) => ($("tab-" + t).hidden = t !== b.dataset.tab));
  }));

  if (!base) { $("tab-home").hidden = true; $("setup").hidden = false; return; }
  tick(); setInterval(tick, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
})();
