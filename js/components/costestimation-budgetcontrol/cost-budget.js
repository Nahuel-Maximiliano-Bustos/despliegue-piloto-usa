// cost.js — Cost Estimation & Budget Control (dark, responsive, vanilla JS)
// Usage:
//   import mountCost from './cost.js'
//   mountCost(document.querySelector('#cost'), { provider: myProvider, projects: ['PR-01','PR-02'] })
//
// If you don't pass a provider, it uses LocalStorage (key: "app.cost.v1").
// To plug your backend, implement a provider with the methods used in `data` below.

export default function mountCost(el, props = {}) {
    // -----------------------------
    // Config
    // -----------------------------
    const cfg = {
        storageKey: props.storageKey ?? "app.cost.v1",
        projects: props.projects ?? ["PR-01", "PR-02", "PR-03"],
    };

    // -----------------------------
    // Data provider (pluggable)
    // -----------------------------
    const local = {
        _read() {
            try { return JSON.parse(localStorage.getItem(cfg.storageKey)) || { estimates: [], cos: [], actuals: [], committed: [] }; }
            catch { return { estimates: [], cos: [], actuals: [], committed: [] }; }
        },
        _write(data) { localStorage.setItem(cfg.storageKey, JSON.stringify(data)); },

        async listProjects() { return cfg.projects; },

        // Estimates (header + line items)
        async listEstimates(projectId) {
            const db = local._read();
            return db.estimates.filter(e => e.project === projectId);
        },
        async getEstimate(id) {
            const db = local._read();
            return db.estimates.find(e => e.id === id) || null;
        },
        async saveEstimate(est) {
            const db = local._read();
            const i = db.estimates.findIndex(x => x.id === est.id);
            if (i >= 0) db.estimates[i] = est; else db.estimates.push(est);
            local._write(db);
            return est;
        },
        async deleteEstimate(id) {
            const db = local._read();
            db.estimates = db.estimates.filter(e => e.id !== id);
            local._write(db);
        },

        // Change Orders (affect budget baseline)
        async listCO(projectId) {
            const db = local._read();
            return db.cos.filter(c => c.project === projectId);
        },
        async saveCO(co) {
            const db = local._read();
            const i = db.cos.findIndex(x => x.id === co.id);
            if (i >= 0) db.cos[i] = co; else db.cos.push(co);
            local._write(db);
            return co;
        },
        async deleteCO(id) {
            const db = local._read();
            db.cos = db.cos.filter(c => c.id !== id);
            local._write(db);
        },

        // Actuals & Committed (summaries or line registers — you can expand as needed)
        async listActuals(projectId) {
            const db = local._read();
            return db.actuals.filter(a => a.project === projectId);
        },
        async listCommitted(projectId) {
            const db = local._read();
            return db.committed.filter(c => c.project === projectId);
        },
        // helpers to upsert for demo-free manual entries in the panel:
        async addActual(a) {
            const db = local._read(); db.actuals.push(a); local._write(db); return a;
        },
        async addCommitted(c) {
            const db = local._read(); db.committed.push(c); local._write(db); return c;
        },
    };

    // Use external provider if given; otherwise LocalStorage
    const data = props.provider ?? local;

    // -----------------------------
    // State
    // -----------------------------
    const state = {
        project: cfg.projects[0],
        estimates: [],            // list view (this project)
        selectedId: null,         // current estimate id
        tab: "estimate",          // estimate | budget | history
        filter: "",
        format: "pdf",
        editMode: false,

        coList: [],
        actuals: [],
        committed: [],

        // ephemeral
        loading: false,
        error: null,
    };

    // -----------------------------
    // Helpers
    // -----------------------------
    const $$ = (sel, root = el) => Array.from(root.querySelectorAll(sel));
    const $ = (sel, root = el) => root.querySelector(sel);
    const uid = () => Math.random().toString(36).slice(2, 10);
    const nowISO = () => new Date().toISOString();
    const human = (d) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

    const escapeHTML = (s) => String(s)
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

    const selected = () => state.estimates.find(e => e.id === state.selectedId) || null;

    // Default estimate draft
    const newEstimate = (project) => ({
        id: `EST-${uid()}`,
        name: "Untitled estimate",
        project,
        // global factors (% as numbers, not 0..1)
        factors: { contingency: 5, overhead: 8, profit: 10, tax: 0 },
        progress: 0, // % completion for forecast
        baselineApprovedAt: null, // when baseline is locked/approved
        createdAt: nowISO(),
        updatedAt: nowISO(),
        versionNote: "",
        // table items
        items: [
            // {id, category, description, qty, unit, unitCost, markup} // markup optional (%)
        ],
        history: [], // [{ at, note, snapshot }]
    });

    const money = (n) => {
        const v = Number(n || 0);
        return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
    };

    // Calc totals from items and factors
    function calcTotals(est) {
        const catTotals = {};
        let subtotal = 0;
        for (const it of est.items) {
            const base = (Number(it.qty) || 0) * (Number(it.unitCost) || 0);
            const line = base * (1 + (Number(it.markup) || 0) / 100);
            subtotal += line;
            catTotals[it.category] = (catTotals[it.category] || 0) + line;
        }
        const contingency = subtotal * (est.factors.contingency || 0) / 100;
        const overhead = subtotal * (est.factors.overhead || 0) / 100;
        const profit = subtotal * (est.factors.profit || 0) / 100;
        const beforeTax = subtotal + contingency + overhead + profit;
        const tax = beforeTax * (est.factors.tax || 0) / 100;
        const total = beforeTax + tax;

        return { subtotal, contingency, overhead, profit, tax, total, catTotals };
    }

    // Budget control metrics
    function budgetMetrics(est, coList, actuals, committed) {
        const totals = calcTotals(est);
        const baseline = est.baselineApprovedAt ? totals.total : 0; // if not approved yet, baseline=0
        const approvedCO = coList.reduce((s, co) => s + Number(co.amount || 0), 0);
        const currentBudget = baseline + approvedCO;

        const totalCommitted = committed.reduce((s, c) => s + Number(c.amount || 0), 0);
        const totalActuals = actuals.reduce((s, a) => s + Number(a.amount || 0), 0);

        // Forecast: EAC = Actuals + (Total * (1 - progress%))   (simple, replace with your method if needed)
        const progress = Number(est.progress || 0) / 100;
        const eac = totalActuals + totals.total * (1 - progress);

        const variance = currentBudget - eac;
        const remaining = currentBudget - totalActuals;

        return {
            baseline, approvedCO, currentBudget,
            committed: totalCommitted, actuals: totalActuals,
            eac, variance, variancePct: currentBudget ? (variance / currentBudget) * 100 : 0,
            remaining,
        };
    }

    // -----------------------------
    // Render (Dark mode UI)
    // -----------------------------
    el.innerHTML = `
    <div class="px-6 md:px-10 py-8 md:ml-72 min-h-[90vh] bg-slate-950">
      <div class="flex items-center gap-3">
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#0f172a"></rect>
          <path d="M6 12h12M6 17h12M6 7h12" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"></path>
        </svg>
        <h1 class="text-5xl md:text-6xl font-black tracking-tight text-slate-50">Cost Estimation & Budget Control</h1>
      </div>
      <p class="mt-2 text-lg text-slate-400">Build estimates, approve baselines, and track financial performance.</p>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <!-- Sidebar -->
        <aside class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div class="grid grid-cols-1 gap-2">
            <label class="text-xs text-slate-400">Project
              <select data-role="project" class="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"></select>
            </label>
            <div class="flex gap-2">
              <input type="text" data-role="search" placeholder="Search estimates…" class="flex-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2 placeholder-slate-500"/>
              <button data-role="new" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3 py-2">New</button>
            </div>
          </div>

          <ul data-role="list" class="mt-4 divide-y divide-slate-800"></ul>
        </aside>

        <!-- Main -->
        <section class="lg:col-span-2 space-y-6">
          <!-- Toolbar -->
          <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <nav class="flex gap-1" data-role="tabs">
                <button data-tab="estimate" class="px-3 py-2 rounded-lg text-slate-200 bg-slate-800 border border-slate-700">Estimate</button>
                <button data-tab="budget"   class="px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800 border border-slate-700">Budget Control</button>
                <button data-tab="history"  class="px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800 border border-slate-700">History</button>
              </nav>
              <span data-role="status" class="text-xs text-slate-400"></span>
            </div>
            <div class="flex items-center gap-2">
              <select data-role="fmt" class="rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2">
                <option value="pdf">PDF</option>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
              <button data-role="export" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 disabled:opacity-50">Export</button>
              <button data-role="edit"   class="rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 px-3 py-2">Edit</button>
              <button data-role="approve" class="rounded-lg border border-emerald-900 text-emerald-300 hover:bg-emerald-950 px-3 py-2">Approve Baseline</button>
              <button data-role="delete" class="rounded-lg border border-red-900 text-red-300 hover:bg-red-950 px-3 py-2">Delete</button>
            </div>
          </div>

          <!-- Estimate tab -->
          <div data-tab-panel="estimate" class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <form data-role="form" class="space-y-4 hidden">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label class="text-sm text-slate-300">
                  <span class="block mb-1">Estimate Name</span>
                  <input name="name" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2" required/>
                </label>
                <label class="text-sm text-slate-300">
                  <span class="block mb-1">Progress (%)</span>
                  <input type="number" name="progress" min="0" max="100" step="1" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
                </label>
                <label class="text-sm text-slate-300">
                  <span class="block mb-1">Version note</span>
                  <input name="versionNote" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2" placeholder="What changed?"/>
                </label>
              </div>

              <!-- Items table -->
              <div>
                <div class="flex items-center justify-between">
                  <h4 class="text-slate-200 font-semibold">Line Items</h4>
                  <button type="button" data-role="add-item" class="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">+ Add item</button>
                </div>
                <div class="mt-2 overflow-x-auto">
                  <table class="w-full text-sm border border-slate-800 text-slate-200">
                    <thead class="bg-slate-800/60">
                      <tr>
                        <th class="px-2 py-1 text-left">Category</th>
                        <th class="px-2 py-1 text-left">Description</th>
                        <th class="px-2 py-1 text-right">Qty</th>
                        <th class="px-2 py-1 text-left">Unit</th>
                        <th class="px-2 py-1 text-right">Unit Cost</th>
                        <th class="px-2 py-1 text-right">Markup %</th>
                        <th class="px-2 py-1 text-right">Line Total</th>
                        <th class="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody data-role="items"></tbody>
                  </table>
                </div>
              </div>

              <!-- Factors -->
              <fieldset class="border border-slate-800 rounded-xl p-3">
                <legend class="px-2 text-slate-200">Global factors</legend>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <label class="text-slate-300"><span class="block mb-1">Contingency %</span><input type="number" name="contingency" step="0.1" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1"/></label>
                  <label class="text-slate-300"><span class="block mb-1">Overhead %</span><input type="number" name="overhead" step="0.1" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1"/></label>
                  <label class="text-slate-300"><span class="block mb-1">Profit %</span><input type="number" name="profit" step="0.1" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1"/></label>
                  <label class="text-slate-300"><span class="block mb-1">Tax %</span><input type="number" name="tax" step="0.1" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1"/></label>
                </div>
              </fieldset>

              <div class="flex items-center justify-end gap-2">
                <button type="button" data-role="cancel" class="rounded-lg border border-slate-700 text-slate-200 px-3 py-2 hover:bg-slate-800">Cancel</button>
                <button type="submit" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2">Save</button>
              </div>
            </form>

            <!-- Read-only summary -->
            <div data-role="summary" class="space-y-4">
              <div class="text-slate-400">Select or create an estimate to begin.</div>
            </div>
          </div>

          <!-- Budget Control tab -->
          <div data-tab-panel="budget" class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 hidden">
            <div data-role="budget-cards" class="grid grid-cols-2 md:grid-cols-3 gap-3"></div>

            <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- COs -->
              <div class="rounded-xl border border-slate-800 p-3">
                <div class="flex items-center justify-between">
                  <h4 class="text-slate-200 font-semibold">Change Orders</h4>
                  <button data-role="add-co" class="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">+ Add CO</button>
                </div>
                <table class="mt-2 w-full text-sm border border-slate-800 text-slate-200">
                  <thead class="bg-slate-800/60">
                    <tr><th class="px-2 py-1 text-left">#</th><th class="px-2 py-1 text-left">Title</th><th class="px-2 py-1 text-right">Amount</th><th class="px-2 py-1"></th></tr>
                  </thead>
                  <tbody data-role="co-list"></tbody>
                </table>
              </div>

              <!-- Actuals & Committed -->
              <div class="rounded-xl border border-slate-800 p-3">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <div class="flex items-center justify-between">
                      <h4 class="text-slate-200 font-semibold">Committed</h4>
                      <button data-role="add-committed" class="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">+ Add</button>
                    </div>
                    <ul data-role="committed" class="mt-2 space-y-1 text-sm text-slate-300"></ul>
                  </div>
                  <div>
                    <div class="flex items-center justify-between">
                      <h4 class="text-slate-200 font-semibold">Actuals</h4>
                      <button data-role="add-actual" class="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">+ Add</button>
                    </div>
                    <ul data-role="actuals" class="mt-2 space-y-1 text-sm text-slate-300"></ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- History tab -->
          <div data-tab-panel="history" class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 hidden">
            <ul data-role="history" class="space-y-2"></ul>
          </div>
        </section>
      </div>
    </div>
  `;

    // -----------------------------
    // Refs
    // -----------------------------
    const projectSel = $('[data-role="project"]');
    const listBox = $('[data-role="list"]');
    const searchBox = $('[data-role="search"]');
    const newBtn = $('[data-role="new"]');

    const tabsNav = $('[data-role="tabs"]');
    const estimatePanel = $('[data-tab-panel="estimate"]');
    const budgetPanel = $('[data-tab-panel="budget"]');
    const historyPanel = $('[data-tab-panel="history"]');

    const statusBox = $('[data-role="status"]');
    const fmtSel = $('[data-role="fmt"]');
    const exportBtn = $('[data-role="export"]');
    const editBtn = $('[data-role="edit"]');
    const approveBtn = $('[data-role="approve"]');
    const deleteBtn = $('[data-role="delete"]');

    // Estimate form/summary
    const form = estimatePanel.querySelector('[data-role="form"]');
    const itemsTbody = estimatePanel.querySelector('[data-role="items"]');
    const addItemBtn = estimatePanel.querySelector('[data-role="add-item"]');
    const cancelBtn = estimatePanel.querySelector('[data-role="cancel"]');
    const summaryBox = estimatePanel.querySelector('[data-role="summary"]');

    // Budget
    const budgetCards = budgetPanel.querySelector('[data-role="budget-cards"]');
    const coTbody = budgetPanel.querySelector('[data-role="co-list"]');
    const addCoBtn = budgetPanel.querySelector('[data-role="add-co"]');
    const committedList = budgetPanel.querySelector('[data-role="committed"]');
    const actualsList = budgetPanel.querySelector('[data-role="actuals"]');
    const addCommittedBtn = budgetPanel.querySelector('[data-role="add-committed"]');
    const addActualBtn = budgetPanel.querySelector('[data-role="add-actual"]');

    const historyList = historyPanel.querySelector('[data-role="history"]');

    // -----------------------------
    // Populate project selector
    // -----------------------------
    (async function initProjects() {
        const projs = await data.listProjects();
        projectSel.innerHTML = projs.map(p => `<option>${escapeHTML(p)}</option>`).join("");
        state.project = projs[0] || cfg.projects[0];
        projectSel.value = state.project;
        await reloadAll();
    })();

    // -----------------------------
    // Renderers
    // -----------------------------
    function renderList() {
        const q = state.filter.trim().toLowerCase();
        const items = state.estimates
            .filter(e => !q || e.name.toLowerCase().includes(q))
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

        listBox.innerHTML = items.map(e => `
      <li class="py-2">
        <button data-id="${e.id}" class="w-full text-left rounded-lg px-3 py-2 ${state.selectedId === e.id ? 'bg-slate-800 text-slate-50' : 'hover:bg-slate-800/60 text-slate-200'}">
          <div class="flex items-center justify-between">
            <span class="font-medium">${escapeHTML(e.name)}</span>
            <span class="text-xs text-slate-400">${escapeHTML(e.project)}</span>
          </div>
          <div class="text-xs text-slate-500">Updated: ${escapeHTML(human(e.updatedAt))}${e.baselineApprovedAt ? ' • Baseline approved' : ''}</div>
        </button>
      </li>
    `).join("") || `<li class="text-slate-500 text-sm py-2">No estimates found.</li>`;
    }

    function renderToolbar() {
        const has = !!selected();
        exportBtn.disabled = !has;
        editBtn.disabled = !has;
        approveBtn.disabled = !has || !!selected().baselineApprovedAt;
        deleteBtn.disabled = !has;
        fmtSel.value = state.format;

        tabsNav.querySelectorAll('button').forEach(b => {
            b.classList.toggle('bg-slate-800', b.dataset.tab === state.tab);
        });

        // show panels
        estimatePanel.classList.toggle('hidden', state.tab !== 'estimate');
        budgetPanel.classList.toggle('hidden', state.tab !== 'budget');
        historyPanel.classList.toggle('hidden', state.tab !== 'history');

        statusBox.textContent = has ? (state.editMode ? "Editing…" : "Ready") : "No estimate selected";
    }

    function renderItemsTable(est) {
        itemsTbody.innerHTML = est.items.map(it => {
            const base = (Number(it.qty) || 0) * (Number(it.unitCost) || 0);
            const line = base * (1 + (Number(it.markup) || 0) / 100);
            return `
        <tr>
          <td class="px-2 py-1">
            <select class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-1 py-1">
              ${["Materials", "Labor", "Equipment", "Subcontract", "Misc"].map(c => `<option ${it.category === c ? 'selected' : ''}>${c}</option>`).join("")}
            </select>
          </td>
          <td class="px-2 py-1"><input class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-1 py-1" value="${escapeHTML(it.description || "")}"/></td>
          <td class="px-2 py-1 text-right"><input type="number" step="0.01" class="w-24 text-right rounded bg-slate-800 border border-slate-700 text-slate-100 px-1 py-1" value="${it.qty ?? 0}"/></td>
          <td class="px-2 py-1"><input class="w-24 rounded bg-slate-800 border border-slate-700 text-slate-100 px-1 py-1" value="${escapeHTML(it.unit || "")}"/></td>
          <td class="px-2 py-1 text-right"><input type="number" step="0.01" class="w-28 text-right rounded bg-slate-800 border border-slate-700 text-slate-100 px-1 py-1" value="${it.unitCost ?? 0}"/></td>
          <td class="px-2 py-1 text-right"><input type="number" step="0.1" class="w-24 text-right rounded bg-slate-800 border border-slate-700 text-slate-100 px-1 py-1" value="${it.markup ?? 0}"/></td>
          <td class="px-2 py-1 text-right">${money(line)}</td>
          <td class="px-2 py-1 text-right"><button type="button" class="rounded border border-red-900 text-red-300 hover:bg-red-950 px-2">×</button></td>
        </tr>
      `;
        }).join("");
    }

    function renderEstimateView() {
        const est = selected();
        // toggle edit vs read
        form.classList.toggle('hidden', !state.editMode);
        summaryBox.classList.toggle('hidden', state.editMode);
        addItemBtn.disabled = !state.editMode;

        if (!est) {
            summaryBox.innerHTML = `<div class="text-slate-400">Select or create an estimate to begin.</div>`;
            return;
        }

        if (state.editMode) {
            form.name.value = est.name;
            form.progress.value = est.progress ?? 0;
            form.versionNote.value = est.versionNote || "";
            form.contingency.value = est.factors.contingency ?? 0;
            form.overhead.value = est.factors.overhead ?? 0;
            form.profit.value = est.factors.profit ?? 0;
            form.tax.value = est.factors.tax ?? 0;

            renderItemsTable(est);
            return;
        }

        // read-only summary
        const totals = calcTotals(est);
        const cats = Object.entries(totals.catTotals).map(([k, v]) => `
      <div class="flex items-center justify-between"><span class="text-slate-400">${k}</span><span>${money(v)}</span></div>
    `).join("");

        summaryBox.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="rounded-xl border border-slate-800 p-3">
          <div class="text-slate-400 text-xs">Subtotal</div>
          <div class="text-slate-100 text-xl font-semibold">${money(totals.subtotal)}</div>
        </div>
        <div class="rounded-xl border border-slate-800 p-3">
          <div class="text-slate-400 text-xs">Before Tax</div>
          <div class="text-slate-100 text-xl font-semibold">${money(totals.subtotal + totals.contingency + totals.overhead + totals.profit)}</div>
        </div>
        <div class="rounded-xl border border-slate-800 p-3">
          <div class="text-slate-400 text-xs">Total (incl. tax)</div>
          <div class="text-slate-100 text-xl font-semibold">${money(totals.total)}</div>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <div class="rounded-lg border border-slate-800 p-2"><div class="text-slate-400 text-xs">Contingency</div><div>${money(totals.contingency)}</div></div>
        <div class="rounded-lg border border-slate-800 p-2"><div class="text-slate-400 text-xs">Overhead</div><div>${money(totals.overhead)}</div></div>
        <div class="rounded-lg border border-slate-800 p-2"><div class="text-slate-400 text-xs">Profit</div><div>${money(totals.profit)}</div></div>
        <div class="rounded-lg border border-slate-800 p-2"><div class="text-slate-400 text-xs">Tax</div><div>${money(totals.tax)}</div></div>
      </div>

      <div class="mt-4 rounded-xl border border-slate-800 p-3">
        <div class="text-slate-200 font-semibold mb-2">By Category</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">${cats || '<div class="text-slate-500">No items</div>'}</div>
      </div>
    `;
    }

    function renderBudget() {
        const est = selected();
        if (!est) {
            budgetCards.innerHTML = `<div class="text-slate-500">Select an estimate to view budget.</div>`;
            coTbody.innerHTML = ""; committedList.innerHTML = ""; actualsList.innerHTML = ""; return;
        }

        const m = budgetMetrics(est, state.coList, state.actuals, state.committed);

        const card = (label, val, accent = "") => `
      <div class="rounded-xl border border-slate-800 p-3">
        <div class="text-slate-400 text-xs">${label}</div>
        <div class="text-slate-100 text-xl font-semibold ${accent}">${val}</div>
      </div>`;

        const varianceAccent = m.variance >= 0 ? "text-emerald-400" : "text-red-400";

        budgetCards.innerHTML = `
      ${card("Baseline", money(m.baseline))}
      ${card("Approved COs", money(m.approvedCO))}
      ${card("Current Budget", money(m.currentBudget))}
      ${card("Committed", money(m.committed))}
      ${card("Actuals to Date", money(m.actuals))}
      ${card("Remaining Budget", money(m.remaining))}
      ${card("EAC (Forecast)", money(m.eac))}
      ${card("Variance (Budget - EAC)", money(m.variance), varianceAccent)}
      ${card("Variance %", `${m.variancePct.toFixed(1)}%`, varianceAccent)}
    `;

        // CO table
        coTbody.innerHTML = state.coList.map(co => `
      <tr>
        <td class="px-2 py-1">${escapeHTML(co.number)}</td>
        <td class="px-2 py-1">${escapeHTML(co.title || "")}</td>
        <td class="px-2 py-1 text-right">${money(co.amount)}</td>
        <td class="px-2 py-1 text-right"><button data-co="${co.id}" class="rounded border border-red-900 text-red-300 hover:bg-red-950 px-2">×</button></td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="px-2 py-2 text-slate-500">No change orders.</td></tr>`;

        committedList.innerHTML = state.committed.map(c => `
      <li class="flex items-center justify-between">
        <span class="text-slate-300">${escapeHTML(c.ref)} — ${escapeHTML(c.note || 'PO')}</span>
        <span>${money(c.amount)}</span>
      </li>
    `).join("") || `<li class="text-slate-500">No committed amounts.</li>`;

        actualsList.innerHTML = state.actuals.map(a => `
      <li class="flex items-center justify-between">
        <span class="text-slate-300">${escapeHTML(a.ref)} — ${escapeHTML(a.note || 'Cost')}</span>
        <span>${money(a.amount)}</span>
      </li>
    `).join("") || `<li class="text-slate-500">No actuals recorded.</li>`;
    }

    function renderHistory() {
        const est = selected();
        historyList.innerHTML = !est || !est.history.length
            ? `<li class="text-slate-500">No history yet.</li>`
            : est.history.slice().reverse().map(h => `
        <li class="rounded-lg border border-slate-800 p-3">
          <div class="text-slate-200 font-medium">${escapeHTML(h.note || "Saved")}</div>
          <div class="text-xs text-slate-500">at ${escapeHTML(human(h.at))}</div>
        </li>
      `).join("");
    }

    function renderAll() {
        renderList();
        renderToolbar();
        renderEstimateView();
        renderBudget();
        renderHistory();
    }

    // -----------------------------
    // Loaders
    // -----------------------------
    async function reloadAll() {
        state.loading = true; renderAll();
        try {
            state.estimates = await data.listEstimates(state.project);
            if (!state.selectedId) state.selectedId = state.estimates[0]?.id || null;
            state.coList = await data.listCO(state.project);
            state.actuals = await data.listActuals(state.project);
            state.committed = await data.listCommitted(state.project);
        } catch (e) {
            state.error = e?.message || "Failed to load data";
        }
        state.loading = false; renderAll();
    }

    // -----------------------------
    // Events — Sidebar
    // -----------------------------
    projectSel.addEventListener("change", async () => {
        state.project = projectSel.value;
        state.selectedId = null;
        await reloadAll();
    });

    listBox.addEventListener("click", (e) => {
        const id = e.target.closest("button[data-id]")?.dataset.id;
        if (!id) return;
        state.selectedId = id; state.editMode = false; renderAll();
    });

    searchBox.addEventListener("input", () => {
        state.filter = searchBox.value;
        renderList();
    });

    newBtn.addEventListener("click", async () => {
        const est = newEstimate(state.project);
        await data.saveEstimate(est);
        state.estimates.unshift(est);
        state.selectedId = est.id;
        state.editMode = true;
        renderAll();
    });

    // -----------------------------
    // Events — Toolbar
    // -----------------------------
    tabsNav.addEventListener("click", (e) => {
        const tab = e.target.closest("button[data-tab]")?.dataset.tab;
        if (!tab) return;
        state.tab = tab; renderToolbar(); renderBudget(); renderHistory();
    });

    fmtSel.addEventListener("change", () => { state.format = fmtSel.value; renderToolbar(); });

    editBtn.addEventListener("click", () => { if (!selected()) return; state.editMode = true; renderAll(); });

    approveBtn.addEventListener("click", async () => {
        const est = selected(); if (!est) return;
        if (est.baselineApprovedAt) return;
        if (!confirm("Approve this estimate as the cost baseline?")) return;
        est.baselineApprovedAt = nowISO();
        est.updatedAt = nowISO();
        await data.saveEstimate(est);
        renderAll();
    });

    deleteBtn.addEventListener("click", async () => {
        const est = selected(); if (!est) return;
        if (!confirm(`Delete estimate "${est.name}"?`)) return;
        await data.deleteEstimate(est.id);
        state.estimates = state.estimates.filter(x => x.id !== est.id);
        state.selectedId = state.estimates[0]?.id || null;
        renderAll();
    });

    exportBtn.addEventListener("click", () => doExport());

    // -----------------------------
    // Events — Estimate form
    // -----------------------------
    addItemBtn.addEventListener("click", () => {
        const est = selected(); if (!est) return;
        const item = { id: `IT-${uid()}`, category: "Materials", description: "", qty: 1, unit: "ea", unitCost: 0, markup: 0 };
        est.items.push(item);
        renderItemsTable(est);
    });

    itemsTbody.addEventListener("input", (e) => {
        const est = selected(); if (!est) return;
        const rows = Array.from(itemsTbody.querySelectorAll("tr"));
        est.items = rows.map(row => {
            const [catSel, desc, qty, unit, unitCost, markup] = row.querySelectorAll("select,input");
            return {
                category: catSel.value,
                description: desc.value.trim(),
                qty: Number(qty.value || 0),
                unit: unit.value.trim(),
                unitCost: Number(unitCost.value || 0),
                markup: Number(markup.value || 0),
            };
        });
        renderItemsTable(est); // recompute line totals
    });

    itemsTbody.addEventListener("click", (e) => {
        if (!e.target.matches("button")) return;
        e.target.closest("tr").remove();
        const est = selected(); if (!est) return;
        const rows = Array.from(itemsTbody.querySelectorAll("tr"));
        est.items = rows.map(row => {
            const [catSel, desc, qty, unit, unitCost, markup] = row.querySelectorAll("select,input");
            return {
                category: catSel.value,
                description: desc.value.trim(),
                qty: Number(qty.value || 0),
                unit: unit.value.trim(),
                unitCost: Number(unitCost.value || 0),
                markup: Number(markup.value || 0),
            };
        });
        renderItemsTable(est);
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const est = selected(); if (!est) return;

        const fd = new FormData(form);
        est.name = (fd.get("name") || "").toString().trim() || "Untitled estimate";
        est.progress = Math.max(0, Math.min(100, Number(fd.get("progress") || 0)));
        est.versionNote = (fd.get("versionNote") || "").toString().trim();

        est.factors = {
            contingency: Number(fd.get("contingency") || 0),
            overhead: Number(fd.get("overhead") || 0),
            profit: Number(fd.get("profit") || 0),
            tax: Number(fd.get("tax") || 0),
        };

        // Persist a history snapshot
        if (est.versionNote) {
            est.history.push({ at: nowISO(), note: est.versionNote, snapshot: JSON.stringify(est) });
        }

        est.updatedAt = nowISO();
        await data.saveEstimate(est);
        state.editMode = false;
        renderAll();
    });

    cancelBtn.addEventListener("click", () => { state.editMode = false; renderAll(); });

    // -----------------------------
    // Events — Budget Control lists
    // -----------------------------
    addCoBtn.addEventListener("click", async () => {
        const est = selected(); if (!est) return;
        const number = prompt("CO number:");
        if (!number) return;
        const title = prompt("CO title:") || "";
        const amount = Number(prompt("CO amount (USD):") || 0);
        const co = { id: `CO-${uid()}`, project: state.project, estimateId: est.id, number, title, amount, at: nowISO() };
        await data.saveCO(co);
        state.coList = await data.listCO(state.project);
        renderBudget();
    });

    coTbody.addEventListener("click", async (e) => {
        const id = e.target.closest("button[data-co]")?.dataset.co;
        if (!id) return;
        if (!confirm("Delete this CO?")) return;
        await data.deleteCO(id);
        state.coList = await data.listCO(state.project);
        renderBudget();
    });

    addCommittedBtn.addEventListener("click", async () => {
        const ref = prompt("Committed reference (PO #):");
        if (!ref) return;
        const note = prompt("Note (optional):") || "";
        const amount = Number(prompt("Amount (USD):") || 0);
        await data.addCommitted({ id: `CM-${uid()}`, project: state.project, ref, note, amount, at: nowISO() });
        state.committed = await data.listCommitted(state.project);
        renderBudget();
    });

    addActualBtn.addEventListener("click", async () => {
        const ref = prompt("Actual reference (Invoice #):");
        if (!ref) return;
        const note = prompt("Note (optional):") || "";
        const amount = Number(prompt("Amount (USD):") || 0);
        await data.addActual({ id: `AC-${uid()}`, project: state.project, ref, note, amount, at: nowISO() });
        state.actuals = await data.listActuals(state.project);
        renderBudget();
    });

    // -----------------------------
    // Export (CSV/JSON/PDF)
    // -----------------------------
    function doExport() {
        const est = selected(); if (!est) return;

        const totals = calcTotals(est);
        const payload = {
            id: est.id,
            name: est.name,
            project: est.project,
            progress: est.progress,
            baselineApprovedAt: est.baselineApprovedAt,
            factors: est.factors,
            totals,
            items: est.items,
            generatedAt: nowISO(),
        };

        if (state.format === "json") {
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            return download(`${est.project}_${est.id}.json`, blob);
        }

        if (state.format === "csv") {
            const csvEscape = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
            const toCSV = (rows) => rows.map(r => r.map(csvEscape).join(",")).join("\n");
            let csv = `field,value\n`;
            csv += toCSV([
                ["id", est.id], ["name", est.name], ["project", est.project], ["progress", est.progress],
                ["contingency", est.factors.contingency], ["overhead", est.factors.overhead],
                ["profit", est.factors.profit], ["tax", est.factors.tax],
                ["subtotal", totals.subtotal], ["contingencyValue", totals.contingency],
                ["overheadValue", totals.overhead], ["profitValue", totals.profit],
                ["taxValue", totals.tax], ["total", totals.total],
            ]) + "\n\n";
            csv += `category,description,qty,unit,unitCost,markup,lineTotal\n`;
            csv += toCSV(est.items.map(it => {
                const base = (Number(it.qty) || 0) * (Number(it.unitCost) || 0);
                const line = base * (1 + (Number(it.markup) || 0) / 100);
                return [it.category, it.description, it.qty, it.unit, it.unitCost, it.markup, line];
            })) + "\n";
            const blob = new Blob([csv], { type: "text/csv" });
            return download(`${est.project}_${est.id}.csv`, blob);
        }

        if (state.format === "pdf") {
            const html = printableHTML(est, totals);
            return printHTML(html);
        }
    }

    function printableHTML(est, totals) {
        const itemsRows = est.items.map(it => {
            const base = (Number(it.qty) || 0) * (Number(it.unitCost) || 0);
            const line = base * (Number(1) + (Number(it.markup) || 0) / 100);
            return `<tr>
        <td>${escapeHTML(it.category)}</td>
        <td>${escapeHTML(it.description || "")}</td>
        <td style="text-align:right">${it.qty ?? 0}</td>
        <td>${escapeHTML(it.unit || "")}</td>
        <td style="text-align:right">${money(it.unitCost)}</td>
        <td style="text-align:right">${(it.markup ?? 0).toFixed(1)}%</td>
        <td style="text-align:right">${money(line)}</td>
      </tr>`;
        }).join("");

        return `
      <!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(est.name)}</title>
      <style>
        *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial}
        body{padding:18px;color:#0b1220}
        h1{font-size:20px;margin:0 0 8px}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #e5e7eb;padding:6px}
        thead{background:#f1f5f9}
        .grid{display:grid;gap:8px;grid-template-columns:repeat(3,minmax(0,1fr))}
        .card{border:1px solid #e5e7eb;padding:8px;border-radius:8px}
        @page{margin:14mm}
      </style></head><body>
        <h1>${escapeHTML(est.name)} — ${escapeHTML(est.project)}</h1>
        <div class="grid">
          <div class="card"><div>Subtotal</div><b>${money(totals.subtotal)}</b></div>
          <div class="card"><div>Before Tax</div><b>${money(totals.subtotal + totals.contingency + totals.overhead + totals.profit)}</b></div>
          <div class="card"><div>Total (incl. tax)</div><b>${money(totals.total)}</b></div>
        </div>
        <h3>Items</h3>
        <table>
          <thead><tr><th>Category</th><th>Description</th><th>Qty</th><th>Unit</th><th>Unit Cost</th><th>Markup %</th><th>Line Total</th></tr></thead>
          <tbody>${itemsRows || `<tr><td colspan="7">No items</td></tr>`}</tbody>
        </table>
      </body></html>
    `;
    }

    function printHTML(html) {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed"; iframe.style.width = 0; iframe.style.height = 0; iframe.style.border = 0;
        document.body.appendChild(iframe);
        const doc = iframe.contentWindow.document;
        doc.open(); doc.write(html); doc.close();
        iframe.onload = () => setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => iframe.remove(), 300); }, 50);
    }

    function download(filename, blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
}
