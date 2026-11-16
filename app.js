// fomo desk app (plan B). Data comes from a secret gist; the gist id arrives once in
// the URL fragment (#d=...) and is kept in localStorage. Fragments are never sent to servers.
// Every FOMO link shown here comes from the desk's links.py (in the data), never built in the app.
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
    if (/^https:\/\//.test(v) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(v)) return v.replace(/\/$/, "");
    if (/^[0-9a-f]{20,40}$/i.test(v)) return `https://gist.githubusercontent.com/${OWNER}/${v}/raw`;
    return null;
  }

  const base = dataBase();
  let state = null, chart = null, activity = null, lastErr = null;
  let agentSel = "scanner", auSel = null, auLastKey = null, anSel = null;

  async function get(name) {
    const r = await fetch(`${base}/${name}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r.json();
  }

  const money = (n) => n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kusd = (v) => v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(1)}K`;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const tz = "Europe/Madrid";
  const hhmm = (iso) => iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—";
  const ago = (iso) => { if (!iso) return "—"; const s = Math.round((Date.now() - new Date(iso)) / 1000); return s < 60 ? `hace ${s}s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`; };
  const cls = (p) => p === true ? "ok" : p === false ? "red" : "grey";
  const alive = (k) => (state?.agents || []).find((a) => a.agent === k)?.alive;
  const head = (k, title) => `<div class="h"><span>${title}</span><span><span class="dot ${alive(k) ? "ok" : ""}"></span>${alive(k) ? "vivo" : "caído"}</span></div>`;
  const ring = (score, min, big) => `<div class="ring ${big ? "big" : ""}" data-v="${score ?? "—"}" style="--p:${score ?? 0};--c:${score != null && score >= min ? "var(--green)" : "var(--orange)"}"></div>`;

  // ---------------------------------------------------------------- agent cards (Home + carousel)
  function cardHTML(k) {
    const s = state || {}, c = s.counts || {}, au = s.auditor || {}, an = s.analyst || {};
    if (k === "scanner") return `${head(k, "1 · Scanner")}<div class="v">${c.pools ?? 0} pools</div><div class="s">${c.waiting ?? 0} en espera · ${c.scansPassed ?? 0} → auditor</div>`;
    if (k === "auditor") {
      const run = au.running, last = (au.recent || [])[0], layers = run ? run.layers : last ? last.layers : [];
      const strips = Array.from({ length: 8 }, (_, i) => { const l = layers.find((x) => x.n === i + 1); return `<i class="${l ? cls(l.pass) : run && i === layers.length ? "beam" : "grey"}"></i>`; }).join("");
      const line = run ? "taking apart..." : last ? (last.passed ? "8/8 → Executor" : esc(last.reason)) : "esperando monedas";
      return `${head(k, "2 · Auditor")}<div class="v">${au.takenApart ?? 0} taken apart</div><div class="strips">${strips}</div><div class="s">${line} · ${au.rejected ?? 0} rejected</div>`;
    }
    if (k === "analyst") {
      const last = (an.recent || [])[0];
      return `${head(k, "3 · Analyst")}<div class="v">Scoring</div><div class="s rp">${an.scored ?? 0} puntuadas · ${an.passed ?? 0} → executor<br>${an.mode === "rules" ? "reglas" : "Jev"}</div>${ring(last?.score, an.minScore ?? 70)}`;
    }
    if (k === "executor") {
      const ex = s.executor || {}, last = (ex.recent || [])[0];
      const line = last ? (last.status.startsWith("skipped") ? `${esc(last.name || "")}: ${esc(last.status.slice(9))}` : `${esc(last.name || "")} · ${money(last.sizeUsd)}`) : "esperando señales";
      return `${head(k, "4 · Executor")}<div class="v">${ex.signals ?? 0} señales</div><div class="s">${line}<br>${ex.stackPct ?? 8}% stack · mín ${money(ex.minTicket)}</div>`;
    }
    if (k === "risk") return `${head(k, "5 · Risk")}<div class="v">${c.open ? "Guarding" : "Sin posiciones"}</div><div class="s"><span class="why" style="font-size:12px">stop -${s.settings?.["risk.stop_pct"]}%</span> · <span class="okt" style="font-size:12px">trail ${s.settings?.["risk.trail_pct"]}%</span></div>`;
    return "";
  }
  const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];

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
    $("cards").innerHTML = AGENTS.map((k) => `<div class="card" data-agent="${k}">${cardHTML(k)}</div>`).join("") +
      `<div class="card"><div class="h"><span>FOMO</span></div><div class="v">@${esc(s.fomoHandle)}</div><div class="s">PAPER: no se toca dinero</div></div>`;
    document.querySelectorAll("#cards .card[data-agent]").forEach((el) => el.onclick = () => { agentSel = el.dataset.agent; openTab("agents"); });
    const pos = s.positions || [];
    $("positions").innerHTML = pos.length ? pos.map((x) => `<div class="row"><div>${esc(x.name || x.mint.slice(0, 6))}<div class="sub">${money(x.sizeUsd)}</div></div><a href="${esc(x.link)}" target="_blank" rel="noopener">FOMO</a></div>`).join("") : `<div class="empty">Ninguna posición abierta</div>`;
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
    const col = vs[vs.length - 1] >= vs[0] ? "#00d35a" : "#ff453a";
    const last = pts.length - 1;
    svg.innerHTML = (pts.length === 1 ? `<line x1="${P}" x2="${W - P}" y1="${y(vs[0])}" y2="${y(vs[0])}" stroke="${col}" stroke-width="2"/>` :
      `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>`) +
      `<circle cx="${x(last)}" cy="${y(vs[last])}" r="3.5" fill="${col}"/>`;
  }

  // ---------------------------------------------------------------- Agents tab
  function renderAgents() {
    if (!state) return;
    $("carousel").innerHTML = AGENTS.map((k) => `<div class="card ${k === agentSel ? "sel" : ""}" data-agent="${k}">${cardHTML(k)}</div>`).join("");
    document.querySelectorAll("#carousel .card").forEach((el) => el.onclick = () => { agentSel = el.dataset.agent; auLastKey = null; renderAgents(); });
    const d = $("agent-detail");
    if (agentSel === "scanner") d.innerHTML = scannerDetail();
    else if (agentSel === "auditor") { d.innerHTML = auditorDetail(); bindAuditor(); }
    else if (agentSel === "analyst") { d.innerHTML = analystDetail(); bindAnalyst(); }
    else if (agentSel === "executor") d.innerHTML = executorDetail();
    else d.innerHTML = `<div class="detail-title">Risk</div><div class="detail-sub">Decide las salidas y te manda el botón Sell.</div><div class="list"><div class="empty">Sin posiciones abiertas.</div></div>`;
  }

  function executorDetail() {
    const ex = state.executor || {}, recent = ex.recent || [];
    const sub = `Tamaño = mín(${ex.stackPct}% del stack, ${ex.maxPoolPct}% de la liquidez); por debajo de ${money(ex.minTicket)} → ${ex.belowMin === "bump" ? "sube al mínimo" : "salta"}. PAPER: rellena solo al precio de la señal. Nunca compra de verdad.`;
    const list = recent.length ? recent.map((r) => {
      const sk = r.status.startsWith("skipped");
      return `<div class="row${sk ? " killed" : ""}"><div>${esc(r.name || r.mint.slice(0, 6))}<div class="sub">${hhmm(r.ts)} · ${sk ? esc(r.status.slice(9)) : `${money(r.sizeUsd)} · ${r.stackPct}% · ${esc(r.status)}`}</div></div><a href="${esc(r.link)}" target="_blank" rel="noopener">FOMO</a></div>`;
    }).join("") : `<div class="empty">Ninguna señal todavía</div>`;
    return `<div class="detail-title">Executor</div><div class="detail-sub">${ex.signals ?? 0} señales · ${ex.skipped ?? 0} saltadas · ${ex.ownerBought ?? 0} compradas por ti<br>${sub}</div><div class="list">${list}</div>`;
  }

  function scannerDetail() {
    const feed = state.scannerFeed || [], c = state.counts || {};
    const rows = feed.length ? feed.map((r) => r.verdict === "pass"
      ? `<div class="row"><div>${esc(r.name || r.mint.slice(0, 6))} · liq ${kusd(r.liquidityUsd)} · → auditor<div class="sub">${hhmm(r.ts)}</div></div><a href="${esc(r.link)}" target="_blank" rel="noopener">FOMO</a></div>`
      : `<div class="row killed"><div><s>${esc(r.name || r.mint.slice(0, 6))}</s><div class="sub">${hhmm(r.ts)}</div></div><div class="why">${esc(r.reason)}</div></div>`).join("")
      : `<div class="empty">Esperando graduaciones</div>`;
    return `<div class="detail-title">Scanner</div><div class="detail-sub">${c.pools ?? 0} pools · ${c.waiting ?? 0} en espera · ${c.scansPassed ?? 0} pasadas · ${c.scansKilled ?? 0} cortadas</div><div class="list">${rows}</div>`;
  }

  function auditorDetail() {
    const au = state.auditor || {}, recent = au.recent || [];
    const a = au.running || recent.find((r) => r.mint === auSel) || recent[0];
    let body;
    if (!a) body = `<div class="list"><div class="empty">Esperando la primera moneda del Scanner</div></div>`;
    else {
      const key = a.mint + ":" + a.layers.map((l) => l.pass).join(",") + (au.running ? ":run" : "");
      const animate = key !== auLastKey; auLastKey = key;
      const byN = Object.fromEntries(a.layers.map((l) => [l.n, l]));
      const checked = a.layers.filter((l) => l.pass !== null).length;
      const discs = Array.from({ length: 8 }, (_, i) => {
        const l = byN[i + 1]; const st = l ? cls(l.pass) : (au.running && i === checked ? "scan" : "grey");
        const an = animate && l && l.pass !== null;
        return `<div class="disc ${st} ${an ? "anim" : ""}" ${an ? `style="animation-delay:${i * 0.35}s"` : ""}><div class="dr"><span>${st === "ok" ? "✓" : st === "red" ? "✕" : i + 1}</span></div><div class="dl"><b>${i + 1} · ${esc(l?.name || "")}</b><em>${esc(l?.value || (au.running ? "…" : "not checked"))}</em></div><div class="beamline"></div></div>`;
      }).join("");
      const verdict = au.running ? `<div class="pill run">taking apart...</div>` : a.passed ? `<div class="pill ok">8/8 → Executor</div>` : `<div class="pill red">${esc(a.reason)}</div><div class="sub2">Rejected · Skipped</div>`;
      body = `<div class="au-coin"><div class="au-name">${esc(a.name || a.mint.slice(0, 6))} <span>${esc(a.symbol || "")}</span></div><a href="${esc(a.link)}" target="_blank" rel="noopener">FOMO</a></div><div class="au-stack">${discs}</div><div class="verdict">${verdict}</div>`;
    }
    const list = recent.length ? recent.map((r) => `<div class="row au-row" data-mint="${esc(r.mint)}"><div>${esc(r.name || r.mint.slice(0, 6))}<div class="sub">${hhmm(r.ts)} · ${r.layersChecked}/8</div></div><div class="${r.passed ? "okt" : "why"}">${r.passed ? "8/8" : esc(r.reason)}</div></div>`).join("") : `<div class="empty">Ninguna moneda auditada todavía</div>`;
    return `<div class="au-head"><div><div class="detail-title">Auditor</div><div class="detail-sub">${au.layer8Down ? `capa 8 caída · ${au.layer8Kills} monedas en rojo` : `${au.rejected ?? 0} rejected`}</div></div><div class="au-count"><b>${au.takenApart ?? 0}</b><span>taken apart</span></div></div>${body}<h3>Recientes</h3><div class="list">${list}</div>`;
  }
  function bindAuditor() { document.querySelectorAll(".au-row").forEach((el) => el.onclick = () => { auSel = el.dataset.mint; auLastKey = null; renderAgents(); }); }

  function analystDetail() {
    const an = state.analyst || {}, recent = an.recent || [], g = an.gate || {};
    const v = recent.find((r) => r.mint === anSel) || recent[0];
    let top;
    if (!v) top = `<div class="list"><div class="empty">Esperando monedas que pasen el Auditor</div></div>`;
    else {
      const a = v.answers || {};
      const bar = (name, val, lim, isMax) => {
        if (val == null) return `<div class="bar"><div><span>${name}</span><b>—</b></div><div class="t"></div></div>`;
        const ok = lim == null ? null : isMax ? val <= lim : val >= lim;
        return `<div class="bar ${ok == null ? "neu" : ok ? "okb" : "badb"}"><div><span>${name}${lim != null ? ` (${isMax ? "≤" : "≥"} ${lim})` : ""}</span><b>${val.toFixed(2)}</b></div><div class="t"><i style="width:${Math.round(val * 100)}%"></i>${lim != null ? `<u style="left:${lim * 100}%"></u>` : ""}</div></div>`;
      };
      top = `<div class="au-coin"><div class="au-name">${esc(v.name || v.mint.slice(0, 6))} <span>${esc(v.symbol || "")}</span></div><a href="${esc(v.link)}" target="_blank" rel="noopener">FOMO</a></div>
        <div class="an-top">${ring(v.score, an.minScore ?? 70, true)}<div class="bars">${bar("alive_6h", a.alive_6h, g.min_alive_6h, false)}${bar("organic", a.organic, g.min_organic, false)}${bar("flush", a.flush, null)}${bar("chase", a.chase, g.max_chase, true)}</div></div>
        <div class="verdict">${v.passed ? `<div class="pill ok">${v.score} → Executor</div>` : `<div class="pill red">${esc(v.reason)}</div><div class="sub2">Rejected · Skipped</div>`}</div>`;
    }
    const list = recent.length ? recent.map((r) => `<div class="row an-row" data-mint="${esc(r.mint)}"><div>${esc(r.name || r.mint.slice(0, 6))}<div class="sub">${hhmm(r.ts)}</div></div><div class="${r.passed ? "okt" : "why"}">${r.score ?? "—"} · ${r.passed ? "pass" : esc(r.reason)}</div></div>`).join("") : `<div class="empty">Ninguna moneda puntuada todavía</div>`;
    return `<div class="au-head"><div><div class="detail-title">Analyst</div><div class="detail-sub">${an.mode === "rules" ? "Modo reglas (sin Jev) · 0 tokens" : "Jev"} · verde desde ${an.minScore ?? 70}</div></div><div class="au-count"><b>${an.scored ?? 0}</b><span>scored</span></div></div>${top}<h3>Recientes</h3><div class="list">${list}</div>`;
  }
  function bindAnalyst() { document.querySelectorAll(".an-row").forEach((el) => el.onclick = () => { anSel = el.dataset.mint; renderAgents(); }); }

  // ---------------------------------------------------------------- Activity / Account / errors
  function renderActivity() {
    const rows = activity?.rows || [];
    $("activity").innerHTML = rows.length ? rows.map((r) => `<div class="row"><div>${esc(r.title)}<div class="sub">${hhmm(r.ts)} · ${esc(r.subtitle || "")}</div></div><div class="${r.kind === "rejected" ? "why" : ""}">${esc(r.value || "")}</div></div>`).join("") : `<div class="empty">Sin actividad todavía</div>`;
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
    const w = $("warnrow"), ws = state?.warnings || [];
    w.hidden = !ws.length; w.textContent = ws.join(" · ");
  }

  async function tick() {
    try {
      const [s, c, a] = await Promise.all([get("state.json"), get("chart.json"), get("activity.json")]);
      // raw gist replicas can briefly serve an older copy: never step backwards
      if (!state || !state.updatedAt || s.updatedAt >= state.updatedAt) { state = s; chart = c; activity = a; }
      lastErr = null;
    } catch (err) { lastErr = err.message || String(err); }
    renderHome(); renderChart(); renderAgents(); renderActivity(); renderAccount(); renderErr();
  }

  const TABS = ["home", "agents", "activity", "account"];
  function openTab(t) {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === t));
    TABS.forEach((x) => ($("tab-" + x).hidden = x !== t));
    if (t === "agents") { renderAgents(); document.querySelector("#carousel .card.sel")?.scrollIntoView({ inline: "center", block: "nearest" }); }
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab)));

  if (!base) { $("tab-home").hidden = true; $("setup").hidden = false; return; }
  const q = new URLSearchParams(location.search);   // e.g. ?tab=agents&agent=auditor
  if (q.get("agent") && AGENTS.includes(q.get("agent"))) agentSel = q.get("agent");
  tick().then(() => { const t = q.get("tab") === "auditor" ? "agents" : q.get("tab"); if (TABS.includes(t)) openTab(t); });
  if (q.get("tab") === "auditor") agentSel = "auditor";
  setInterval(tick, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
})();
