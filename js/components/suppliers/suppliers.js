// suppliers.js - Rebuilt from scratch (dark theme, fully self-contained, AppStore integrated)

  function toast(message) {
    if (!message) return;
    try {
      let host = document.querySelector("[data-suppliers-toast]");
      if (!host) {
        host = document.createElement("div");
        host.setAttribute("data-suppliers-toast", "true");
        host.style.cssText = "position:fixed;right:16px;bottom:16px;display:grid;gap:8px;z-index:300";
        document.body.appendChild(host);
      }
      const box = document.createElement("div");
      box.style.cssText = "background:#1F2937;color:#E5E7EB;border:1px solid rgba(255,255,255,.1);padding:10px 12px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:.3s";
      box.textContent = message;
      host.appendChild(box);
      setTimeout(() => { box.style.opacity = "0"; box.style.transform = "translateY(4px)"; }, 2200);
      setTimeout(() => box.remove(), 3000);
    } catch {
      console.info(message);
    }
  }
// suppliers.js - Rebuilt from scratch (dark theme, fully self-contained, AppStore integrated)

// suppliers.js - Rebuilt from scratch (dark theme, fully self-contained, AppStore integrated)
// Features:
// - CRUD with modal editor
// - Filtering (search + status) and pagination
// - Import/Export CSV
// - Stats header (committed $, orders, open POs, delayed)
// - LocalStorage persistence with AppStore synchronisation (window.AppStore)
// - Dispatches `suppliers:updated` CustomEvent with aggregate info

export default function mountSuppliers(el, props = {}) {
  const LS_KEY = props.storageKey || "app.suppliers.v1";
  const store = window.AppStore && typeof window.AppStore.getSuppliers === "function" ? window.AppStore : null;
  const STORE_READY = !!store;
  let unsubscribeStore = null;

  // ---------- Helpers ----------
  const clone = (data) => JSON.parse(JSON.stringify(data));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const toNum = (v) => (isFinite(Number(v)) ? Number(v) : 0);
  const escape = (s) => String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const isoOrEmpty = (v) => {
    if (!v) return "";
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return "";
      return d.toISOString().slice(0, 10);
    } catch {
      return "";
    }
  };
  const currency = (value) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
    } catch {
      return `$${Number(value || 0).toFixed(2)}`;
    }
  };
  const statusOptions = ["RFQ", "Ordered", "Delivered", "Delayed", "Cancelled"];

  const normalizeRow = (row = {}) => {
    const qty = toNum(row.qty ?? 1) || 1;
    const unitPrice = toNum(row.unitPrice ?? (row.cost ? Number(row.cost) / qty : 0));
    return {
      id: row.id || uid(),
      supplier: String(row.supplier || "").trim(),
      material: String(row.material || "").trim(),
      qty,
      unitPrice,
      orderDate: isoOrEmpty(row.orderDate) || isoOrEmpty(new Date()),
      deliveryDate: isoOrEmpty(row.deliveryDate),
      status: statusOptions.includes(row.status) ? row.status : "Ordered",
      contact: String(row.contact || ""),
      po: String(row.po || ""),
      notes: String(row.notes || "")
    };
  };

  const loadLocal = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(normalizeRow) : [];
    } catch {
      return [];
    }
  };

  const saveLocal = (list) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); }
    catch (err) { console.warn("Suppliers local save failed", err); }
  };

  const persist = (list) => {
    saveLocal(list);
    if (STORE_READY && typeof store.setSuppliers === "function") {
      try { store.setSuppliers(clone(list)); }
      catch (err) { console.warn("AppStore setSuppliers failed", err); }
    }
  };

  let rows = (() => {
    // Preference order: AppStore > localStorage > props.rows
    if (STORE_READY) {
      try {
        const storeRows = store.getSuppliers();
        if (Array.isArray(storeRows) && storeRows.length) {
          saveLocal(storeRows);
          return storeRows.map(normalizeRow);
        }
      } catch (err) {
        console.warn("AppStore getSuppliers failed, falling back", err);
      }
    }
    const localRows = loadLocal();
    if (localRows.length) return localRows;
    if (Array.isArray(props.rows) && props.rows.length) {
      const seeded = props.rows.map(normalizeRow);
      persist(seeded);
      return seeded;
    }
    return [];
  })();
  let blueprintSummary = (STORE_READY && typeof store.getBlueprintSummary === "function") ? store.getBlueprintSummary() : null;
  let unsubscribeBlueprint = null;

  const state = {
    search: "",
    status: "all",
    sortKey: "orderDate",
    sortDir: "desc",
    page: 1,
    pageSize: 10
  };

  // ---------- Layout ----------
  el.innerHTML = `
    <section class="px-6 md:px-10 py-8 md:ml-72 text-slate-100 transition-all duration-200" data-shell>
      <header class="space-y-1">
        <h1 class="text-5xl md:text-6xl font-black tracking-tight">SUPPLIERS</h1>
        <p class="text-lg text-slate-400">Manage relationships and purchase orders for each project.</p>
      </header>

      <div class="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-role="stats"></div>

      <div class="mt-4" data-role="bp-panel"></div>

      <div class="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2">
          <div class="relative">
            <input type="search" data-search placeholder="Search supplier, material, PO, contact..."
              class="w-80 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 pr-10 placeholder-slate-500 text-sm outline-none focus:ring-2 focus:ring-blue-500"/>
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">Ctrl/Cmd + K</span>
          </div>
          <select data-status class="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
            <option value="all">All status</option>
            ${statusOptions.map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
          <select data-pagesize class="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
            <option value="10">10 / page</option>
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <button data-import class="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:bg-slate-800">Import CSV</button>
          <button data-export class="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:bg-slate-800">Export CSV</button>
          <button data-add class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500">
            <span class="text-base">ï¼‹</span> Add supplier
          </button>
          <input data-file type="file" accept=".csv,text/csv" class="hidden" />
        </div>
      </div>

      <div class="mt-6 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
        <table class="min-w-full text-sm">
          <thead class="text-slate-300">
            <tr class="border-b border-slate-800 text-left">
              ${[
                ["supplier", "Supplier"],
                ["material", "Material"],
                ["qty", "Qty"],
                ["unitPrice", "Unit price"],
                ["total", "Total"],
                ["orderDate", "Order date"],
                ["deliveryDate", "ETA"],
                ["status", "Status"],
                ["contact", "Contact"],
                ["actions", ""]
              ].map(([key, label]) => key === "actions"
                ? `<th class="px-3 py-3 text-right">${label}</th>`
                : `<th class="px-3 py-3 select-none cursor-pointer" data-sort="${key}">
                    <span class="inline-flex items-center gap-1">${label}<svg class="w-3 h-3 opacity-50" viewBox="0 0 24 24" fill="none"><path d="M8 10l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M16 14l-4 4-4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>
                  </th>`).join("")}
            </tr>
          </thead>
          <tbody data-tbody class="divide-y divide-slate-800"></tbody>
        </table>
        <div class="hidden py-12 text-center text-slate-400" data-empty>
          <p class="text-lg font-semibold mb-2">No suppliers yet</p>
          <p class="text-sm">Start by importing data or creating your first supplier entry.</p>
        </div>
      </div>

      <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-slate-400" data-pager></div>
    </section>
  `;

  const qs = (selector) => el.querySelector(selector);
  const shell = qs("[data-shell]");
  const $stats = qs("[data-role=\"stats\"]");
  const $tbody = qs("[data-tbody]");
  const $empty = qs("[data-empty]");
  const $pager = qs("[data-pager]");
  const $search = qs("[data-search]");
  const $status = qs("[data-status]");
  const $pageSize = qs("[data-pagesize]");
  const $add = qs("[data-add]");
  const $export = qs("[data-export]");
  const $import = qs("[data-import]");
  const $file = qs("[data-file]");
  const $bpPanel = qs("[data-role='bp-panel']");

  // ---------- Layout helpers ----------
  const asideExpanded = () => {
    const aside = document.querySelector("aside[data-aside]");
    return aside ? aside.dataset.state !== "collapsed" : true;
  };
  const applyShellMargin = () => {
    shell.style.marginLeft = asideExpanded() ? "280px" : "72px";
  };
  applyShellMargin();
  const onAsideToggle = () => applyShellMargin();
  document.addEventListener("ui:sidebar:toggle", onAsideToggle);

  // ---------- State & rendering ----------
  const setRows = (list, persistStore = true) => {
    rows = Array.isArray(list) ? list.map(normalizeRow) : [];
    if (persistStore) persist(rows);
    renderAll();
  };

  const getFiltered = () => {
    let data = rows.slice();
    if (state.search) {
      const needle = state.search.toLowerCase();
      data = data.filter((row) => [
        row.supplier,
        row.material,
        row.po,
        row.contact,
        row.status
      ].some((field) => field && field.toLowerCase().includes(needle)));
    }
    if (state.status !== "all") {
      data = data.filter((row) => row.status === state.status);
    }
    data.sort((a, b) => {
      const dir = state.sortDir === "asc" ? 1 : -1;
      if (state.sortKey === "qty" || state.sortKey === "unitPrice" || state.sortKey === "total") {
        const av = state.sortKey === "total" ? (a.qty * a.unitPrice) : toNum(a[state.sortKey]);
        const bv = state.sortKey === "total" ? (b.qty * b.unitPrice) : toNum(b[state.sortKey]);
        return (av - bv) * dir;
      }
      const av = (a[state.sortKey] || "").toString().toLowerCase();
      const bv = (b[state.sortKey] || "").toString().toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return data;
  };

  const renderStats = () => {
    const totals = rows.reduce((acc, row) => {
      const total = row.qty * row.unitPrice;
      acc.committed += total;
      const delivered = row.status === "Delivered" || row.status === "Cancelled";
      if (!delivered) acc.open += 1;
      if (!delivered && row.deliveryDate) {
        const eta = new Date(row.deliveryDate);
        if (!Number.isNaN(eta.getTime()) && eta < new Date()) acc.delayed += 1;
      }
      return acc;
    }, { committed: 0, open: 0, delayed: 0 });

    const cards = [
      statCard("Committed", currency(totals.committed)),
      statCard("Orders", rows.length),
      statCard("Open POs", totals.open),
      statCard("Delayed", totals.delayed, totals.delayed ? "text-rose-400" : "text-slate-300")
    ];

    if (blueprintSummary && blueprintSummary.byIcon && Object.keys(blueprintSummary.byIcon).length) {
      const totalIcons = blueprintSummary.totals?.totalIcons ?? 0;
      cards.push(statCard("Blueprint markers", String(totalIcons)));
    }

    $stats.innerHTML = cards.join("");

    el.dispatchEvent(new CustomEvent("suppliers:updated", {
      bubbles: true,
      detail: { totals, rows: clone(rows) }
    }));
  };

  const renderBlueprintPanel = () => {
    if (!$bpPanel) return;
    const hasData = blueprintSummary && blueprintSummary.byIcon && Object.keys(blueprintSummary.byIcon).length;
    if (!hasData) {
      $bpPanel.style.display = "none";
      $bpPanel.innerHTML = "";
      return;
    }
    $bpPanel.style.display = "";
    const totalIcons = blueprintSummary.totals?.totalIcons ?? 0;
    const totalPages = blueprintSummary.totals?.totalPages ?? 0;
    const meta = `${humanizeBlueprintTimestamp(blueprintSummary.updatedAt)} | ${totalIcons} marker${totalIcons === 1 ? "" : "s"} across ${totalPages} page${totalPages === 1 ? "" : "s"}`;
    const items = Object.entries(blueprintSummary.byIcon || {}).sort((a,b) => b[1] - a[1]);
    const list = items.length
      ? items.map(([icon, count]) => {
          const color = blueprintColorForIcon(icon, blueprintSummary);
          const safeColor = escape(color);
          const swatch = `<span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${safeColor}"></span>`;
          return `
            <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-3 flex items-center justify-between">
              <div class="flex items-center gap-3">
                ${swatch}
                <div>
                  <div class="text-slate-100 font-semibold">${escape(icon)}</div>
                  <div class="text-slate-400 text-xs">${count} marker${count === 1 ? "" : "s"}</div>
                </div>
              </div>
              <button class="rounded-lg border border-slate-700 px-3 py-1 text-xs hover:bg-slate-800" data-bp-supplier="${escape(icon)}">Create PO</button>
            </div>`;
        }).join("")
      : '<div class="text-sm text-slate-400">No markers detected.</div>';

    $bpPanel.innerHTML = `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold text-slate-100">Blueprint summary</h3>
            <p class="text-xs text-slate-400">${escape(meta)}</p>
          </div>
        </div>
        <div class="grid gap-3 mt-4 md:grid-cols-2">
          ${list}
        </div>
      </div>`;
  };
  const renderTable = () => {
    const data = getFiltered();
    const totalPages = Math.max(1, Math.ceil(data.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * state.pageSize;
    const slice = data.slice(start, start + state.pageSize);

    $empty.classList.toggle("hidden", slice.length > 0);
    $tbody.innerHTML = slice.map((row) => `
      <tr class="hover:bg-slate-900/80 transition" data-id="${row.id}">
        <td class="px-3 py-3 font-medium text-slate-200">${escape(row.supplier)}</td>
        <td class="px-3 py-3 text-slate-300">${escape(row.material)}</td>
        <td class="px-3 py-3 text-right text-slate-200">${row.qty}</td>
        <td class="px-3 py-3 text-right text-slate-300">${currency(row.unitPrice)}</td>
        <td class="px-3 py-3 text-right text-slate-200 font-semibold">${currency(row.qty * row.unitPrice)}</td>
        <td class="px-3 py-3 text-slate-300">${formatDate(row.orderDate)}</td>
        <td class="px-3 py-3 text-slate-300">${formatDate(row.deliveryDate)}</td>
        <td class="px-3 py-3">${statusBadge(row.status)}</td>
        <td class="px-3 py-3 text-slate-300">${escape(row.contact)}</td>
        <td class="px-3 py-3 text-right">
          <div class="inline-flex items-center gap-3 text-xs">
            ${row.status !== "Delivered" ? `<button data-markdone="${row.id}" class="text-emerald-400 hover:underline">Mark delivered</button>` : ""}
            <button data-edit="${row.id}" class="text-indigo-300 hover:underline">Edit</button>
            <button data-delete="${row.id}" class="text-rose-400 hover:underline">Remove</button>
          </div>
        </td>
      </tr>
    `).join("");

    const prevDisabled = state.page <= 1;
    const nextDisabled = state.page >= totalPages;
    const baseBtn = "rounded-lg border border-slate-700 px-3 py-1";
    const enabledBtn = `${baseBtn} hover:bg-slate-800 transition`;
    const disabledBtn = `${baseBtn} opacity-40 cursor-not-allowed`;

    $pager.innerHTML = `
      <div>Showing <strong>${slice.length}</strong> of <strong>${data.length}</strong> suppliers</div>
      <div class="flex items-center gap-2">
        <button data-pg="prev" class="${prevDisabled ? disabledBtn : enabledBtn}" ${prevDisabled ? "disabled" : ""}>Prev</button>
        <span>Page ${state.page} / ${totalPages}</span>
        <button data-pg="next" class="${nextDisabled ? disabledBtn : enabledBtn}" ${nextDisabled ? "disabled" : ""}>Next</button>
      </div>
    `;
  };

  const renderAll = () => {
    renderStats();
    renderTable();
    renderBlueprintPanel();
  };

  // ---------- Event handlers ----------
  const onSortClick = (event) => {
    const th = event.target.closest("[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else {
      state.sortKey = key;
      state.sortDir = key === "supplier" ? "asc" : "desc";
    }
    renderTable();
  };

  const onTableClick = (event) => {
    const editBtn = event.target.closest("[data-edit]");
    if (editBtn) {
      const row = rows.find((r) => r.id === editBtn.dataset.edit);
      openModal(row);
      return;
    }
    const deleteBtn = event.target.closest("[data-delete]");
    if (deleteBtn) {
      const id = deleteBtn.dataset.delete;
      if (confirm("Remove this supplier entry?")) {
        setRows(rows.filter((r) => r.id !== id));
      }
      return;
    }
    const doneBtn = event.target.closest("[data-markdone]");
    if (doneBtn) {
      const id = doneBtn.dataset.markdone;
      setRows(rows.map((r) => (r.id === id ? { ...r, status: "Delivered" } : r)));
    }
  };

  const onPagerClick = (event) => {
    const pagerBtn = event.target.closest("[data-pg]");
    if (!pagerBtn || pagerBtn.hasAttribute("disabled")) return;
    const totalPages = Math.max(1, Math.ceil(getFiltered().length / state.pageSize));
    if (pagerBtn.dataset.pg === "prev" && state.page > 1) state.page -= 1;
    if (pagerBtn.dataset.pg === "next" && state.page < totalPages) state.page += 1;
    renderTable();
  };

  const onSearchInput = () => {
    state.search = ($search.value || "").trim();
    state.page = 1;
    renderTable();
  };

  const onFilterChange = () => {
    state.status = $status.value;
    state.pageSize = Number($pageSize.value) || 10;
    state.page = 1;
    renderTable();
  };

  const onShortcut = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $search.focus();
    }
  };

  const onBlueprintPanelClick = (event) => {
    const btn = event.target.closest("[data-bp-supplier]");
    if (!btn) return;
    addSupplierFromBlueprint(btn.dataset.bpSupplier);
  };
  if ($bpPanel) {
    $bpPanel.addEventListener("click", onBlueprintPanelClick);
  }
  const onBlueprintDataUpdate = (event) => {
    if (!event?.detail?.blueprintSummary) return;
    blueprintSummary = event.detail.blueprintSummary;
    renderStats();
    renderBlueprintPanel();
  };
  document.addEventListener("ui:data:update", onBlueprintDataUpdate);
  const exportCSV = () => {
    const headers = ["supplier", "material", "qty", "unitPrice", "orderDate", "deliveryDate", "status", "contact", "po", "notes"];
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map((field) => csvEscape(row[field])).join(","));
    }
    downloadFile(`suppliers_${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n"), "text/csv");
  };

  const importCSV = async (file) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseCSV(text).map(normalizeRow);
    if (parsed.length) {
      setRows(rows.concat(parsed));
    }
    $file.value = "";
  };

    // Modal for add/edit
  const openModal = (row = null) => {
    const editing = !!row;
    const model = row ? { ...row } : normalizeRow({
      supplier: "",
      material: "",
      qty: 1,
      unitPrice: 0,
      orderDate: isoOrEmpty(new Date()),
      deliveryDate: "",
      status: "Ordered",
      contact: "",
      po: "",
      notes: ""
    });

    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4";
    overlay.innerHTML = `
      <div class="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-xl">
        <header class="flex items-center justify-between">
          <h2 class="text-xl font-semibold">${editing ? "Edit supplier" : "Add supplier"}</h2>
          <button data-close class="text-slate-400 hover:text-slate-200">&times;</button>
        </header>
        <form data-form class="mt-5 grid gap-4 md:grid-cols-2 text-sm">
          <label class="grid gap-1">Supplier<span><input name="supplier" required value="${escape(model.supplier)}" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none"/></span></label>
          <label class="grid gap-1">Material<span><input name="material" required value="${escape(model.material)}" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none"/></span></label>
          <label class="grid gap-1">Quantity<span><input type="number" name="qty" min="0" step="0.01" value="${model.qty}" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none"/></span></label>
          <label class="grid gap-1">Unit price<span><input type="number" name="unitPrice" min="0" step="0.01" value="${model.unitPrice}" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none"/></span></label>
          <label class="grid gap-1">Order date<span><input type="date" name="orderDate" value="${isoOrEmpty(model.orderDate)}" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none"/></span></label>
          <label class="grid gap-1">Delivery ETA<span><input type="date" name="deliveryDate" value="${isoOrEmpty(model.deliveryDate)}" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none"/></span></label>
          <label class="grid gap-1">Status<span>
            <select name="status" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none">
              ${statusOptions.map((status) => `<option value="${status}" ${model.status === status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          </span></label>
          <label class="grid gap-1">PO Number<span><input name="po" value="${escape(model.po)}" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none"/></span></label>
          <label class="grid gap-1 md:col-span-2">Contact<span><input name="contact" value="${escape(model.contact)}" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none"/></span></label>
          <label class="grid gap-1 md:col-span-2">Notes<span><textarea name="notes" rows="3" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none">${escape(model.notes)}</textarea></span></label>

          <div class="md:col-span-2 flex items-center justify-between mt-4">
            ${editing ? `<button type="button" data-delete class="text-rose-400 hover:underline">Delete</button>` : "<span></span>"}
            <div class="flex items-center gap-2">
              <button type="button" data-close class="rounded-lg border border-slate-700 px-4 py-2 hover:bg-slate-800">Cancel</button>
              <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-500">${editing ? "Save changes" : "Create"}</button>
            </div>
          </div>
        </form>
      </div>
    `;

    overlay.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => overlay.remove()));
    overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });

    const form = overlay.querySelector("[data-form]");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const updated = normalizeRow({
        ...model,
        supplier: fd.get("supplier"),
        material: fd.get("material"),
        qty: fd.get("qty"),
        unitPrice: fd.get("unitPrice"),
        orderDate: fd.get("orderDate"),
        deliveryDate: fd.get("deliveryDate"),
        status: fd.get("status"),
        contact: fd.get("contact"),
        po: fd.get("po"),
        notes: fd.get("notes")
      });

      if (editing) {
        setRows(rows.map((r) => (r.id === model.id ? updated : r)));
      } else {
        setRows(rows.concat(updated));
      }
      overlay.remove();
    });

    const deleteBtn = overlay.querySelector("[data-delete]");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (!confirm("Remove this supplier entry?")) return;
        setRows(rows.filter((r) => r.id !== model.id));
        overlay.remove();
      });
    }

    document.body.appendChild(overlay);
    return overlay;
  };

  // ---------- CSV helpers ----------
  const csvEscape = (value) => {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
  };

  const parseCSV = (text) => {
    const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
    if (!lines.length) return [];
    const headers = splitCSVLine(lines[0]);
    const records = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cells = splitCSVLine(lines[i]);
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = cells[idx];
      });
      records.push(row);
    }
    return records;
  };

  const splitCSVLine = (line) => {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const downloadFile = (filename, content, type = "text/plain") => {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 200);
  };

  // ---------- UI helpers ----------
  const formatDate = (iso) => {
    if (!iso) return "â€”";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return escape(iso);
      return d.toLocaleDateString();
    } catch {
      return escape(iso);
    }
  };

  const statusBadge = (status) => {
    const map = {
      RFQ: "bg-amber-900/40 text-amber-200 border border-amber-800/80",
      Ordered: "bg-sky-900/40 text-sky-200 border border-sky-800/80",
      Delivered: "bg-emerald-900/40 text-emerald-200 border border-emerald-800/80",
      Delayed: "bg-rose-900/40 text-rose-200 border border-rose-800/80",
      Cancelled: "bg-slate-800 text-slate-300 border border-slate-700/80"
    };
    const cls = map[status] || map.Ordered;
    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs ${cls}">${escape(status)}</span>`;
  };

  const statCard = (label, value, extraClass = "") => `
    <article class="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-5 shadow">
      <p class="text-xs uppercase tracking-wide text-slate-400">${escape(label)}</p>
      <p class="mt-2 text-2xl font-semibold ${extraClass}">${escape(typeof value === "string" ? value : String(value))}</p>
    </article>
  `;

  function blueprintColorForIcon(icon, summary = blueprintSummary) {
    if (!summary?.byIconColor) return "#60A5FA";
    const entry = Object.keys(summary.byIconColor).find((key) => key.startsWith(`${icon}|`));
    if (!entry) return "#60A5FA";
    const parts = entry.split("|");
    return (parts[1] || "#60A5FA").trim();
  }

  function humanizeBlueprintTimestamp(ts) {
    if (!ts) return "Just updated";
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "Just updated";
      return `Updated ${d.toLocaleString()}`;
    } catch {
      return "Just updated";
    }
  }

  function addSupplierFromBlueprint(icon) {
    if (!blueprintSummary || !blueprintSummary.byIcon?.[icon]) {
      toast(`No blueprint data for "${icon}"`);
      return;
    }
    const qty = blueprintSummary.byIcon[icon];
    const color = blueprintColorForIcon(icon, blueprintSummary);
    const overlay = openModal();
    if (!overlay) return;
    const form = overlay.querySelector("[data-form]");
    if (!form) return;
    form.querySelector("[name=\"supplier\"]").value = "";
    form.querySelector("[name=\"material\"]").value = icon;
    form.querySelector("[name=\"qty\"]").value = qty;
    form.querySelector("[name=\"unitPrice\"]").value = "0";
    form.querySelector("[name=\"orderDate\"]").value = isoOrEmpty(new Date());
    form.querySelector("[name=\"deliveryDate\"]").value = "";
    form.querySelector("[name=\"status\"]").value = "RFQ";
    const poField = form.querySelector("[name=\"po\"]");
    if (poField) poField.value = `BP-${Date.now().toString(36).toUpperCase()}`;
    const notesField = form.querySelector("[name=\"notes\"]");
    if (notesField) notesField.value = color ? `From blueprint summary (${color})` : "From blueprint summary";
  }
  function toast(message) {
    if (!message) return;
    try {
      let host = document.querySelector("[data-suppliers-toast]");
      if (!host) {
        host = document.createElement("div");
        host.setAttribute("data-suppliers-toast", "true");
        host.style.cssText = "position:fixed;right:16px;bottom:16px;display:grid;gap:8px;z-index:300";
        document.body.appendChild(host);
      }
      const box = document.createElement("div");
      box.style.cssText = "background:#1F2937;color:#E5E7EB;border:1px solid rgba(255,255,255,.1);padding:10px 12px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:.3s";
      box.textContent = message;
      host.appendChild(box);
      setTimeout(() => { box.style.opacity = "0"; box.style.transform = "translateY(4px)"; }, 2200);
      setTimeout(() => box.remove(), 3000);
    } catch {
      console.info(message);
    }
  }
  // ---------- Event wiring ----------
  const $thead = el.querySelector("thead");
  const handleAddClick = () => openModal();
  const handleImportClick = () => $file.click();
  const handleFileChange = (event) => importCSV(event.target.files?.[0]);

  $thead.addEventListener("click", onSortClick);
  $tbody.addEventListener("click", onTableClick);
  $pager.addEventListener("click", onPagerClick);
  $search.addEventListener("input", onSearchInput);
  $status.addEventListener("change", onFilterChange);
  $pageSize.addEventListener("change", onFilterChange);
  $add.addEventListener("click", handleAddClick);
  $export.addEventListener("click", exportCSV);
  $import.addEventListener("click", handleImportClick);
  $file.addEventListener("change", handleFileChange);
  window.addEventListener("keydown", onShortcut);

  if (STORE_READY && typeof store.subscribe === "function") {
    unsubscribeStore = store.subscribe("suppliers:changed", (payload = {}) => {
      const list = payload?.suppliers ?? (store.getSuppliers ? store.getSuppliers() : []);
      rows = Array.isArray(list) ? list.map(normalizeRow) : [];
      saveLocal(rows);
      renderAll();
    });
    unsubscribeBlueprint = store.subscribe("blueprint:summary", (payload = {}) => {
      blueprintSummary = payload?.summary || (store.getBlueprintSummary ? store.getBlueprintSummary() : null);
      renderStats();
      renderBlueprintPanel();
    });
  }

  // ---------- Initial render ----------
  $status.value = state.status;
  $pageSize.value = String(state.pageSize);
  renderAll();

  return {
    destroy() {
      $thead.removeEventListener("click", onSortClick);
      $tbody.removeEventListener("click", onTableClick);
      $pager.removeEventListener("click", onPagerClick);
      $search.removeEventListener("input", onSearchInput);
      $status.removeEventListener("change", onFilterChange);
      $pageSize.removeEventListener("change", onFilterChange);
      $add.removeEventListener("click", handleAddClick);
      $export.removeEventListener("click", exportCSV);
      $import.removeEventListener("click", handleImportClick);
      $file.removeEventListener("change", handleFileChange);
      window.removeEventListener("keydown", onShortcut);
      document.removeEventListener("ui:sidebar:toggle", onAsideToggle);
      document.removeEventListener("ui:data:update", onBlueprintDataUpdate);
      if ($bpPanel) $bpPanel.removeEventListener("click", onBlueprintPanelClick);
      if (unsubscribeStore) try { unsubscribeStore(); } catch { /* ignore */ }
      if (unsubscribeBlueprint) try { unsubscribeBlueprint(); } catch { /* ignore */ }
    }
  };
}



