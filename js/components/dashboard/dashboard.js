// dashboard.js — Dark pro, full width, dropdown custom y datos "reales" vía integración.
// Integra con el aside (margen 72/280) y con el resto del sistema mediante:
//   1) CustomEvent: document.dispatchEvent(new CustomEvent("ui:data:update", {detail:{...}}))
//   2) API imperativa: const api = mount(el); api.update({ projects, estimates, materials, alerts, ... })
//
// Datos esperados en update()/props:
// - projects: [{id,name,status,progress,budget,variance}]  // o diccionario {id: {...}}
// - estimates: [{id, projectId, amount, createdAt}]        // o diccionario
// - materials: [{projectId, cost}]                         // o diccionario
// - alerts: [{level,color,icon?,text,ref,time}]
// - notifications: [{color,text}]
// - usage: [n1,n2,...]
// - period: "last-7" | "last-30" | "last-90" | "ytd"

export default function mount(el, props = {}) {
  ensureGlobalBackground();

  // ---------- normalizador universal
  const toArray = (x) => Array.isArray(x)
    ? x
    : (x && typeof x === "object")
      ? Object.values(x)
      : [];

  // ---------- estado de datos (se alimenta desde otras vistas)
  let state = {
    period: props.period ?? "last-30",
    projects: toArray(props.projects),
    estimates: toArray(props.estimates),
    materials: toArray(props.materials),
    alerts: toArray(props.alerts),
    notifications: toArray(props.notifications),
    usage: toArray(props.usage),
    username: String(props.username ?? "JHONN BENNET"),
    activity: toArray(props.activity),
  };

  // ---------- helpers de estilo base
  injectOnce("dashboard-css", `
    :root{
      --bg0:#0B0F14; --bg1:#0F1720; --bg2:#121926;
      --panel:#1E2835; --panel2:#233242;
      --line:rgba(255,255,255,.10); --line2:rgba(255,255,255,.06);
      --txt:#E5E7EB; --muted:#9CA3AF;
      --brand:#2563EB; --brand-2:#60A5FA;
    }
    .ds-shell{max-width:none;width:100%;margin-inline:auto}
    .ds-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px;backdrop-filter:blur(6px)}
    .ds-card h3{font-weight:600;color:var(--txt)}
    .ds-hint{font-size:12px;color:var(--muted)}
    .ds-btn{border-radius:12px;padding:10px 16px;background:var(--brand);color:#fff;border:1px solid var(--line)}
    .ds-btn:hover{background:#1d4ed8}
    .ds-tab{padding-bottom:12px;border-bottom:2px solid transparent;color:var(--muted)}
    .ds-tab[aria-selected="true"]{color:#fff;border-color:#3b82f6}
    .ds-table thead th{font-weight:600;color:#94A3B8}
    .ds-table tbody tr{border-top:1px solid var(--line2)}
    .ds-table tbody tr:nth-child(odd){background:rgba(255,255,255,.02)}
    .ds-table tbody tr:hover{background:rgba(255,255,255,.06)}
    .ds-badge{padding:.125rem .5rem;border-radius:9999px;font-size:12px}
    .ds-progress{height:8px;border-radius:9999px;background:rgba(255,255,255,.12);overflow:hidden}
    .ds-progress>span{display:block;height:100%;background:#3b82f6}
    /* layout full-width */
    .g{display:grid;gap:18px}
    .g-2{display:grid;gap:18px}
    .g-kpi{display:grid;gap:18px}
    @media(min-width:768px){.g-2{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(min-width:640px){.g-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(min-width:1100px){.g-kpi{grid-template-columns:repeat(4,minmax(0,1fr))}}
    /* inputs */
    .ds-search{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--panel2)}
    .ds-search input{background:transparent;border:0;outline:0;color:var(--txt);font-size:14px;width:100%}
    .ds-search input::placeholder{color:var(--muted)}
    /* custom select (dropdown oscuro 100%) */
    .sel{position:relative}
    .sel-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);color:var(--txt);font-size:14px}
    .sel-btn:focus{outline:2px solid #3b82f6;outline-offset:2px}
    .sel-list{position:absolute;top:100%;left:0;z-index:50;margin-top:6px;min-width:180px;background:#0F1720;border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:6px;display:none}
    .sel[open] .sel-list{display:block}
    .sel-item{padding:8px 10px;border-radius:8px;color:#E5E7EB;cursor:pointer;white-space:nowrap}
    .sel-item:hover{background:#233242}
  `);

  // ---------- UI skeleton
  el.innerHTML = `
    <section class="transition-all duration-200 px-4 md:px-8 py-6 text-[15px] text-[var(--txt)]" data-shell>
      <div class="ds-shell">
        <header>
          <h1 class="text-[32px] md:text-[44px] font-extrabold leading-[1.12] text-white tracking-tight">
            Welcome back, ${escapeHTML(state.username)}.
          </h1>
          <p class="text-[14px] text-[var(--muted)] mt-1">Your operational overview and recent activity.</p>
        </header>

        <!-- Controls -->
        <div class="mt-6 g" style="grid-template-columns:1fr auto;align-items:center;">
          <div class="g" style="grid-template-columns:auto 1fr;gap:12px;">
            <div class="sel" data-role="period-select"></div>
            <div class="ds-search">
              ${searchIcon()}
              <input id="search" data-role="search" type="search" placeholder="Search projects, estimates, suppliers… (Ctrl/Cmd + F)"/>
            </div>
          </div>
          <button class="ds-btn" data-role="export">Export CSV</button>
        </div>

        <!-- Tabs -->
        <div class="mt-6 border-b border-[var(--line)]">
          <nav class="-mb-px flex gap-6 text-sm" role="tablist">
            <button class="ds-tab" data-tab="overview" aria-selected="true">Overview</button>
            <button class="ds-tab" data-tab="activity" aria-selected="false">Activity</button>
          </nav>
        </div>

        <!-- OVERVIEW -->
        <div data-panel="overview" class="mt-6 g">
          <section class="g-kpi">
            <div data-kpi="active"    class="ds-card"></div>
            <div data-kpi="estMonth"  class="ds-card"></div>
            <div data-kpi="avgMat"    class="ds-card"></div>
            <div data-kpi="openAlerts"class="ds-card"></div>
          </section>

          <section class="g-2">
            <div class="ds-card">
              <div class="flex items-center justify-between">
                <h3>Usage history</h3>
                <span class="ds-hint">Events per week</span>
              </div>
              <div class="mt-3" data-chart="usage"></div>
            </div>
            <div class="ds-card">
              <div class="flex items-center justify-between">
                <h3>Estimates</h3>
                <span class="ds-hint">Last 12 weeks</span>
              </div>
              <div class="mt-3" data-chart="estimates"></div>
            </div>
          </section>

          <section class="ds-card">
            <div class="flex items-center justify-between">
              <h3>Projects</h3>
              <span class="ds-hint">Filtered by search &amp; period</span>
            </div>
            <div class="mt-3 overflow-x-auto">
              <table class="ds-table w-full text-sm">
                <thead>
                  <tr>
                    <th class="text-left py-2 pr-3">ID</th>
                    <th class="text-left py-2 pr-3">Name</th>
                    <th class="text-left py-2 pr-3">Status</th>
                    <th class="text-left py-2 pr-3">Progress</th>
                    <th class="text-left py-2 pr-3">Budget</th>
                    <th class="text-left py-2">Variance</th>
                  </tr>
                </thead>
                <tbody data-role="rows"></tbody>
              </table>
            </div>
          </section>

          <section class="g-2">
            <div class="ds-card">
              <div class="flex items-center justify-between">
                <h3>Alerts</h3>
                <span class="ds-hint" data-count="alerts"></span>
              </div>
              <ul class="mt-3 space-y-3" data-role="alerts"></ul>
            </div>
            <div class="ds-card">
              <div class="flex items-center justify-between">
                <h3>Notifications</h3>
                <span class="ds-hint" data-count="notifs"></span>
              </div>
              <ul class="mt-3 space-y-3" data-role="notifs"></ul>
            </div>
          </section>
        </div>

        <!-- ACTIVITY -->
        <div data-panel="activity" hidden class="mt-6">
          <section class="ds-card">
            <h3>Recent activity</h3>
            <ul class="mt-3 space-y-4" data-role="activity"></ul>
          </section>
        </div>
      </div>
    </section>
  `;

  // ---------- refs
  const qs = (s) => el.querySelector(s);
  const shell = qs('[data-shell]');
  const rowsTbody = qs('[data-role="rows"]');
  const searchInput = qs('[data-role="search"]');
  const exportBtn = qs('[data-role="export"]');
  const panelOverview = qs('[data-panel="overview"]');
  const panelActivity = qs('[data-panel="activity"]');
  const tabBtns = el.querySelectorAll(".ds-tab");
  const periodHost = qs('[data-role="period-select"]');
  const usageChartHost = qs('[data-chart="usage"]');
  const estChartHost   = qs('[data-chart="estimates"]');
  const kpiActive      = qs('[data-kpi="active"]');
  const kpiEstMonth    = qs('[data-kpi="estMonth"]');
  const kpiAvgMat      = qs('[data-kpi="avgMat"]');
  const kpiOpenAlerts  = qs('[data-kpi="openAlerts"]');
  const alertsUl       = qs('[data-role="alerts"]');
  const notifsUl       = qs('[data-role="notifs"]');
  const countAlerts    = qs('[data-count="alerts"]');
  const countNotifs    = qs('[data-count="notifs"]');
  const activityUl     = qs('[data-role="activity"]');

  // ---------- margen según aside
  function asideExpanded() {
    const aside = document.querySelector('aside[data-aside]');
    return aside ? (aside.dataset.state === "expanded") : true;
  }
  function applyShellMargin() { shell.style.marginLeft = asideExpanded() ? "280px" : "72px"; }
  applyShellMargin();
  const onAsideToggle = () => applyShellMargin();
  document.addEventListener("ui:sidebar:toggle", onAsideToggle);

  // ---------- dropdown custom (oscuro)
  const periodOptions = [
    { value:"last-7",  label:"Last 7 days"  },
    { value:"last-30", label:"Last 30 days" },
    { value:"last-90", label:"Last 90 days" },
    { value:"ytd",     label:"Year to date" },
  ];
  const periodDD = makeDarkSelect(periodHost, periodOptions, state.period, (val)=>{
    state.period = val;
    el.dispatchEvent(new CustomEvent("ui:dashboard:filter", { bubbles:true, detail:{ period: val }}));
    renderAll();
  });

  // ---------- eventos UI
  searchInput.addEventListener("input", renderRows);
  exportBtn.addEventListener("click", () => {
    const visible = filterProjects(toArray(state.projects), searchInput.value.trim().toLowerCase());
    const csv = toCSV([
      ["ID","Name","Status","Progress","Budget","Variance"],
      ...visible.map(r => [r.id, r.name, r.status, r.progress + "%", r.budget, r.variance]),
    ]);
    downloadFile(`dashboard_${state.period}.csv`, csv, "text/csv");
  });
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const currentTab = btn.dataset.tab;
      tabBtns.forEach(b => b.setAttribute("aria-selected", String(b === btn)));
      panelOverview.hidden = currentTab !== "overview";
      panelActivity.hidden = currentTab !== "activity";
    });
  });
  // atajo
  const onKey = (e) => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault(); searchInput.focus();
    }
  };
  document.addEventListener("keydown", onKey);

  // ---------- integración: evento global para actualizar datos
  const onDataUpdate = (ev) => { update(ev.detail || {}); };
  document.addEventListener("ui:data:update", onDataUpdate);

  // ---------- render inicial
  if (toArray(state.projects).length === 0) {
    state.projects = [
      { id:"PR-01", name:"Warehouse Retrofit", status:"Active", progress:78, budget:120000, variance:+4.2 },
      { id:"PR-02", name:"Solar Roof Phase II", status:"Active", progress:40, budget: 90000, variance:-1.1 },
      { id:"PR-03", name:"HVAC Upgrade",       status:"Paused", progress:22, budget: 54000, variance:+0.4 },
    ];
  }
  renderAll();

  // ---------- API pública
  const api = {
    update, // api.update({projects, estimates, materials, alerts, notifications, usage, period})
    destroy() {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("ui:sidebar:toggle", onAsideToggle);
      document.removeEventListener("ui:data:update", onDataUpdate);
      periodDD.destroy();
    }
  };
  return api;

  // ================== lógica de render y datos ==================

  function update(patch) {
    if (!patch || typeof patch !== "object") return;
    if ("projects"      in patch) state.projects      = toArray(patch.projects);
    if ("estimates"     in patch) state.estimates     = toArray(patch.estimates);
    if ("materials"     in patch) state.materials     = toArray(patch.materials);
    if ("alerts"        in patch) state.alerts        = toArray(patch.alerts);
    if ("notifications" in patch) state.notifications = toArray(patch.notifications);
    if ("usage"         in patch) state.usage         = toArray(patch.usage);
    if ("activity"      in patch) state.activity      = toArray(patch.activity);
    if ("period"        in patch && patch.period) {
      state.period = patch.period;
      periodDD.setValue(patch.period);
    }
    if ("username"      in patch && patch.username) state.username = String(patch.username);
    renderAll();
  }

  function renderAll() {
    renderKPIs();
    renderCharts();
    renderRows();
    renderAlertsNotifs();
    renderActivity();
  }

  // ---- KPIs derivados REALES de datasets
  function renderKPIs() {
    const projects = toArray(state.projects);
    const actives = projects.filter(p => (p.status||"").toLowerCase()==="active").length;
    const estCount = countEstimatesInPeriod(toArray(state.estimates), state.period);
    const avgCost = computeAvgMaterialCost(toArray(state.materials));
    const openA = toArray(state.alerts).length;

    kpiActive.innerHTML     = kpiCard("Active Projects", actives, "All running projects", "#10B981", "#34D399");
    kpiEstMonth.innerHTML   = kpiCard("Estimates this period", estCount, "Submitted for approval", "#3B82F6", "#60A5FA");
    kpiAvgMat.innerHTML     = kpiCard("Avg. material cost", dollar(avgCost), "Per project", "#06B6D4", "#22D3EE");
    kpiOpenAlerts.innerHTML = kpiCard("Open alerts", openA, "Overbudget or delays", "#F43F5E", "#FB7185");
  }

  function renderCharts() {
    const usageSeries = makeUsageSeries(toArray(state.usage), state.period);
    usageChartHost.innerHTML = sparkline(usageSeries, 960, 200);

    const estSeries = makeEstimatesSeries(toArray(state.estimates), state.period);
    estChartHost.innerHTML = miniBars(estSeries, 960, 200);
  }

  function renderRows() {
    const projects = toArray(state.projects);
    const q = searchInput.value.trim().toLowerCase();
    const data = filterProjects(projects, q);
    rowsTbody.innerHTML = data.map(r => `
      <tr class="cursor-pointer" data-id="${escapeAttr(r.id)}" tabindex="0">
        <td class="py-2 pr-3 text-white font-medium">
          <a href="#project/${escapeAttr(r.id)}" class="underline decoration-transparent hover:decoration-[#9CA3AF]">${escapeHTML(r.id)}</a>
        </td>
        <td class="py-2 pr-3" style="color:#D1D5DB">${escapeHTML(r.name)}</td>
        <td class="py-2 pr-3">${statusBadge(r.status)}</td>
        <td class="py-2 pr-3">${progressBar(r.progress)}</td>
        <td class="py-2 pr-3">$ ${formatNumber(r.budget)}</td>
        <td class="py-2">${varianceBadge(r.variance)}</td>
      </tr>
    `).join("");

    rowsTbody.querySelectorAll("tr").forEach(tr => {
      tr.addEventListener("click", () => emitNavigate(`#project/${tr.dataset.id}`));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") emitNavigate(`#project/${tr.dataset.id}`); });
    });
  }

  function renderAlertsNotifs() {
    const alerts = toArray(state.alerts);
    const notifs = toArray(state.notifications);
    countAlerts.textContent = `${alerts.length} total`;
    alertsUl.innerHTML = alerts.map(a => alertItem(a)).join("");
    countNotifs.textContent = `${notifs.length} unread`;
    notifsUl.innerHTML = notifs.map(n => `
      <li class="flex items-center gap-3 text-sm">
        <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${escapeHTML(n.color || "#64748B")}"></span>
        <span>${escapeHTML(n.text || "—")}</span>
      </li>
    `).join("");
  }

  function renderActivity() {
    const activity = toArray(state.activity);
    if (!activity.length) {
      activityUl.innerHTML = `<li class="text-sm" style="color:var(--muted)">No recent activity.</li>`;
      return;
    }
    activityUl.innerHTML = activity.map(a => activityItem(a)).join("");
  }

  // ================== componentes UI ==================

  function makeDarkSelect(host, options, value, onChange) {
    host.classList.add("sel");
    host.innerHTML = `
      <button type="button" class="sel-btn" data-role="btn">
        <span data-role="label"></span> ${chevDown()}
      </button>
      <div class="sel-list" role="listbox" data-role="list"></div>
    `;
    const btn  = host.querySelector('[data-role="btn"]');
    const lab  = host.querySelector('[data-role="label"]');
    const list = host.querySelector('[data-role="list"]');

    function setValue(v) {
      value = v;
      const opt = options.find(o => o.value === v) || options[0];
      lab.textContent = opt.label;
      if (onChange) onChange(v);
    }
    function toggle(open) {
      if (open === undefined) host.toggleAttribute("open");
      else if (open) host.setAttribute("open",""); else host.removeAttribute("open");
    }
    function closeOnOutside(e){
      if (!host.contains(e.target)) toggle(false);
    }

    list.innerHTML = options.map(o => `
      <div class="sel-item" data-val="${escapeAttr(o.value)}">${escapeHTML(o.label)}</div>
    `).join("");

    btn.addEventListener("click", () => toggle());
    list.querySelectorAll(".sel-item").forEach(it=>{
      it.addEventListener("click", ()=>{
        toggle(false);
        setValue(it.dataset.val);
      });
    });
    document.addEventListener("click", closeOnOutside);

    setValue(value);

    return {
      setValue,
      destroy(){ document.removeEventListener("click", closeOnOutside); }
    };
  }

  // ================== piezas visuales ==================

  function kpiCard(title, value, hint, c1="#3B82F6", c2="#60A5FA") {
    const grad = `background:linear-gradient(135deg, ${c1}, ${c2});`;
    return `
      <div class="ds-card" style="min-height:120px;display:flex;flex-direction:column;justify-content:space-between">
        <div class="text-sm" style="color:var(--muted)">${escapeHTML(title)}</div>
        <div class="mt-2 flex items-end justify-between">
          <div class="text-[26px] md:text-[28px] font-extrabold text-white">${escapeHTML(String(value))}</div>
          <div class="h-7 w-7 rounded-md opacity-95" style="${grad}"></div>
        </div>
        <div class="mt-2 ds-hint">${escapeHTML(hint)}</div>
      </div>
    `;
  }

  function progressBar(pct) {
    const pc = Math.max(0, Math.min(100, Number(pct) || 0));
    return `
      <div style="width:180px;max-width:40vw">
        <div class="ds-progress"><span style="width:${pc}%"></span></div>
        <div class="text-xs" style="color:var(--muted);margin-top:4px">${pc}%</div>
      </div>
    `;
  }

  function statusBadge(s) {
    const map = {
      Active:   "background:rgba(16,185,129,.18);color:#6EE7B7;",
      Paused:   "background:rgba(245,158,11,.18);color:#FCD34D;",
      Planning: "background:rgba(14,165,233,.18);color:#7DD3FC;",
      Closed:   "background:rgba(148,163,184,.18);color:#CBD5E1;",
    };
    return `<span class="ds-badge" style="${map[s] || map.Closed}">${escapeHTML(s)}</span>`;
  }

  function varianceBadge(v) {
    const n = Number(v) || 0;
    const cls  = n > 0 ? "color:#86EFAC;" : n < 0 ? "color:#FCA5A5;" : "color:#CBD5E1;";
    const sym  = n > 0 ? "▲" : n < 0 ? "▼" : "◼";
    return `<span style="${cls}">${sym} ${Math.abs(n).toFixed(1)}%</span>`;
  }

  function activityItem(a) {
    const tone = a.tone || "neutral";
    const dot  = tone === "positive" ? "#10B981" : tone === "negative" ? "#F43F5E" : "#64748B";
    return `
      <li class="flex items-start gap-3">
        <span class="mt-1 w-2.5 h-2.5 rounded-full" style="background:${dot}"></span>
        <div class="flex-1 text-sm">
          <div class="text-[#E5E7EB]">
            <b>${escapeHTML(a.who)}</b> ${escapeHTML(a.what)}
            <a href="#project/${escapeAttr(a.ref)}" class="text-white underline decoration-transparent hover:decoration-[#9CA3AF]">${escapeHTML(a.ref)}</a>
          </div>
          <div class="text-xs" style="color:var(--muted)">${escapeHTML(a.when)}</div>
        </div>
      </li>
    `;
  }

  function alertItem(a) {
    return `
      <li class="flex items-start gap-3">
        <span class="mt-0.5 w-6 h-6 rounded-md flex items-center justify-center" style="background:${a.color || "#64748B"}1A">
          ${a.icon || infoIcon()}
        </span>
        <div class="flex-1">
          <div class="text-sm" style="color:#E5E7EB">${escapeHTML(a.text)} <a href="#project/${escapeAttr(a.ref)}" class="underline decoration-transparent hover:decoration-[#9CA3AF]">${escapeHTML(a.ref)}</a></div>
          <div class="text-xs" style="color:var(--muted)">${escapeHTML(a.level || "Info")} • ${escapeHTML(a.time || "")}</div>
        </div>
      </li>
    `;
  }

  // ================== charts (SVG)

  function sparkline(values, width = 960, height = 200) {
    const pads = { l: 16, r: 16, t: 16, b: 28 };
    const xs = values.map((_, i) => lerp(pads.l, width - pads.r, i / (values.length - 1 || 1)));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const ys = values.map((v) => mapRange(v, min, max, height - pads.b, pads.t));
    const path = xs.map((x, i) => (i === 0 ? `M${x},${ys[i]}` : `L${x},${ys[i]}`)).join(" ");
    const area = `${path} L${width - pads.r},${height - pads.b} L${pads.l},${height - pads.b} Z`;

    return `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="block">
        <defs>
          <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#60A5FA" stop-opacity="0.7"></stop>
            <stop offset="100%" stop-color="#60A5FA" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#g1)"></path>
        <path d="${path}" stroke="#93C5FD" stroke-width="2.6" fill="none"></path>
        ${xs.map((x, i) => `<circle cx="${x}" cy="${ys[i]}" r="2.8" fill="#BFDBFE"></circle>`).join("")}
      </svg>
    `;
  }

  function miniBars(values, width = 960, height = 200) {
    const pads = { l: 18, r: 18, t: 18, b: 30 };
    const w = (width - pads.l - pads.r) / values.length;
    theMax: {
    }
    const max = Math.max(...values, 1);
    return `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="block">
        ${values.map((v, i) => {
          const x = pads.l + i * w + 4;
          const h = (v / max) * (height - pads.t - pads.b);
          const y = height - pads.b - h;
          return `<rect x="${x}" y="${y}" width="${w - 8}" height="${h}" rx="6" ry="6" fill="#22D3EE" opacity="0.95"></rect>`;
        }).join("")}
      </svg>
    `;
  }

  // ================== data utils (reales)

  function countEstimatesInPeriod(estimates, period) {
    if (!Array.isArray(estimates) || !estimates.length) return 0;
    const now = new Date();
    const from = periodStart(now, period);
    return estimates.filter(e => {
      const d = new Date(e.createdAt || e.date || now);
      return d >= from && d <= now;
    }).length;
  }

  function computeAvgMaterialCost(materials) {
    if (!Array.isArray(materials) || !materials.length) return 0;
    const sum = materials.reduce((a,m)=> a + (Number(m.cost)||0), 0);
    return sum / materials.length;
  }

  function makeUsageSeries(usage, period) {
    if (Array.isArray(usage) && usage.length) return usage;
    const len = period==="last-7" ? 7 : period==="last-90" ? 12 : 12;
    return Array.from({length:len}, (_,i)=> (i%5)+5);
  }

  function makeEstimatesSeries(estimates, period) {
    const buckets = 12;
    const arr = Array.from({length:buckets}, ()=>0);
    if (!Array.isArray(estimates) || !estimates.length) return arr;
    const now = new Date();
    const start = periodStart(now, period);
    const span = now - start;
    for (const e of estimates) {
      const d = new Date(e.createdAt || e.date || now);
      if (d < start || d > now) continue;
      const idx = Math.min(buckets-1, Math.floor(((d - start) / span) * buckets));
      arr[idx] += 1;
    }
    return arr;
  }

  function periodStart(now, period) {
    const d = new Date(now);
    if (period==="last-7")  d.setDate(d.getDate()-7);
    else if (period==="last-30") d.setDate(d.getDate()-30);
    else if (period==="last-90") d.setDate(d.getDate()-90);
    else if (period==="ytd") d.setMonth(0,1), d.setHours(0,0,0,0);
    return d;
  }

  // ================== utils comunes

  function toCSV(rows) {
    return rows.map(r => r.map(c => `"${String(c).replaceAll('"','""')}"`).join(",")).join("\n");
  }
  function downloadFile(name, content, type = "text/plain") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 400);
  }
  function emitNavigate(href) {
    const ev = new CustomEvent("ui:navigate", { bubbles:true, cancelable:true, detail:{ href } });
    const cancelled = !el.dispatchEvent(ev) ? true : ev.defaultPrevented;
    if (!cancelled) location.hash = href;
  }
  function filterProjects(rows, q) {
    const list = Array.isArray(rows) ? rows : toArray(rows);
    if (!q) return list;
    const t = q.toLowerCase();
    return list.filter(r =>
      String(r.id).toLowerCase().includes(t) ||
      String(r.name).toLowerCase().includes(t) ||
      String(r.status).toLowerCase().includes(t)
    );
  }
  function dollar(n){ try{ return "$ " + Number(n||0).toLocaleString("en-US",{maximumFractionDigits:0}); }catch{return "$ "+String(n)} }
  function formatNumber(n){ try{ return Number(n).toLocaleString("en-US",{maximumFractionDigits:0}); }catch{return String(n)} }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function mapRange(v,inMin,inMax,outMin,outMax){ if(inMax===inMin) return (outMin+outMax)/2; const k=(v-inMin)/(inMax-inMin); return outMin+k*(outMax-outMin); }
  function escapeHTML(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }
  function escapeAttr(s){ return escapeHTML(String(s)).replaceAll('"',"&quot;"); }

  // icons
  function searchIcon(){ return `<svg width="18" height="18" viewBox="0 0 24 24" fill="#9CA3AF"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 5 1.5-1.5-5-5zM4 9.5C4 6.46 6.46 4 9.5 4S15 6.46 15 9.5 12.54 15 9.5 15 4 12.54 4 9.5z"/></svg>`; }
  function chevDown(){ return `<svg width="16" height="16" viewBox="0 0 24 24" fill="#9CA3AF"><path d="M7 10l5 5 5-5z"/></svg>`; }
  function infoIcon(){ return `<svg width="14" height="14" viewBox="0 0 24 24" fill="#22D3EE"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`; }
  function warnIcon(){ return `<svg width="14" height="14" viewBox="0 0 24 24" fill="#F43F5E"><path d="M1 21h22L12 2 1 21zm12-3h-2v2h2v-2zm0-8h-2v6h2V10z"/></svg>`; }
  function clockIcon(){ return `<svg width="14" height="14" viewBox="0 0 24 24" fill="#F59E0B"><path d="M12 1a11 11 0 100 22 11 11 0 000-22zm1 11H7V9h4V4h2v8z"/></svg>`; }
}

// ===== fondo global dark
function ensureGlobalBackground() {
  injectOnce("dashboard-global-bg", `
    body{background:radial-gradient(1200px 600px at 20% 0%, #0F1720 0%, #0B0F14 60%, #0B0F14 100%); color:#E5E7EB}
  `);
}

// ===== inyección CSS única
function injectOnce(id, css) {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id; style.textContent = css; document.head.appendChild(style);
}
