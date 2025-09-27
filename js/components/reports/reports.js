// reports.js — CRUD completo de Reports en modo oscuro, listo para producción sin backend
export default function mountReports(el, props = {}) {
  // ---------------------------
  // Config
  // ---------------------------
  const cfg = {
    storageKey: props.storageKey ?? "app.reports.v1",
    projects: props.projects ?? ["PR-01", "PR-02", "PR-03"],
    // si mañana conectás backend, reemplazá loadAll/saveOne/deleteOne
  };

  // ---------------------------
  // Estado
  // ---------------------------
  const state = {
    reports: [],        // [{id, name, project, sections, data, createdAt, updatedAt}]
    selectedId: null,   // id del reporte seleccionado
    filter: "",         // texto de búsqueda
    format: "pdf",      // pdf|csv|json
    loading: false,
    error: null,
    editMode: false,    // true cuando se está editando (o creando)
  };

  let previewTimer = null;

  // ---------------------------
  // Persistence (LocalStorage)
  // ---------------------------
  const persist = {
    loadAll() {
      try {
        const raw = localStorage.getItem(cfg.storageKey);
        return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
      } catch { return []; }
    },
    saveAll(list) {
      localStorage.setItem(cfg.storageKey, JSON.stringify(list));
    },
    saveOne(report) {
      const all = persist.loadAll();
      const i = all.findIndex(r => r.id === report.id);
      if (i >= 0) all[i] = report; else all.push(report);
      persist.saveAll(all);
    },
    deleteOne(id) {
      const all = persist.loadAll().filter(r => r.id !== id);
      persist.saveAll(all);
    }
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  const $$ = (sel, root = el) => Array.from(root.querySelectorAll(sel));
  const $  = (sel, root = el) => root.querySelector(sel);

  const uid = () => Math.random().toString(36).slice(2, 10);
  const nowISO = () => new Date().toISOString();
  const human = (d) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const escapeHTML = (s) => String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  const schedulePreview = () => {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 40);
  };

  const setState = (patch) => {
    Object.assign(state, patch);
    render();
  };

  // Default sections + data template
  const defaultSections = () => ([
    { key: "details",   label: "Project details", enabled: true },
    { key: "materials", label: "Materials",       enabled: true },
    { key: "labor",     label: "Labor",           enabled: true },
    { key: "budget",    label: "Budget",          enabled: true },
    { key: "suppliers", label: "Suppliers",       enabled: true },
    { key: "notes",     label: "Notes",           enabled: true },
  ]);

  const defaultData = (projectId) => ({
    details: {
      name: projectId,
      title: `Project ${projectId}`,
      manager: "",
      start: "",
      end: "",
      status: "Draft",
    },
    materials: [],
    labor: [],
    budget: { capex: 0, opex: 0, spent: 0 },
    suppliers: [],
    notes: [],
  });

  const selected = () => state.reports.find(r => r.id === state.selectedId) || null;
  const enabledSections = (rep) => (rep?.sections || []).filter(s => s.enabled);

  // ---------------------------
  // UI (Dark mode)
  // ---------------------------
  el.innerHTML = `
    <div class="px-6 md:px-10 py-8 md:ml-72 min-h-[90vh] bg-slate-950">
      <div class="flex items-center gap-3">
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#0f172a"></rect>
          <path d="M7 17l5-5 5 5" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M7 7h10" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"></path>
        </svg>
        <h1 class="text-5xl md:text-6xl font-black tracking-tight text-slate-50">Reports</h1>
      </div>
      <p class="mt-2 text-lg text-slate-400">Generate • Manage • Export</p>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <!-- Sidebar: Listado -->
        <aside class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div class="flex gap-2">
            <input type="text" data-role="search"
              class="flex-1 rounded-lg bg-slate-800 text-slate-100 px-3 py-2 placeholder-slate-500 border border-slate-700"
              placeholder="Search reports (name or project)…"/>
            <button data-role="new"
              class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3 py-2">New</button>
          </div>
          <ul data-role="list" class="mt-4 divide-y divide-slate-800">
            <!-- items -->
          </ul>
        </aside>

        <!-- Main: Editor / Preview -->
        <section class="lg:col-span-2 space-y-6">
          <!-- Header actions -->
          <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <h3 class="text-lg font-semibold text-slate-100">Report</h3>
              <span data-role="status" class="text-xs text-slate-400"></span>
            </div>
            <div class="flex items-center gap-2">
              <select data-role="fmt"
                class="rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2">
                <option value="pdf">PDF</option>
                <option value="csv">CSV (Excel)</option>
                <option value="json">JSON</option>
              </select>
              <button data-role="export"
                class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
                Export
              </button>
              <button data-role="edit"
                class="rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 px-3 py-2">
                Edit
              </button>
              <button data-role="delete"
                class="rounded-lg border border-red-900 text-red-300 hover:bg-red-950 px-3 py-2">
                Delete
              </button>
            </div>
          </div>

          <!-- Editor -->
          <div data-role="editor" class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 hidden">
            <form data-role="form" class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label class="text-sm text-slate-300">
                  <span class="block mb-1">Name</span>
                  <input name="name" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2" required/>
                </label>
                <label class="text-sm text-slate-300">
                  <span class="block mb-1">Project</span>
                  <select name="project" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"></select>
                </label>
                <label class="text-sm text-slate-300">
                  <span class="block mb-1">Status</span>
                  <input name="status" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2" placeholder="On track, At risk…"/>
                </label>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label class="text-sm text-slate-300">
                  <span class="block mb-1">Start date</span>
                  <input type="date" name="start" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
                </label>
                <label class="text-sm text-slate-300">
                  <span class="block mb-1">End date</span>
                  <input type="date" name="end" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
                </label>
              </div>

              <!-- Materials -->
              <fieldset class="border border-slate-800 rounded-xl p-3">
                <legend class="px-2 text-slate-200">Materials</legend>
                <div data-role="materials" class="space-y-2"></div>
                <button data-role="add-material" type="button" class="mt-2 rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">+ Add material</button>
              </fieldset>

              <!-- Labor -->
              <fieldset class="border border-slate-800 rounded-xl p-3">
                <legend class="px-2 text-slate-200">Labor</legend>
                <div data-role="labor" class="space-y-2"></div>
                <button data-role="add-labor" type="button" class="mt-2 rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">+ Add role</button>
              </fieldset>

              <!-- Budget -->
              <fieldset class="border border-slate-800 rounded-xl p-3">
                <legend class="px-2 text-slate-200">Budget</legend>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label class="text-sm text-slate-300"><span class="block mb-1">CAPEX</span><input name="capex" type="number" step="0.01" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/></label>
                  <label class="text-sm text-slate-300"><span class="block mb-1">OPEX</span><input name="opex" type="number" step="0.01" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/></label>
                  <label class="text-sm text-slate-300"><span class="block mb-1">Spent</span><input name="spent" type="number" step="0.01" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/></label>
                </div>
              </fieldset>

              <!-- Suppliers -->
              <fieldset class="border border-slate-800 rounded-xl p-3">
                <legend class="px-2 text-slate-200">Suppliers</legend>
                <div data-role="suppliers" class="space-y-2"></div>
                <button data-role="add-supplier" type="button" class="mt-2 rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">+ Add supplier</button>
              </fieldset>

              <!-- Notes -->
              <fieldset class="border border-slate-800 rounded-xl p-3">
                <legend class="px-2 text-slate-200">Notes</legend>
                <div data-role="notes" class="space-y-2"></div>
                <button data-role="add-note" type="button" class="mt-2 rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">+ Add note</button>
              </fieldset>

              <!-- Sections Toggle/Order -->
              <fieldset class="border border-slate-800 rounded-xl p-3">
                <legend class="px-2 text-slate-200">Sections</legend>
                <ul data-role="sections" class="grid sm:grid-cols-2 gap-2"></ul>
                <div class="text-xs text-slate-400 mt-1">Tip: clic en el nombre para activar/desactivar; ↑/↓ para reordenar.</div>
              </fieldset>

              <div class="flex items-center justify-end gap-2">
                <button type="button" data-role="cancel" class="rounded-lg border border-slate-700 text-slate-200 px-3 py-2 hover:bg-slate-800">Cancel</button>
                <button type="submit" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2">Save</button>
              </div>
            </form>
          </div>

          <!-- Preview -->
          <div data-role="preview" class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 min-h-[18rem]">
            <h3 class="text-lg font-semibold text-slate-100">Preview</h3>
            <div class="mt-3 text-slate-400">Select or create a report to begin.</div>
          </div>
        </section>
      </div>
    </div>
  `;

  // ---------------------------
  // Refs
  // ---------------------------
  const listBox    = $('[data-role="list"]');
  const searchBox  = $('[data-role="search"]');
  const newBtn     = $('[data-role="new"]');
  const fmtSel     = $('[data-role="fmt"]');
  const exportBtn  = $('[data-role="export"]');
  const deleteBtn  = $('[data-role="delete"]');
  const editBtn    = $('[data-role="edit"]');
  const statusBox  = $('[data-role="status"]');
  const editor     = $('[data-role="editor"]');
  const previewBox = $('[data-role="preview"]');

  const form       = $('[data-role="form"]');
  const projectSelect = form.querySelector('select[name="project"]');
  const materialsBox  = form.querySelector('[data-role="materials"]');
  const laborBox      = form.querySelector('[data-role="labor"]');
  const suppliersBox  = form.querySelector('[data-role="suppliers"]');
  const notesBox      = form.querySelector('[data-role="notes"]');
  const sectionsUl    = form.querySelector('[data-role="sections"]');

  // Fill projects in editor
  cfg.projects.forEach(p => {
    const opt = document.createElement("option");
    opt.value = opt.textContent = p;
    projectSelect.appendChild(opt);
  });

  // ---------------------------
  // Render functions
  // ---------------------------
  function render() {
    renderList();
    renderHeaderButtons();
    renderEditor();
    schedulePreview();
  }

  function renderList() {
    const q = state.filter.trim().toLowerCase();
    const items = state.reports
      .filter(r => !q || r.name.toLowerCase().includes(q) || r.project.toLowerCase().includes(q))
      .sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    listBox.innerHTML = items.map(r => `
      <li class="py-2">
        <button data-id="${r.id}" class="w-full text-left rounded-lg px-3 py-2
          ${state.selectedId === r.id ? 'bg-slate-800 text-slate-50' : 'hover:bg-slate-800/60 text-slate-200'}">
          <div class="flex items-center justify-between">
            <span class="font-medium">${escapeHTML(r.name)}</span>
            <span class="text-xs text-slate-400">${escapeHTML(r.project)}</span>
          </div>
          <div class="text-xs text-slate-500">Updated: ${escapeHTML(human(r.updatedAt))}</div>
        </button>
      </li>
    `).join("") || `<li class="text-slate-500 text-sm py-2">No reports found.</li>`;
  }

  function renderHeaderButtons() {
    const hasSel = !!selected();
    exportBtn.disabled = !hasSel || enabledSections(selected()).length === 0;
    deleteBtn.disabled = !hasSel;
    editBtn.disabled   = !hasSel;
    fmtSel.value = state.format;
    statusBox.textContent = hasSel ? (state.editMode ? "Editing…" : "Ready") : "No report selected";
  }

  function renderEditor() {
    const rep = selected();
    editor.classList.toggle("hidden", !state.editMode);

    if (!rep || !state.editMode) return;

    // Fill top-level fields
    form.name.value = rep.name || "";
    form.project.value = rep.project || cfg.projects[0];
    form.status.value = rep.data.details.status || "";
    form.start.value  = rep.data.details.start || "";
    form.end.value    = rep.data.details.end   || "";

    // Materials
    materialsBox.innerHTML = "";
    rep.data.materials.forEach(addMaterialRow);
    // Labor
    laborBox.innerHTML = "";
    rep.data.labor.forEach(addLaborRow);
    // Budget
    form.capex.value = rep.data.budget.capex ?? 0;
    form.opex.value  = rep.data.budget.opex  ?? 0;
    form.spent.value = rep.data.budget.spent ?? 0;
    // Suppliers
    suppliersBox.innerHTML = "";
    rep.data.suppliers.forEach(addSupplierRow);
    // Notes
    notesBox.innerHTML = "";
    rep.data.notes.forEach(addNoteRow);
    // Sections
    renderSectionsEditor(rep.sections);
  }

  function renderSectionsEditor(sections) {
    sectionsUl.innerHTML = sections.map((s,i)=>`
      <li class="flex items-center justify-between gap-2 rounded-lg border border-slate-800 px-2 py-1" data-index="${i}">
        <button type="button" data-action="toggle" class="flex-1 text-left ${s.enabled?'text-slate-200':'text-slate-500 line-through'}">${escapeHTML(s.label)}</button>
        <div class="flex items-center gap-1">
          <button type="button" data-action="up"   class="rounded-md border border-slate-700 px-2 py-1 text-slate-200">↑</button>
          <button type="button" data-action="down" class="rounded-md border border-slate-700 px-2 py-1 text-slate-200">↓</button>
        </div>
      </li>
    `).join("");
  }

  function renderPreview() {
    const rep = selected();
    if (!rep) {
      previewBox.innerHTML = `<h3 class="text-lg font-semibold text-slate-100">Preview</h3>
      <div class="mt-3 text-slate-400">Select or create a report to begin.</div>`;
      return;
    }
    const sections = enabledSections(rep);
    const body = sections.map(s => sectionRenderers[s.key](rep.data)).join("");
    const meta = `
      <div class="text-sm text-slate-300">
        <div><b>Project:</b> ${escapeHTML(rep.project)}</div>
        <div><b>Format:</b> ${escapeHTML(state.format.toUpperCase())}</div>
        <div><b>Sections:</b> ${escapeHTML(sections.map(x=>x.label).join(", ") || "None")}</div>
        <div><b>Updated:</b> ${escapeHTML(human(rep.updatedAt))}</div>
      </div>`;

    previewBox.innerHTML = `
      <h3 class="text-lg font-semibold text-slate-100">Preview</h3>
      <div class="mt-3 space-y-3">${meta}<hr class="border-slate-800"/>${body || `<div class="text-slate-500">No sections enabled.</div>`}</div>
    `;

    exportBtn.disabled = sections.length === 0;
  }

  // ---------------------------
  // Section renderers (dark)
  // ---------------------------
  const sectionRenderers = {
    details(d) {
      const x = d.details;
      return `
        <section>
          <h4 class="font-semibold text-slate-200">Project details</h4>
          <div class="mt-2 grid sm:grid-cols-2 gap-2 text-sm text-slate-300">
            <div><b>ID:</b> ${escapeHTML(x.name || "")}</div>
            <div><b>Title:</b> ${escapeHTML(x.title || "")}</div>
            <div><b>Manager:</b> ${escapeHTML(x.manager || "")}</div>
            <div><b>Status:</b> ${escapeHTML(x.status || "")}</div>
            <div><b>Start:</b> ${escapeHTML(x.start || "")}</div>
            <div><b>End:</b> ${escapeHTML(x.end || "")}</div>
          </div>
        </section>`;
    },
    materials(d) {
      const rows = (d.materials||[]).map(m=>`
        <tr>
          <td class="px-2 py-1">${escapeHTML(m.item)}</td>
          <td class="px-2 py-1 text-right">${m.qty}</td>
          <td class="px-2 py-1">${escapeHTML(m.unit)}</td>
          <td class="px-2 py-1 text-right">$${Number(m.cost||0).toFixed(2)}</td>
        </tr>`).join("");
      return `
        <section class="mt-3">
          <h4 class="font-semibold text-slate-200">Materials</h4>
          <table class="mt-2 w-full text-sm border border-slate-800 text-slate-200">
            <thead class="bg-slate-800/60">
              <tr>
                <th class="px-2 py-1 text-left">Item</th>
                <th class="px-2 py-1 text-right">Qty</th>
                <th class="px-2 py-1 text-left">Unit</th>
                <th class="px-2 py-1 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td class="px-2 py-1 text-slate-500" colspan="4">No materials</td></tr>`}</tbody>
          </table>
        </section>`;
    },
    labor(d) {
      const rows = (d.labor||[]).map(l=>`
        <tr>
          <td class="px-2 py-1">${escapeHTML(l.role)}</td>
          <td class="px-2 py-1 text-right">${l.hours}</td>
          <td class="px-2 py-1 text-right">$${Number(l.rate||0).toFixed(2)}</td>
          <td class="px-2 py-1 text-right">$${Number((l.hours||0)*(l.rate||0)).toFixed(2)}</td>
        </tr>`).join("");
      return `
        <section class="mt-3">
          <h4 class="font-semibold text-slate-200">Labor</h4>
          <table class="mt-2 w-full text-sm border border-slate-800 text-slate-200">
            <thead class="bg-slate-800/60">
              <tr>
                <th class="px-2 py-1 text-left">Role</th>
                <th class="px-2 py-1 text-right">Hours</th>
                <th class="px-2 py-1 text-right">Rate</th>
                <th class="px-2 py-1 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td class="px-2 py-1 text-slate-500" colspan="4">No labor</td></tr>`}</tbody>
          </table>
        </section>`;
    },
    budget(d) {
      const b = d.budget||{capex:0,opex:0,spent:0};
      const remaining = (Number(b.capex)||0) + (Number(b.opex)||0) - (Number(b.spent)||0);
      return `
        <section class="mt-3">
          <h4 class="font-semibold text-slate-200">Budget</h4>
          <div class="mt-2 grid sm:grid-cols-3 gap-2 text-sm text-slate-300">
            <div><b>CAPEX:</b> $${Number(b.capex||0).toLocaleString()}</div>
            <div><b>OPEX:</b> $${Number(b.opex||0).toLocaleString()}</div>
            <div><b>Spent:</b> $${Number(b.spent||0).toLocaleString()}</div>
            <div class="sm:col-span-3"><b>Remaining:</b> $${Number(remaining).toLocaleString()}</div>
          </div>
        </section>`;
    },
    suppliers(d) {
      const items = (d.suppliers||[]).map(s=>`
        <li class="flex justify-between gap-2">
          <span>${escapeHTML(s.name)}</span>
          <a class="text-blue-400 hover:underline" href="mailto:${escapeHTML(s.contact)}">${escapeHTML(s.contact)}</a>
        </li>`).join("");
      return `
        <section class="mt-3">
          <h4 class="font-semibold text-slate-200">Suppliers</h4>
          <ul class="mt-2 space-y-1 text-sm text-slate-300">${items || `<li class="text-slate-500">No suppliers</li>`}</ul>
        </section>`;
    },
    notes(d) {
      const items = (d.notes||[]).map(n=>`<li>• ${escapeHTML(n)}</li>`).join("");
      return `
        <section class="mt-3">
          <h4 class="font-semibold text-slate-200">Notes</h4>
          <ul class="mt-2 space-y-1 text-sm text-slate-300">${items || `<li class="text-slate-500">No notes</li>`}</ul>
        </section>`;
    }
  };

  // ---------------------------
  // Editor rows builders
  // ---------------------------
  function addMaterialRow(m) {
    const row = document.createElement("div");
    row.className = "grid grid-cols-12 gap-2";
    row.innerHTML = `
      <input class="col-span-6 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="Item" value="${escapeHTML(m.item||"")}"/>
      <input type="number" step="0.01" class="col-span-2 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="Qty" value="${m.qty??""}"/>
      <input class="col-span-2 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="Unit" value="${escapeHTML(m.unit||"")}"/>
      <input type="number" step="0.01" class="col-span-1 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="$" value="${m.cost??""}"/>
      <button type="button" class="col-span-1 rounded border border-red-900 text-red-300 hover:bg-red-950">×</button>
    `;
    row.lastElementChild.addEventListener("click", ()=> row.remove());
    materialsBox.appendChild(row);
  }

  function addLaborRow(l) {
    const row = document.createElement("div");
    row.className = "grid grid-cols-12 gap-2";
    row.innerHTML = `
      <input class="col-span-6 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="Role" value="${escapeHTML(l.role||"")}"/>
      <input type="number" step="0.01" class="col-span-2 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="Hours" value="${l.hours??""}"/>
      <input type="number" step="0.01" class="col-span-2 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="Rate" value="${l.rate??""}"/>
      <div class="col-span-1 text-slate-400 text-sm self-center text-right">= $</div>
      <button type="button" class="col-span-1 rounded border border-red-900 text-red-300 hover:bg-red-950">×</button>
    `;
    row.lastElementChild.addEventListener("click", ()=> row.remove());
    laborBox.appendChild(row);
  }

  function addSupplierRow(s) {
    const row = document.createElement("div");
    row.className = "grid grid-cols-12 gap-2";
    row.innerHTML = `
      <input class="col-span-6 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="Name" value="${escapeHTML(s.name||"")}"/>
      <input class="col-span-5 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="contact@email" value="${escapeHTML(s.contact||"")}"/>
      <button type="button" class="col-span-1 rounded border border-red-900 text-red-300 hover:bg-red-950">×</button>
    `;
    row.lastElementChild.addEventListener("click", ()=> row.remove());
    suppliersBox.appendChild(row);
  }

  function addNoteRow(n) {
    const wrap = document.createElement("div");
    wrap.className = "flex gap-2";
    wrap.innerHTML = `
      <input class="flex-1 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1" placeholder="Note" value="${escapeHTML(n||"")}"/>
      <button type="button" class="rounded border border-red-900 text-red-300 hover:bg-red-950 px-2">×</button>
    `;
    wrap.lastElementChild.addEventListener("click", ()=> wrap.remove());
    notesBox.appendChild(wrap);
  }

  // ---------------------------
  // Events
  // ---------------------------
  listBox.addEventListener("click", (e) => {
    const id = e.target.closest("button[data-id]")?.dataset.id;
    if (!id) return;
    setState({ selectedId: id, editMode: false });
  });

  searchBox.addEventListener("input", () => setState({ filter: searchBox.value }));

  newBtn.addEventListener("click", () => {
    // Crear en memoria y abrir editor
    const rep = {
      id: `R-${uid()}`,
      name: "Untitled report",
      project: cfg.projects[0],
      sections: defaultSections(),
      data: defaultData(cfg.projects[0]),
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    state.reports.push(rep);
    persist.saveOne(rep);
    setState({ selectedId: rep.id, editMode: true });
  });

  editBtn.addEventListener("click", () => {
    if (!selected()) return;
    setState({ editMode: true });
  });

  deleteBtn.addEventListener("click", () => {
    const rep = selected(); if (!rep) return;
    if (!confirm(`Delete report "${rep.name}"? This cannot be undone.`)) return;
    persist.deleteOne(rep.id);
    state.reports = state.reports.filter(r => r.id !== rep.id);
    const next = state.reports[0]?.id ?? null;
    setState({ selectedId: next, editMode: false });
  });

  fmtSel.addEventListener("change", () => setState({ format: fmtSel.value }));
  exportBtn.addEventListener("click", () => doExport());

  // Editor buttons
  form.querySelector('[data-role="add-material"]').addEventListener("click", ()=> addMaterialRow({}));
  form.querySelector('[data-role="add-labor"]').addEventListener("click", ()=> addLaborRow({}));
  form.querySelector('[data-role="add-supplier"]').addEventListener("click", ()=> addSupplierRow({}));
  form.querySelector('[data-role="add-note"]').addEventListener("click", ()=> addNoteRow(""));

  form.querySelector('[data-role="cancel"]').addEventListener("click", () => {
    setState({ editMode: false });
  });

  // Sections interactions
  sectionsUl.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-index]"); if (!li) return;
    const i = Number(li.dataset.index);
    const rep = selected(); if (!rep) return;
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "toggle") {
      rep.sections[i].enabled = !rep.sections[i].enabled;
    } else if (action === "up") {
      if (i>0) [rep.sections[i-1], rep.sections[i]] = [rep.sections[i], rep.sections[i-1]];
    } else if (action === "down") {
      if (i<rep.sections.length-1) [rep.sections[i+1], rep.sections[i]] = [rep.sections[i], rep.sections[i+1]];
    }
    persist.saveOne(rep);
    renderSectionsEditor(rep.sections);
    schedulePreview();
  });

  // Submit form (Save)
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const rep = selected(); if (!rep) return;

    // Basic fields
    rep.name = form.name.value.trim() || "Untitled report";
    rep.project = form.project.value;
    rep.data.details = {
      ...rep.data.details,
      name: rep.project,
      title: rep.data.details.title || `Project ${rep.project}`,
      manager: rep.data.details.manager || "",
      status: form.status.value.trim(),
      start: form.start.value,
      end: form.end.value,
    };

    // Materials
    rep.data.materials = Array.from(materialsBox.children).map(row => {
      const [item, qty, unit, cost] = row.querySelectorAll("input");
      return {
        item: item.value.trim(),
        qty: Number(qty.value||0),
        unit: unit.value.trim(),
        cost: Number(cost.value||0),
      };
    }).filter(m => m.item);

    // Labor
    rep.data.labor = Array.from(laborBox.children).map(row => {
      const [role, hours, rate] = row.querySelectorAll("input");
      return {
        role: role.value.trim(),
        hours: Number(hours.value||0),
        rate: Number(rate.value||0),
      };
    }).filter(l => l.role);

    // Budget
    rep.data.budget = {
      capex: Number(form.capex.value||0),
      opex:  Number(form.opex.value||0),
      spent: Number(form.spent.value||0),
    };

    // Suppliers
    rep.data.suppliers = Array.from(suppliersBox.children).map(row => {
      const [name, contact] = row.querySelectorAll("input");
      return { name: name.value.trim(), contact: contact.value.trim() };
    }).filter(s => s.name);

    // Notes
    rep.data.notes = Array.from(notesBox.children).map(w => w.querySelector("input").value.trim()).filter(Boolean);

    rep.updatedAt = nowISO();
    persist.saveOne(rep);
    setState({ editMode: false }); // re-render + preview
  });

  // ---------------------------
  // Export
  // ---------------------------
  function doExport() {
    const rep = selected(); if (!rep) return;
    const sections = enabledSections(rep).map(s=>s.key);

    const payload = {
      id: rep.id,
      name: rep.name,
      project: rep.project,
      format: state.format,
      sections,
      generatedAt: nowISO(),
      data: Object.fromEntries(sections.map(k => [k, rep.data[k]])),
    };

    if (state.format === "json") {
      return download(`report_${rep.project}_${rep.id}.json`, new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"}));
    }

    if (state.format === "csv") {
      const csvEscape = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
      };
      const toCSV = (rows) => rows.map(r => r.map(csvEscape).join(",")).join("\n");
      const lines = [
        ["id", rep.id],
        ["name", rep.name],
        ["project", rep.project],
        ["generatedAt", payload.generatedAt],
      ];
      let csv = `key,value\n${toCSV(lines)}\n`;

      if (sections.includes("details")) {
        const d = rep.data.details;
        csv += `\ndetails.name,details.title,details.manager,details.status,details.start,details.end\n`;
        csv += toCSV([[d.name,d.title,d.manager,d.status,d.start,d.end]]) + "\n";
      }
      if (sections.includes("materials")) {
        csv += `\nmaterials.item,materials.qty,materials.unit,materials.cost\n`;
        csv += toCSV(rep.data.materials.map(m => [m.item,m.qty,m.unit,m.cost])) + "\n";
      }
      if (sections.includes("labor")) {
        csv += `\nlabor.role,labor.hours,labor.rate,labor.cost\n`;
        csv += toCSV(rep.data.labor.map(l => [l.role,l.hours,l.rate,(l.hours*l.rate)])) + "\n";
      }
      if (sections.includes("budget")) {
        const b = rep.data.budget;
        csv += `\nbudget.capex,budget.opex,budget.spent\n${toCSV([[b.capex,b.opex,b.spent]])}\n`;
      }
      if (sections.includes("suppliers")) {
        csv += `\nsuppliers.name,suppliers.contact\n`;
        csv += toCSV(rep.data.suppliers.map(s => [s.name,s.contact])) + "\n";
      }
      if (sections.includes("notes")) {
        csv += `\nnotes.note\n` + toCSV(rep.data.notes.map(n => [n])) + "\n";
      }

      return download(`report_${rep.project}_${rep.id}.csv`, new Blob([csv], {type:"text/csv"}));
    }

    if (state.format === "pdf") {
      const html = printableHTML(rep, payload);
      return printHTML(html);
    }
  }

  function download(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();}, 500);
  }

  function printableHTML(rep, payload) {
    const content = previewBox.innerHTML.replace(/^.*?<h3[^>]*>Preview<\/h3>/s, "");
    return `
      <!doctype html><html><head><meta charset="utf-8"/>
      <title>${escapeHTML(rep.name)} — ${escapeHTML(rep.project)}</title>
      <style>
        *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial}
        body{padding:18px;color:#0b1220}
        h1{font-size:20px;margin:0 0 8px}
        h4{margin:12px 0 6px}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #e5e7eb;padding:6px}
        thead{background:#f1f5f9}
        .meta{font-size:12px;color:#475569;margin-bottom:10px}
        @page{margin:14mm}
      </style>
      </head><body>
        <h1>${escapeHTML(rep.name)} — ${escapeHTML(rep.project)}</h1>
        <div class="meta">Format: ${escapeHTML(state.format.toUpperCase())} • Sections: ${escapeHTML(enabledSections(rep).map(s=>s.label).join(", "))} • Generated: ${escapeHTML(human(payload.generatedAt))}</div>
        ${content}
      </body></html>`;
  }

  function printHTML(html) {
    const iframe = document.createElement("iframe");
    iframe.style.position="fixed"; iframe.style.width=0; iframe.style.height=0; iframe.style.border=0;
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    iframe.onload = () => setTimeout(()=>{ iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(()=>iframe.remove(), 300); }, 50);
  }

  // ---------------------------
  // Boot
  // ---------------------------
  (function init() {
    // Cargar desde storage sin “llenar todo”; solo listado
    state.reports = persist.loadAll();
    // UI lista
    render();

    // Eventos que dependen del DOM
    previewBox.addEventListener("click", () => {
      // noop: espacio para futuros toggles
    });
  })();
}
