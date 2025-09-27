// /js/components/project-management/project-management.js
// Project Management — Dark Pro, empty first, icon actions, sticky header, inline edit.
// Eventos que emite:
//   - pm:project:create { project }
//   - pm:project:update { project }
//   - pm:project:delete { id }
//   - ui:navigate       { href }
// Integración de datos:
//   document.dispatchEvent(new CustomEvent("ui:data:update",{detail:{projects:[...]}}))
//   const api = mount(el); api.update({projects:[...]})
// NOTA: La tabla comienza VACÍA por defecto. Solo se llena cuando creas o envías datos.

export default function mount(el, props = {}) {
  ensureGlobalBackground();

  const toArray = (x) => Array.isArray(x) ? x : (x && typeof x === "object") ? Object.values(x) : [];

  // Estado — arrancamos VACÍO aunque vengan props; si querés pre-cargar, usa api.update()
  let state = {
    title: String(props.title ?? "PROJECT MANAGEMENT"),
    projects: [], // <-- vacío por defecto
    sortBy: "startDate",
    sortDir: "desc",
    editingId: null,
    filters: { status:"all", dateFrom:"", dateTo:"", client:"", q:"" }
  };

  injectOnce("pm-css", `
    :root{
      --bg0:#0B0F14; --bg1:#0F1720;
      --panel:#16202B; --panelHi:#1D2A39; --panel2:#233242;
      --line:rgba(255,255,255,.10); --line2:rgba(255,255,255,.06);
      --txt:#E5E7EB; --muted:#9CA3AF; --brand:#3B82F6;
      --ok:#10B981; --warn:#F59E0B; --danger:#EF4444;
    }
    .pm-shell{max-width:none;width:100%}
    .pm-card{background:linear-gradient(180deg, var(--panelHi), var(--panel));
             border:1px solid var(--line);border-radius:16px;padding:16px 18px;box-shadow:0 8px 30px rgba(0,0,0,.25)}
    .pm-toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between}
    .pm-toolbar .cta{display:flex;gap:10px}
    .pm-btn{border-radius:12px;padding:10px 14px;border:1px solid var(--line);color:#fff;background:var(--brand)}
    .pm-btn:hover{filter:brightness(1.08)}
    .pm-btn-ghost{border-radius:12px;padding:10px 14px;border:1px solid var(--line);color:#E5E7EB;background:var(--panel2)}
    .pm-btn-ghost:hover{background:#2B3B4E}
    .pm-chip{padding:.25rem .6rem;border-radius:9999px;font-size:12px;display:inline-flex;gap:6px;align-items:center}
    .pm-chip-dot{width:6px;height:6px;border-radius:9999px;display:inline-block}
    .pm-grid{display:grid;gap:16px}
    .pm-search{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--panel2)}
    .pm-search input{background:transparent;border:0;outline:0;color:var(--txt);font-size:14px;width:100%}
    .pm-search input::placeholder{color:var(--muted)}
    .pm-input, .pm-date, .pm-select{background:var(--panel2);border:1px solid var(--line);color:var(--txt);border-radius:10px;padding:10px 12px;font-size:14px}
    .pm-date{color-scheme:dark}
    /* select oscuro custom */
    .sel{position:relative}
    .sel-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);color:var(--txt);font-size:14px}
    .sel-btn:focus{outline:2px solid #3b82f6;outline-offset:2px}
    .sel-list{position:absolute;top:100%;left:0;z-index:50;margin-top:6px;min-width:180px;background:#0F1720;border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:6px;display:none}
    .sel[open] .sel-list{display:block}
    .sel-item{padding:8px 10px;border-radius:8px;color:#E5E7EB;cursor:pointer;white-space:nowrap}
    .sel-item:hover{background:#233242}

    /* tabla pro */
    .pm-table{width:100%;border-collapse:separate;border-spacing:0}
    thead{position:sticky;top:0;z-index:5;background:linear-gradient(180deg, var(--panelHi), var(--panel))}
    .pm-th{font-weight:600;color:#A9B3C2;text-align:left;padding:14px 12px;border-bottom:1px solid var(--line)}
    .pm-th.sortable{cursor:pointer;user-select:none}
    .pm-td{padding:16px 12px;border-top:1px solid var(--line2);vertical-align:top}
    .pm-row{transition:background .15s ease, transform .05s ease}
    .pm-row:hover{background:rgba(255,255,255,.035)}
    .pm-row:active{transform:translateY(1px)}
    .muted{color:var(--muted)}
    .title{font-weight:600;color:#fff}
    .sub{font-size:12px;color:var(--muted)}
    /* acciones */
    .act{display:inline-flex;gap:8px}
    .icon-btn{width:36px;height:36px;border-radius:10px;border:1px solid var(--line);
              display:inline-flex;align-items:center;justify-content:center;background:var(--panel2);color:#E5E7EB}
    .icon-btn:hover{background:#2A3A4F}
    .icon-btn.ok:hover{box-shadow:0 0 0 2px rgba(16,185,129,.25) inset}
    .icon-btn.warn:hover{box-shadow:0 0 0 2px rgba(245,158,11,.25) inset}
    .icon-btn.danger:hover{box-shadow:0 0 0 2px rgba(239,68,68,.25) inset}
    /* modal */
    .pm-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100}
    .pm-dialog{width:min(560px,92vw);background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px}
    .pm-field{display:grid;gap:6px}
    .pm-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}
    /* empty state */
    .empty{display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);padding:50px 10px}
    .empty .hint{margin-top:6px;font-size:14px}
  `);

  el.innerHTML = `
    <section class="transition-all duration-200 px-4 md:px-8 py-6 text-[15px] text-[var(--txt)]" data-shell>
      <div class="pm-shell pm-grid" style="grid-template-rows:auto auto 1fr">
        <!-- Header -->
        <div class="pm-toolbar">
          <h1 class="text-[30px] md:text-[40px] font-extrabold tracking-tight text-white">${escapeHTML(state.title)}</h1>
          <div class="cta">
            <button class="pm-btn-ghost" data-role="export">${icoDownload()} Export CSV</button>
            <button class="pm-btn" data-role="new">${icoPlus()} New Project</button>
          </div>
        </div>

        <!-- Filtros -->
        <div class="pm-card">
          <div class="pm-grid" style="grid-template-columns:auto auto auto 1fr;gap:12px;align-items:center">
            <div class="sel" data-filter="status"></div>
            <div class="pm-grid" style="grid-template-columns:auto auto;gap:12px">
              <input class="pm-date" type="date" data-filter="dateFrom" placeholder="From"/>
              <input class="pm-date" type="date" data-filter="dateTo" placeholder="To"/>
            </div>
            <input class="pm-input" type="text" data-filter="client" placeholder="Client"/>
            <div class="pm-search">
              ${icoSearch()}
              <input type="search" placeholder="Search projects, clients, notes… (Ctrl/Cmd + F)" data-filter="q"/>
            </div>
          </div>
        </div>

        <!-- Tabla -->
        <div class="pm-card" style="overflow:auto">
          <table class="pm-table">
            <thead>
              <tr>
                <th class="pm-th sortable" data-sort="name">Project</th>
                <th class="pm-th sortable" data-sort="status">Status</th>
                <th class="pm-th sortable" data-sort="startDate">Start date</th>
                <th class="pm-th sortable" data-sort="client">Client</th>
                <th class="pm-th">Notes</th>
                <th class="pm-th" style="width:1%">Actions</th>
              </tr>
            </thead>
            <tbody data-role="tbody"></tbody>
          </table>
          <div class="empty" data-role="empty">
            ${icoFolder()}
            <div class="hint">No projects yet.</div>
            <button class="pm-btn" style="margin-top:12px" data-role="first-new">${icoPlus()} Create your first project</button>
          </div>
        </div>
      </div>
    </section>
  `;

  // --- refs
  const qs = (s) => el.querySelector(s);
  const shell = qs('[data-shell]');
  const tbody = qs('[data-role="tbody"]');
  const emptyWrap = qs('[data-role="empty"]');
  const firstNewBtn = qs('[data-role="first-new"]');
  const exportBtn = qs('[data-role="export"]');
  const newBtn = qs('[data-role="new"]');

  const filterEls = {
    statusHost: qs('[data-filter="status"]'),
    dateFrom: qs('[data-filter="dateFrom"]'),
    dateTo: qs('[data-filter="dateTo"]'),
    client: qs('[data-filter="client"]'),
    q: qs('[data-filter="q"]'),
  };

  // margen según aside
  function asideExpanded() {
    const aside = document.querySelector('aside[data-aside]');
    return aside ? (aside.dataset.state === "expanded") : true;
  }
  function applyShellMargin() { shell.style.marginLeft = asideExpanded() ? "280px" : "72px"; }
  applyShellMargin();
  const onAsideToggle = () => applyShellMargin();
  document.addEventListener("ui:sidebar:toggle", onAsideToggle);

  // select status (oscuro)
  const statusOptions = [
    { value:"all", label:"All statuses" },
    { value:"Active", label:"Active" },
    { value:"Pending", label:"Pending" },
    { value:"Blocked", label:"Blocked" },
    { value:"Paused", label:"Paused" },
    { value:"Planning", label:"Planning" },
    { value:"Closed", label:"Closed" },
  ];
  const statusDD = makeDarkSelect(filterEls.statusHost, statusOptions, "all", (val)=>{
    state.filters.status = val; renderTable();
  });

  // filtros
  ["dateFrom","dateTo","client","q"].forEach(k=>{
    filterEls[k].addEventListener("input", ()=>{
      state.filters[k] = filterEls[k].value.trim();
      renderTable();
    });
  });

  // sort
  el.querySelectorAll(".pm-th.sortable").forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.sort;
      if (state.sortBy === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortBy = key; state.sortDir = key === "name" ? "asc" : "desc"; }
      renderTable();
    });
  });

  // export
  exportBtn.addEventListener("click", ()=>{
    const rows = getFilteredSortedRows();
    const csv = toCSV([
      ["ID","Project","Status","Start Date","Client","Notes"],
      ...rows.map(r => [r.id||"", r.name||"", r.status||"", r.startDate||"", r.client||"", r.notes||""])
    ]);
    downloadFile(`projects.csv`, csv, "text/csv");
  });

  // nuevo
  ;[newBtn, firstNewBtn].forEach(btn=> btn?.addEventListener("click", openCreateModal));

  // búsqueda teclado
  const onKey = (e) => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault(); filterEls.q.focus();
    }
  };
  document.addEventListener("keydown", onKey);

  // integrar data externa
  const onDataUpdate = (ev) => {
    const detail = ev.detail || {};
    if ("projects" in detail) {
      state.projects = toArray(detail.projects);
      renderTable();
    }
  };
  document.addEventListener("ui:data:update", onDataUpdate);

  // primer render (VACÍO)
  renderTable();

  // API pública
  const api = {
    update(data = {}) {
      if ("projects" in data) state.projects = toArray(data.projects);
      renderTable();
    },
    destroy(){
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("ui:sidebar:toggle", onAsideToggle);
      document.removeEventListener("ui:data:update", onDataUpdate);
      statusDD.destroy();
    }
  };
  return api;

  /* ===================== render ===================== */

  function renderTable() {
    const rows = getFilteredSortedRows();
    emptyWrap.style.display = rows.length ? "none" : "flex";

    if (!rows.length) { tbody.innerHTML = ""; return; }

    tbody.innerHTML = rows.map(r => {
      const editing = state.editingId === r.id;
      return editing ? rowEditHTML(r) : rowViewHTML(r);
    }).join("");

    // wire
    tbody.querySelectorAll(".pm-row").forEach(tr=>{
      const id = tr.dataset.id;
      tr.addEventListener("keydown",(e)=>{ if(e.key==="Enter" && !state.editingId) openProject(id); });

      tr.querySelectorAll("[data-open]")?.forEach(b=> b.addEventListener("click", ()=> openProject(id)));
      tr.querySelectorAll("[data-edit]")?.forEach(b=> b.addEventListener("click", ()=> startEdit(id)));
      tr.querySelectorAll("[data-del]") ?.forEach(b=> b.addEventListener("click", ()=> delProject(id)));

      tr.querySelectorAll("[data-save]")?.forEach(b=> b.addEventListener("click", ()=> saveEdit(id, tr)));
      tr.querySelectorAll("[data-cancel]")?.forEach(b=> b.addEventListener("click", ()=> cancelEdit()));
    });
  }

  function rowViewHTML(r){
    return `
      <tr class="pm-row" data-id="${escapeAttr(r.id||"")}" tabindex="0">
        <td class="pm-td">
          <div class="title">${escapeHTML(r.name||"") || '<span class="muted">—</span>'}</div>
          <div class="sub">${escapeHTML(r.id||"")}</div>
        </td>
        <td class="pm-td">${statusChip(r.status)}</td>
        <td class="pm-td">${fmtDate(r.startDate)}</td>
        <td class="pm-td uppercase tracking-wide" style="color:#D1D5DB">${escapeHTML(r.client || "—")}</td>
        <td class="pm-td"><span class="muted">${escapeHTML(r.notes || "—")}</span></td>
        <td class="pm-td">
          <div class="act">
            <button class="icon-btn ok"     title="Open"   data-open>${icoOpen()}</button>
            <button class="icon-btn warn"   title="Edit"   data-edit>${icoEdit()}</button>
            <button class="icon-btn danger" title="Delete" data-del >${icoTrash()}</button>
          </div>
        </td>
      </tr>
    `;
  }

  function rowEditHTML(r){
    return `
      <tr class="pm-row" data-id="${escapeAttr(r.id||"")}">
        <td class="pm-td">
          <input class="pm-input" name="name" value="${escapeAttr(r.name||"")}" placeholder="Project name"/>
          <div class="sub" style="margin-top:4px">${escapeHTML(r.id||"")}</div>
        </td>
        <td class="pm-td">
          <select class="pm-select" name="status">
            ${["Active","Pending","Blocked","Paused","Planning","Closed"].map(s=>`<option ${r.status===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </td>
        <td class="pm-td"><input class="pm-date" type="date" name="startDate" value="${escapeAttr(r.startDate||"")}"/></td>
        <td class="pm-td"><input class="pm-input" name="client" value="${escapeAttr(r.client||"")}"/></td>
        <td class="pm-td"><textarea class="pm-input" name="notes" rows="2" placeholder="Notes...">${escapeHTML(r.notes||"")}</textarea></td>
        <td class="pm-td">
          <div class="act">
            <button class="icon-btn ok"   title="Save"   data-save>${icoSave()}</button>
            <button class="icon-btn"      title="Cancel" data-cancel>${icoClose()}</button>
          </div>
        </td>
      </tr>
    `;
  }

  function getFilteredSortedRows() {
    const list = toArray(state.projects).slice();
    const {status,dateFrom,dateTo,client,q} = state.filters;

    let data = list.filter(r => !!r);
    if (status !== "all") data = data.filter(r => (r.status||"") === status);
    if (dateFrom) data = data.filter(r => (r.startDate||"") >= dateFrom);
    if (dateTo)   data = data.filter(r => (r.startDate||"") <= dateTo);
    if (client) {
      const t = client.trim().toLowerCase();
      if (t) data = data.filter(r => String(r.client||"").toLowerCase().includes(t));
    }
    if (q) {
      const t = q.trim().toLowerCase();
      if (t) data = data.filter(r =>
        String(r.name||"").toLowerCase().includes(t) ||
        String(r.client||"").toLowerCase().includes(t) ||
        String(r.notes||"").toLowerCase().includes(t)
      );
    }

    const by = state.sortBy; const dir = state.sortDir === "asc" ? 1 : -1;
    data.sort((a,b)=>{
      const av = (a?.[by] ?? "").toString().toLowerCase();
      const bv = (b?.[by] ?? "").toString().toLowerCase();
      if (av < bv) return -1*dir; if (av > bv) return  1*dir; return 0;
    });
    return data;
  }

  /* ===================== acciones ===================== */

  function startEdit(id){ state.editingId = id; renderTable(); }
  function cancelEdit(){ state.editingId = null; renderTable(); }

  function saveEdit(id, tr){
    const p = findById(id); if (!p) return;
    const get = (n)=> tr.querySelector(`[name="${n}"]`)?.value || "";
    p.name = get("name").trim();
    p.status = get("status") || p.status;
    p.startDate = get("startDate") || "";
    p.client = get("client").trim();
    p.notes = tr.querySelector('[name="notes"]')?.value.trim() || "";
    el.dispatchEvent(new CustomEvent("pm:project:update", { bubbles:true, detail:{ project:{...p} }}));
    state.editingId = null; renderTable();
  }

  function delProject(id){
    const p = findById(id); if (!p) return;
    if (!confirm(`Delete project "${p.name || id}"?`)) return;
    state.projects = toArray(state.projects).filter(x => String(x.id)!==String(id));
    el.dispatchEvent(new CustomEvent("pm:project:delete", { bubbles:true, detail:{ id }}));
    renderTable();
  }

  function openProject(id){
    if (!id) return;
    const href = `#project/${encodeURIComponent(id)}`;
    const ev = new CustomEvent("ui:navigate", { bubbles:true, cancelable:true, detail:{ href }});
    const cancelled = !el.dispatchEvent(ev) ? true : ev.defaultPrevented;
    if (!cancelled) location.hash = href;
  }

  function openCreateModal() {
    const wrap = document.createElement("div");
    wrap.className = "pm-modal";
    wrap.innerHTML = `
      <div class="pm-dialog">
        <h3 class="text-lg font-semibold text-white">${icoPlus()} New Project</h3>
        <div class="pm-grid" style="margin-top:10px;grid-template-columns:1fr 1fr;gap:12px">
          <label class="pm-field"><span class="muted">Name</span>
            <input class="pm-input" data-f="name" placeholder="Project name"/></label>
          <label class="pm-field"><span class="muted">Client</span>
            <input class="pm-input" data-f="client" placeholder="Client"/></label>
          <label class="pm-field"><span class="muted">Start date</span>
            <input class="pm-input" data-f="startDate" type="date"/></label>
          <label class="pm-field"><span class="muted">Status</span>
            <select class="pm-input" data-f="status">
              <option>Active</option><option>Pending</option><option>Blocked</option>
              <option>Paused</option><option>Planning</option><option>Closed</option>
            </select></label>
          <label class="pm-field" style="grid-column:1/-1"><span class="muted">Notes</span>
            <textarea class="pm-input" data-f="notes" rows="3" placeholder="Notes"></textarea></label>
        </div>
        <div class="pm-actions">
          <button class="pm-btn-ghost" data-act="cancel">${icoClose()} Cancel</button>
          <button class="pm-btn" data-act="create">${icoSave()} Create</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    const $f = (k)=> wrap.querySelector(`[data-f="${k}"]`);
    const close = ()=> wrap.remove();
    wrap.addEventListener("click", (e)=>{ if (e.target === wrap) close(); });
    wrap.querySelector('[data-act="cancel"]').addEventListener("click", close);
    wrap.querySelector('[data-act="create"]').addEventListener("click", ()=>{
      const project = {
        id: genId(),
        name: ($f("name").value||"").trim(),
        client: ($f("client").value||"").trim(),
        startDate: $f("startDate").value || "",
        status: $f("status").value || "Active",
        notes: ($f("notes").value||"").trim()
      };
      const ev = new CustomEvent("pm:project:create", { bubbles:true, cancelable:true, detail:{ project } });
      const cancelled = !el.dispatchEvent(ev) ? true : ev.defaultPrevented;
      if (!cancelled) {
        state.projects.push(project);
        renderTable();
        close();
      }
    });
  }

  /* ===================== helpers ===================== */

  function statusChip(s) {
    const map = {
      Active:   { bg: "rgba(16,185,129,.18)", fg: "#6EE7B7" },
      Pending:  { bg: "rgba(148,163,184,.18)", fg: "#CBD5E1" },
      Blocked:  { bg: "rgba(244,63,94,.18)",   fg: "#FCA5A5" },
      Paused:   { bg: "rgba(245,158,11,.18)",  fg: "#FCD34D" },
      Planning: { bg: "rgba(14,165,233,.18)",  fg: "#7DD3FC" },
      Closed:   { bg: "rgba(100,116,139,.18)", fg: "#94A3B8" },
    };
    const c = map[s] || map.Pending;
    return `<span class="pm-chip" style="background:${c.bg};color:${c.fg}"><i class="pm-chip-dot" style="background:${c.fg}"></i>${escapeHTML(s||"—")}</span>`;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const [y,m,d] = String(iso).split("-").map(Number);
    if (!y || !m || !d) return escapeHTML(iso);
    return `${String(d).padStart(2,"0")}/${String(m).padStart(2,"0")}/${y}`;
  }

  function findById(id) { return (state.projects||[]).find(p => String(p.id) === String(id)); }
  function genId() { const n = Math.floor(1000 + Math.random()*9000); return `PR-${n}`; }

  function makeDarkSelect(host, options, value, onChange) {
    host.classList.add("sel");
    host.innerHTML = `
      <button type="button" class="sel-btn" data-role="btn">
        <span data-role="label"></span> ${icoChevron()}
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
    function closeOnOutside(e){ if (!host.contains(e.target)) toggle(false); }

    list.innerHTML = options.map(o => `<div class="sel-item" data-val="${escapeAttr(o.value)}">${escapeHTML(o.label)}</div>`).join("");
    btn.addEventListener("click", () => toggle());
    list.querySelectorAll(".sel-item").forEach(it=>{
      it.addEventListener("click", ()=>{ toggle(false); setValue(it.dataset.val); });
    });
    document.addEventListener("click", closeOnOutside);
    setValue(value);
    return { setValue, destroy(){ document.removeEventListener("click", closeOnOutside); } };
  }

  function toCSV(rows){ return rows.map(r => r.map(c => `"${String(c).replaceAll('"','""')}"`).join(",")).join("\n"); }
  function downloadFile(name, content, type="text/csv"){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),400); }
  function escapeHTML(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }
  function escapeAttr(s){ return escapeHTML(String(s)).replaceAll('"',"&quot;"); }
}

// Fondo dark global coherente
function ensureGlobalBackground(){ injectOnce("pm-global-bg", `body{background:radial-gradient(1200px 600px at 20% 0%, #0F1720 0%, #0B0F14 60%, #0B0F14 100%); color:#E5E7EB}`); }
// Inyección CSS única
function injectOnce(id, css){ if(document.getElementById(id)) return; const st=document.createElement("style"); st.id=id; st.textContent=css; document.head.appendChild(st); }

// --- Iconos SVG (inline, livianos) ---
function icoOpen(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"/><path d="M5 5h6v2H7v10h10v-4h2v6H5z"/></svg>`}
function icoEdit(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`}
function icoTrash(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 7h12v2H6z"/><path d="M8 9h8v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V9z"/><path d="M9 4h6v2H9z"/></svg>`}
function icoSave(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5a2 2 0 0 0-2 2v14l4-4h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg>`}
function icoClose(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 6L6 18M6 6l12 12"/></svg>`}
function icoDownload(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2zM12 2v12l4-4 1.41 1.41L12 17.83l-5.41-5.42L8 10l4 4V2z"/></svg>`}
function icoPlus(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2z"/></svg>`}
function icoSearch(){return `<svg width="18" height="18" viewBox="0 0 24 24" fill="#9CA3AF"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79L19 21l1.5-1.5-5-5zM4 9.5C4 6.46 6.46 4 9.5 4S15 6.46 15 9.5 12.54 15 9.5 15 4 12.54 4 9.5z"/></svg>`}
function icoChevron(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="#9CA3AF"><path d="M7 10l5 5 5-5z"/></svg>`}
function icoFolder(){return `<svg width="28" height="28" viewBox="0 0 24 24" fill="#94A3B8"><path d="M10 4l2 2h8a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h5z"/></svg>`}
