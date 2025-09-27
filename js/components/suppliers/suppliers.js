// /components/suppliers/suppliers.js
// Modo oscuro, 100% Vanilla + Tailwind. Intuitivo, completo y persistente.

export default function mount(el, props = {}) {
  /* ---------- Estado + persistencia ---------- */
  const LS_KEY = "suppliers_v1";
  let rows = [];

  try {
    const persisted = JSON.parse(localStorage.getItem(LS_KEY));
    rows = Array.isArray(persisted) ? persisted : [];
  } catch { rows = []; }

  // seed inicial desde props.rows (si no había nada)
  if (!rows.length && Array.isArray(props.rows)) {
    rows = props.rows.map(migrateRow);
    save();
  } else {
    rows = rows.map(migrateRow);
    save();
  }

  const state = {
    search: "",
    status: "all",
    sortKey: "orderDate",
    sortDir: "desc",
    page: 1,
    pageSize: 10,
  };

  /* ---------- Render raíz ---------- */
  el.innerHTML = `
    <div class="px-6 md:px-10 py-8 md:ml-72 text-slate-100">
      <h1 class="text-5xl md:text-6xl font-black tracking-tight">SUPPLIERS</h1>
      <p class="mt-2 text-lg text-slate-400">Manage Relationships with Suppliers for Each Project.</p>

      <!-- Stats -->
      <div class="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-role="stats"></div>

      <!-- Toolbar -->
      <div class="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div class="flex items-center gap-2">
          <div class="relative">
            <input data-search type="search" placeholder="Search supplier, material, PO, contact…"
              class="w-80 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 pr-10 placeholder-slate-500 text-slate-100 outline-none"
            />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">⌘K</span>
          </div>

          <select data-filter-status class="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100">
            <option value="all">All status</option>
            <option value="RFQ">RFQ</option>
            <option value="Ordered">Ordered</option>
            <option value="Delivered">Delivered</option>
            <option value="Delayed">Delayed</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <select data-pagesize class="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100">
            <option value="10">10 / page</option>
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <button data-import class="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 hover:bg-slate-800">Import CSV</button>
          <button data-export class="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 hover:bg-slate-800">Export CSV</button>
          <button data-add class="inline-flex items-center gap-2 rounded-xl px-3 py-2 border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500">
            <span class="text-xl">＋</span> Add Supplier
          </button>
          <input data-file type="file" accept=".csv" class="hidden" />
        </div>
      </div>

      <!-- Tabla -->
      <div class="mt-4 overflow-x-auto">
        <table class="min-w-full">
          <thead>
            <tr class="text-left text-slate-300 border-b border-slate-700">
              ${[
                ["supplier","Supplier"],
                ["material","Material"],
                ["qty","Qty"],
                ["unitPrice","Unit Price"],
                ["total","Total"],
                ["orderDate","Order Date"],
                ["deliveryDate","ETA"],
                ["status","Status"],
                ["contact","Contact"],
                ["actions",""]
              ].map(([key,label]) => thCell(key,label)).join("")}
            </tr>
          </thead>
          <tbody data-tbody class="divide-y divide-slate-800"></tbody>
        </table>
      </div>

      <!-- Paginación -->
      <div class="mt-4 flex items-center justify-between text-slate-400" data-role="pager"></div>
    </div>
  `;

  /* ---------- Elementos ---------- */
  const $tbody = el.querySelector("[data-tbody]");
  const $stats = el.querySelector("[data-role='stats']");
  const $pager = el.querySelector("[data-role='pager']");
  const $search = el.querySelector("[data-search]");
  const $status = el.querySelector("[data-filter-status]");
  const $pageSize = el.querySelector("[data-pagesize]");
  const $add = el.querySelector("[data-add]");
  const $export = el.querySelector("[data-export]");
  const $import = el.querySelector("[data-import]");
  const $file = el.querySelector("[data-file]");

  /* ---------- Eventos raíz ---------- */
  el.addEventListener("click", onClick);
  el.addEventListener("change", onChange);

  $search.addEventListener("input", () => { state.search = $search.value.trim(); state.page = 1; renderTable(); });
  $status.value = state.status;
  $pageSize.value = String(state.pageSize);

  // Export/Import
  $export.addEventListener("click", doExportCSV);
  $import.addEventListener("click", () => $file.click());
  $file.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCSV(text).map(migrateRow);
    if (!Array.isArray(parsed) || !parsed.length) return;
    rows = rows.concat(parsed).map(migrateRow);
    save(); renderAll();
    e.target.value = "";
  });

  // Botón agregar
  $add.addEventListener("click", () => openFormModal());

  // ⌘/Ctrl + K → foco búsqueda
  window.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
      ev.preventDefault(); $search.focus();
    }
  });

  /* ---------- Primer render ---------- */
  renderAll();

  /* ---------- API pública ---------- */
  return {
    destroy() {
      el.removeEventListener("click", onClick);
      el.removeEventListener("change", onChange);
      window.removeEventListener("keydown", () => {});
    }
  };

  /* ==========================================================
     Render helpers
  ========================================================== */
  function renderAll() {
    renderStats();
    renderTable();
  }

  function renderStats() {
    const totals = computeTotals(rows);
    $stats.innerHTML = `
      ${statCard("Committed", currency(totals.totalCommitted))}
      ${statCard("Orders", String(rows.length))}
      ${statCard("Open POs", String(totals.open))}
      ${statCard("Delayed", String(totals.delayed), totals.delayed ? "text-rose-400" : "text-slate-300")}
    `;
  }

  function renderTable() {
    // 1) filtrar
    let arr = rows.slice();
    if (state.search) {
      const q = state.search.toLowerCase();
      arr = arr.filter(r =>
        (r.supplier||"").toLowerCase().includes(q) ||
        (r.material||"").toLowerCase().includes(q) ||
        (r.po||"").toLowerCase().includes(q) ||
        (r.contact||"").toLowerCase().includes(q) ||
        (r.status||"").toLowerCase().includes(q)
      );
    }
    if (state.status !== "all") {
      arr = arr.filter(r => r.status === state.status);
    }

    // 2) ordenar
    const dir = state.sortDir === "asc" ? 1 : -1;
    arr.sort((a,b) => {
      const key = state.sortKey;
      let va = key === "total" ? totalOf(a) : a[key];
      let vb = key === "total" ? totalOf(b) : b[key];
      if (key === "orderDate" || key === "deliveryDate") {
        return ((toDate(va)?.getTime()||0) - (toDate(vb)?.getTime()||0)) * dir;
      }
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va||"").localeCompare(String(vb||"")) * dir;
    });

    // 3) paginar
    const pageSize = state.pageSize;
    const maxPage = Math.max(1, Math.ceil(arr.length / pageSize));
    state.page = Math.min(state.page, maxPage);
    const start = (state.page - 1) * pageSize;
    const view = arr.slice(start, start + pageSize);

    // 4) render filas
    $tbody.innerHTML = view.map(rowToTr).join("") || `
      <tr><td colspan="10" class="py-6 text-slate-400">No suppliers yet.</td></tr>
    `;

    // 5) render paginador
    $pager.innerHTML = `
      <div class="text-sm">
        Showing <b class="text-slate-200">${arr.length ? start + 1 : 0}</b>–<b class="text-slate-200">${Math.min(start + view.length, arr.length)}</b> of <b class="text-slate-200">${arr.length}</b>
      </div>
      <div class="flex items-center gap-2">
        <button data-pg="prev" class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 ${state.page<=1?"opacity-40 cursor-not-allowed":""}">Prev</button>
        <span class="min-w-[4rem] text-center">Page ${state.page} / ${maxPage}</span>
        <button data-pg="next" class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 ${state.page>=maxPage?"opacity-40 cursor-not-allowed":""}">Next</button>
      </div>
    `;

    // indicador de orden en TH
    el.querySelectorAll("th[data-sort]").forEach(th => {
      th.querySelector("[data-arrow]").textContent =
        th.dataset.sort === state.sortKey ? (state.sortDir === "asc" ? "▲" : "▼") : "–";
    });
  }

  function rowToTr(r) {
    const badge = statusBadge(r.status);
    const rowClass =
      r.status === "Delayed" ? "bg-rose-900/20" :
      r.status === "Delivered" ? "bg-emerald-900/10" : "";
    return `
      <tr class="${rowClass}">
        <td class="py-3 pr-4 align-top">
          <div class="font-semibold text-slate-100">${escapeHTML(r.supplier||"—")}</div>
          ${r.po ? `<div class="text-xs text-slate-400">PO: ${escapeHTML(r.po)}</div>` : ""}
        </td>
        <td class="py-3 pr-4 align-top">
          <div class="text-slate-200">${escapeHTML(r.material||"—")}</div>
          ${r.notes ? `<div class="text-xs text-slate-400 line-clamp-2">${escapeHTML(r.notes)}</div>` : ""}
        </td>
        <td class="py-3 pr-4 align-top text-slate-200">${num(r.qty)}</td>
        <td class="py-3 pr-4 align-top text-slate-200">${currency(r.unitPrice)}</td>
        <td class="py-3 pr-4 align-top font-semibold text-slate-100">${currency(totalOf(r))}</td>
        <td class="py-3 pr-4 align-top text-slate-300">${fmtDate(r.orderDate)}</td>
        <td class="py-3 pr-4 align-top text-slate-300">${fmtDate(r.deliveryDate)}</td>
        <td class="py-3 pr-4 align-top">${badge}</td>
        <td class="py-3 pr-4 align-top whitespace-pre-line text-slate-300">${escapeHTML(r.contact||"")}</td>
        <td class="py-3 pr-2 align-top">
          <div class="flex gap-3 text-sm">
            ${r.status!=="Delivered" ? `<button class="text-emerald-400 hover:underline" data-markdone="${r.id}">Mark delivered</button>` : ""}
            <button class="text-sky-300 hover:underline" data-edit="${r.id}">Edit</button>
            <button class="text-rose-400 hover:underline" data-del="${r.id}">Remove</button>
          </div>
        </td>
      </tr>
    `;
  }

  /* ==========================================================
     Eventos
  ========================================================== */
  function onClick(e) {
    const t = e.target;

    if (t.closest("th[data-sort]")) {
      const th = t.closest("th[data-sort]");
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = "asc"; }
      renderTable();
      return;
    }

    if (t.dataset.pg === "prev") { if (state.page > 1) { state.page--; renderTable(); } return; }
    if (t.dataset.pg === "next") { state.page++; renderTable(); return; }

    if (t.dataset.edit) {
      const row = rows.find(r => r.id === t.dataset.edit);
      if (row) openFormModal(row);
      return;
    }

    if (t.dataset.del) {
      const id = t.dataset.del;
      const idx = rows.findIndex(r => r.id === id);
      if (idx >= 0 && confirm("Remove this supplier entry?")) {
        rows.splice(idx,1); save(); renderAll();
      }
      return;
    }

    if (t.dataset.markdone) {
      const row = rows.find(r => r.id === t.dataset.markdone);
      if (row) { row.status = "Delivered"; save(); renderAll(); }
      return;
    }
  }

  function onChange(e) {
    if (e.target === $status) { state.status = $status.value; state.page = 1; renderTable(); }
    if (e.target === $pageSize) { state.pageSize = Number($pageSize.value)||10; state.page = 1; renderTable(); }
  }

  /* ==========================================================
     Form modal (oscuro)
  ========================================================== */
  function openFormModal(row) {
    const isEdit = !!row;
    const model = row ? {...row} : {
      id: uid(),
      supplier: "",
      material: "",
      qty: 1,
      unitPrice: 0,
      orderDate: todayISO(),
      deliveryDate: todayISO(),
      status: "Ordered",
      contact: "",
      po: "",
      notes: ""
    };

    const $overlay = document.createElement("div");
    $overlay.className = "fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4";
    $overlay.innerHTML = `
      <div class="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 p-6 text-slate-100">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold">${isEdit ? "Edit supplier" : "Add supplier"}</h3>
          <button data-x class="text-lg text-slate-400 hover:text-slate-200">✕</button>
        </div>

        <form data-form class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          ${input("Supplier","supplier",model.supplier)}
          ${input("Material","material",model.material)}
          ${input("Quantity","qty",model.qty,"number","min='0' step='1'")}
          ${input("Unit Price","unitPrice",model.unitPrice,"number","min='0' step='0.01'")}
          ${input("Order Date","orderDate",model.orderDate,"date")}
          ${input("Delivery Date (ETA)","deliveryDate",model.deliveryDate,"date")}
          ${selectStatus(model.status)}
          ${input("PO #","po",model.po)}
          <div class="md:col-span-2">
            <label class="text-sm text-slate-400">Contact</label>
            <textarea name="contact" class="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100" rows="2" placeholder="Name / phone / email">${escapeHTML(model.contact)}</textarea>
          </div>
          <div class="md:col-span-2">
            <label class="text-sm text-slate-400">Notes</label>
            <textarea name="notes" class="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100" rows="3" placeholder="Extra details, delivery conditions, etc.">${escapeHTML(model.notes)}</textarea>
          </div>
          <div class="md:col-span-2 flex items-center justify-between mt-2">
            <div class="text-sm text-slate-300">Total: <b class="text-slate-100">${currency(totalOf(model))}</b></div>
            <div class="flex gap-2">
              ${isEdit ? `<button data-delrow="${model.id}" type="button" class="rounded-xl border border-rose-600 bg-transparent px-3 py-2 text-rose-400 hover:bg-rose-950/30">Remove</button>` : ""}
              <button data-x type="button" class="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200 hover:bg-slate-800">Cancel</button>
              <button type="submit" class="rounded-xl bg-indigo-600 text-white px-4 py-2 hover:bg-indigo-500">${isEdit ? "Save" : "Add"}</button>
            </div>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild($overlay);

    // Eventos modal
    $overlay.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", () => $overlay.remove()));
    const $form = $overlay.querySelector("[data-form]");
    const $delRow = $overlay.querySelector(`[data-delrow]`);

    $form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const fd = new FormData($form);
      const updated = {
        ...model,
        supplier: (fd.get("supplier")||"").toString().trim(),
        material: (fd.get("material")||"").toString().trim(),
        qty: Number(fd.get("qty")||0),
        unitPrice: Number(fd.get("unitPrice")||0),
        orderDate: (fd.get("orderDate")||"").toString(),
        deliveryDate: (fd.get("deliveryDate")||"").toString(),
        status: (fd.get("status")||"Ordered").toString(),
        contact: (fd.get("contact")||"").toString(),
        po: (fd.get("po")||"").toString(),
        notes: (fd.get("notes")||"").toString(),
      };

      if (!updated.supplier) { alert("Supplier is required"); return; }
      if (!updated.material) { alert("Material is required"); return; }

      if (isEdit) {
        const idx = rows.findIndex(r => r.id === model.id);
        if (idx >= 0) rows[idx] = updated;
      } else {
        rows.push(updated);
      }
      save(); renderAll(); $overlay.remove();
    });

    if ($delRow) {
      $delRow.addEventListener("click", () => {
        if (confirm("Remove this supplier entry?")) {
          const idx = rows.findIndex(r => r.id === model.id);
          if (idx >= 0) rows.splice(idx,1);
          save(); renderAll(); $overlay.remove();
        }
      });
    }
  }

  /* ==========================================================
     Utils
  ========================================================== */
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(rows)); }

  function migrateRow(r = {}) {
    // Acepta esquema viejo {supplier, material, cost, orderDate, deliveryDate, contact}
    const qty = Number(r.qty ?? 1) || 1;
    const unitPrice = Number(
      r.unitPrice ?? (typeof r.cost === "number" ? (qty ? r.cost/qty : r.cost) : 0)
    ) || 0;
    return {
      id: r.id || uid(),
      supplier: r.supplier || "",
      material: r.material || "",
      qty,
      unitPrice,
      orderDate: isoOrEmpty(r.orderDate),
      deliveryDate: isoOrEmpty(r.deliveryDate),
      status: oneOf(r.status, ["RFQ","Ordered","Delivered","Delayed","Cancelled"]) || "Ordered",
      contact: r.contact || "",
      po: r.po || "",
      notes: r.notes || ""
    };
  }

  function statCard(label, value, extraClass="") {
    return `
      <div class="rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <div class="text-sm text-slate-400">${escapeHTML(label)}</div>
        <div class="mt-1 text-2xl font-semibold ${extraClass}">${escapeHTML(value)}</div>
      </div>
    `;
  }

  function thCell(key,label) {
    if (key === "actions") return `<th class="py-3 pr-2 font-medium"></th>`;
    return `
      <th class="py-3 pr-4 font-medium select-none cursor-pointer" data-sort="${key}">
        <span>${escapeHTML(label)}</span>
        <span data-arrow class="ml-1 text-xs text-slate-500">–</span>
      </th>
    `;
  }

  function statusBadge(s) {
    const map = {
      RFQ:      "bg-amber-900/30 text-amber-300 ring-1 ring-amber-700/40",
      Ordered:  "bg-sky-900/30 text-sky-300 ring-1 ring-sky-700/40",
      Delivered:"bg-emerald-900/30 text-emerald-300 ring-1 ring-emerald-700/40",
      Delayed:  "bg-rose-900/30 text-rose-300 ring-1 ring-rose-700/40",
      Cancelled:"bg-slate-800 text-slate-300 ring-1 ring-slate-600/50",
    };
    const cls = map[s] || "bg-slate-800 text-slate-300 ring-1 ring-slate-600/50";
    return `<span class="px-2 py-1 rounded-full text-xs ${cls}">${escapeHTML(s||"—")}</span>`;
  }

  function computeTotals(arr) {
    const today = new Date();
    let totalCommitted = 0, open = 0, delayed = 0;
    for (const r of arr) {
      totalCommitted += totalOf(r);
      if (r.status !== "Delivered" && r.status !== "Cancelled") open++;
      if (r.status !== "Delivered" && r.deliveryDate && toDate(r.deliveryDate) < today) delayed++;
    }
    return { totalCommitted, open, delayed };
  }

  function totalOf(r) { return (Number(r.qty)||0) * (Number(r.unitPrice)||0); }

  function currency(n=0) { try { return new Intl.NumberFormat("en-US",{style:"currency", currency:"USD"}).format(Number(n)||0); } catch { return `$ ${Number(n||0).toLocaleString()}`; } }
  function num(n=0) { return Number(n||0).toLocaleString(); }
  function fmtDate(iso) { if (!iso) return "—"; const d = toDate(iso); if (!d) return escapeHTML(String(iso)); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }
  function toDate(iso) { const d = new Date(iso); return isNaN(d) ? null : d; }
  function todayISO() { return new Date().toISOString().slice(0,10); }
  function isoOrEmpty(v){ if (!v) return ""; const d = toDate(v); return d ? d.toISOString().slice(0,10) : String(v); }
  function oneOf(v, arr){ return arr.includes(v) ? v : null; }
  function uid(){ return Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4); }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#39;");
  }

  function input(label,name,value,type="text",extra="") {
    return `
      <div>
        <label class="text-sm text-slate-400">${escapeHTML(label)}</label>
        <input
          name="${escapeHTML(name)}"
          type="${escapeHTML(type)}"
          value="${type==="date" ? escapeHTML(value||"") : escapeHTML(String(value??""))}"
          class="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          ${extra||""}
        />
      </div>
    `;
  }

  function selectStatus(value="Ordered") {
    const opts = ["RFQ","Ordered","Delivered","Delayed","Cancelled"]
      .map(v => `<option value="${v}" ${v===value?"selected":""}>${v}</option>`).join("");
    return `
      <div>
        <label class="text-sm text-slate-400">Status</label>
        <select name="status" class="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100">${opts}</select>
      </div>
    `;
  }

  /* ---------- CSV helpers ---------- */
  function doExportCSV() {
    const headers = ["supplier","material","qty","unitPrice","orderDate","deliveryDate","status","contact","po","notes"];
    const lines = [headers.join(",")].concat(
      rows.map(r => headers.map(h => csvEscape(r[h])).join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `suppliers_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function parseCSV(text) {
    const out = [];
    const lines = text.replace(/\r/g,"").split("\n").filter(Boolean);
    if (!lines.length) return out;
    const headers = splitCSVLine(lines[0]);
    for (let i=1;i<lines.length;i++) {
      const cells = splitCSVLine(lines[i]);
      const row = {};
      headers.forEach((h,idx) => row[h] = cells[idx]);
      out.push(row);
    }
    return out;
  }

  function splitCSVLine(line) {
    const res = [];
    let cur = "", inQ = false;
    for (let i=0;i<line.length;i++) {
      const ch = line[i];
      if (ch === '"' ) {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        res.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    res.push(cur);
    return res;
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
    return s;
  }
}
