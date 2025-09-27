// /js/components/material-labor.js
// Material & Labor Breakdown — Dark Pro, inline edit, totals, donut, CSV import/export.
// Eventos que emite en cada cambio:
//   - ml:updated { materials, labor, summary }
//   - ml:export  { csv, summary }

export default function mount(el, props = {}) {
  ensureGlobalBackground(); // fondo consistente con todo el sistema

  // --------- Persistencia / estado ---------
  const LS_KEY = String(props.persistKey || "material_labor_v2");
  const toNum = (n) => (isFinite(+n) ? +n : 0);

  let state = {
    currency: props.currency || "USD",
    materials: Array.isArray(props.materials) ? props.materials.slice() : [],
    labor: Array.isArray(props.labor) ? props.labor.slice() : [],
    contractors: String(props.contractors || ""),
    allocation: String(props.allocation || ""),
    overheadPct: toNum(props.overheadPct ?? 10), // %
    profitPct:   toNum(props.profitPct   ?? 12), // %
    taxPct:      toNum(props.taxPct      ??  8), // %
  };

  // Cargar de localStorage (sobrescribe props si hay datos previos)
  try { Object.assign(state, JSON.parse(localStorage.getItem(LS_KEY) || "{}")); } catch {}

  // --------- Estilos (dark pro) ---------
  injectOnce("ml-css", `
    :root{
      --bg0:#0B0F14; --bg1:#0F1720;
      --panel:#16202B; --panelHi:#1D2A39; --panel2:#233242;
      --line:rgba(255,255,255,.10); --line2:rgba(255,255,255,.06);
      --txt:#E5E7EB; --muted:#9CA3AF; --brand:#3B82F6;
      --ok:#10B981; --warn:#F59E0B; --danger:#EF4444; --cyan:#22D3EE;
    }
    .ml-wrap{max-width: 1440px; margin-right:24px}
    .ml-card{background:linear-gradient(180deg,var(--panelHi),var(--panel));
             border:1px solid var(--line);border-radius:16px;padding:16px 18px;box-shadow:0 8px 30px rgba(0,0,0,.25)}
    .ml-toolbar{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:4px}
    .title{font-weight:900;color:#fff;letter-spacing:.2px}
    .subtitle{color:var(--muted)}
    .cta{display:flex;gap:10px;flex-wrap:wrap}
    .btn{border-radius:12px;padding:10px 14px;border:1px solid var(--line);color:#fff;background:var(--brand)}
    .btn:hover{filter:brightness(1.08)}
    .btn-ghost{border-radius:12px;padding:10px 14px;border:1px solid var(--line);color:#E5E7EB;background:var(--panel2)}
    .btn-ghost:hover{background:#2B3B4E}
    .total-pill{display:inline-flex;gap:8px;align-items:center;border:1px solid var(--line);background:var(--panel2);padding:8px 12px;border-radius:12px}
    .grid{display:grid;gap:16px}
    .grid-2{grid-template-columns:1fr 1fr}
    @media (max-width: 1100px){ .grid-2{grid-template-columns:1fr} }
    .muted{color:var(--muted)}
    /* Controles compactos */
    .ctrl{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
    .ctrl-left{display:grid;gap:8px}
    .ctrl-right{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;justify-content:flex-end}
    .f{display:grid;gap:6px}
    .lbl{font-size:12px;color:var(--muted)}
    .inp{background:var(--panel2);border:1px solid var(--line);color:#E5E7EB;border-radius:10px;padding:8px 10px;font-size:14px}
    .inp::placeholder{color:#94A3B8}
    .inp:focus{outline:2px solid #3B82F6;outline-offset:2px}
    .inp-num{width:120px;text-align:right}
    /* Tabla */
    .tbl{width:100%;border-collapse:separate;border-spacing:0}
    .th{font-weight:600;color:#A9B3C2;text-align:left;padding:12px;border-bottom:1px solid var(--line)}
    .td{padding:10px 12px;border-top:1px solid var(--line2)}
    .row{transition:background .15s ease}
    .row:hover{background:rgba(255,255,255,.035)}
    .actions{display:inline-flex;gap:8px}
    .ic{width:34px;height:34px;border-radius:10px;border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;background:var(--panel2);color:#E5E7EB}
    .ic:hover{background:#2A3A4F}
    .ic.danger:hover{box-shadow:inset 0 0 0 2px rgba(239,68,68,.25)}
    .ic.ok:hover{box-shadow:inset 0 0 0 2px rgba(16,185,129,.25)}
    /* Donut */
    .donut-wrap{display:flex;gap:20px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
    .legend{display:grid;gap:6px}
    .leg-item{display:flex;align-items:center;gap:8px}
    .dot{width:9px;height:9px;border-radius:50%}
    /* Empty */
    .empty{display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);padding:22px}
    /* Responsivo inputs de alta rápida */
    .quick td{background:linear-gradient(180deg,var(--panel2),var(--panel2));position:sticky;bottom:0}
  `);

  // --------- UI ---------
  el.innerHTML = `
    <section class="transition-all duration-200 px-4 md:px-8 pt-8 pb-6 text-[15px] text-[var(--txt)]" data-shell>
      <div class="ml-wrap">
        <!-- Header -->
        <div class="ml-toolbar">
          <div>
            <h1 class="title text-[32px] md:text-[40px]">Material & Labor Breakdown</h1>
            <div class="subtitle">Cost estimation and resource allocation.</div>
          </div>
          <div class="cta">
            <div class="total-pill" title="Grand total">
              ${icoMoney()} <strong data-role="grand">$ 0</strong>
            </div>
            <button class="btn-ghost" data-role="import">${icoUpload()} Import CSV</button>
            <button class="btn-ghost" data-role="export">${icoDownload()} Export CSV</button>
            <button class="btn" data-role="save">${icoSave()} Save</button>
          </div>
        </div>

        <!-- Controles -->
        <div class="ml-card ctrl">
          <div class="ctrl-left">
            <div class="cta">
              <button class="btn" data-role="add-mat">${icoPlus()} Add material</button>
              <button class="btn" data-role="add-lab">${icoPlus()} Add labor</button>
            </div>
            <div class="muted" style="font-size:12px">Shortcuts: <kbd>N</kbd> material, <kbd>L</kbd> labor, <kbd>E</kbd> export.</div>
          </div>
          <div class="ctrl-right">
            <label class="f"><span class="lbl">Overhead %</span>
              <input class="inp inp-num" type="number" step="0.1" min="0" data-role="overhead"/></label>
            <label class="f"><span class="lbl">Profit %</span>
              <input class="inp inp-num" type="number" step="0.1" min="0" data-role="profit"/></label>
            <label class="f"><span class="lbl">Tax %</span>
              <input class="inp inp-num" type="number" step="0.1" min="0" data-role="tax"/></label>
          </div>
        </div>

        <!-- Tablas + Notas + Summary -->
        <div class="grid grid-2" style="margin-top:16px">
          <!-- Materials -->
          <div class="ml-card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <h3 class="title text-[18px]">Materials</h3>
              <div class="subtitle">Total: <b data-role="mat-total">$ 0</b></div>
            </div>
            <div style="overflow:auto;margin-top:10px">
              <table class="tbl">
                <thead><tr>
                  <th class="th">Item</th>
                  <th class="th">Qty</th>
                  <th class="th">Unit cost</th>
                  <th class="th">Line total</th>
                  <th class="th" style="width:1%">Actions</th>
                </tr></thead>
                <tbody data-role="mat-body"></tbody>
                <tfoot class="quick">
                  <tr>
                    <td class="td"><input class="inp" placeholder="e.g., Steel beam" data-role="mat-name"/></td>
                    <td class="td"><input class="inp inp-num" type="number" step="0.01" min="0" value="1" data-role="mat-qty"/></td>
                    <td class="td"><input class="inp inp-num" type="number" step="0.01" min="0" value="0" data-role="mat-unit"/></td>
                    <td class="td subtitle" data-role="mat-new-total">$ 0</td>
                    <td class="td"><button class="ic ok" title="Add material" data-role="mat-add">${icoPlus()}</button></td>
                  </tr>
                </tfoot>
              </table>
              <div class="empty" data-role="mat-empty" style="display:none">${icoFolder()} <div class="muted">No materials yet.</div></div>
            </div>
          </div>

          <!-- Labor -->
          <div class="ml-card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <h3 class="title text-[18px]">Labor</h3>
              <div class="subtitle">Total: <b data-role="lab-total">$ 0</b></div>
            </div>
            <div style="overflow:auto;margin-top:10px">
              <table class="tbl">
                <thead><tr>
                  <th class="th">Role</th>
                  <th class="th">Hours</th>
                  <th class="th">Rate</th>
                  <th class="th">Line total</th>
                  <th class="th" style="width:1%">Actions</th>
                </tr></thead>
                <tbody data-role="lab-body"></tbody>
                <tfoot class="quick">
                  <tr>
                    <td class="td"><input class="inp" placeholder="e.g., Electrician" data-role="lab-role"/></td>
                    <td class="td"><input class="inp inp-num" type="number" step="0.01" min="0" value="1" data-role="lab-hours"/></td>
                    <td class="td"><input class="inp inp-num" type="number" step="0.01" min="0" value="0" data-role="lab-rate"/></td>
                    <td class="td subtitle" data-role="lab-new-total">$ 0</td>
                    <td class="td"><button class="ic ok" title="Add labor" data-role="lab-add">${icoPlus()}</button></td>
                  </tr>
                </tfoot>
              </table>
              <div class="empty" data-role="lab-empty" style="display:none">${icoFolder()} <div class="muted">No labor yet.</div></div>
            </div>
          </div>

          <!-- Notes -->
          <div class="ml-card">
            <h3 class="title text-[18px]">Contractors</h3>
            <textarea data-role="contractors" class="inp" rows="6" placeholder="List contractors, terms, contact info…"></textarea>
          </div>
          <div class="ml-card">
            <h3 class="title text-[18px]">Budget Allocation</h3>
            <textarea data-role="allocation" class="inp" rows="6" placeholder="Notes on budget allocation…"></textarea>
          </div>

          <!-- Summary -->
          <div class="ml-card" style="grid-column:1/-1">
            <h3 class="title text-[18px]">Summary</h3>
            <div class="grid" style="grid-template-columns:1fr auto;align-items:center">
              <div class="grid" style="grid-template-columns:repeat(6,minmax(120px,1fr));gap:12px">
                <div><div class="lbl">Materials</div><div class="title" data-role="s-mat">$ 0</div></div>
                <div><div class="lbl">Labor</div><div class="title" data-role="s-lab">$ 0</div></div>
                <div><div class="lbl">Subtotal</div><div class="title" data-role="s-sub">$ 0</div></div>
                <div><div class="lbl">Overhead</div><div class="title" data-role="s-oh">$ 0</div></div>
                <div><div class="lbl">Profit</div><div class="title" data-role="s-pr">$ 0</div></div>
                <div><div class="lbl">Tax</div><div class="title" data-role="s-tax">$ 0</div></div>
              </div>
              <div class="donut-wrap">
                <div data-role="donut"></div>
                <div class="legend">
                  <div class="leg-item"><span class="dot" style="background:#22D3EE"></span><span class="muted">Materials</span></div>
                  <div class="leg-item"><span class="dot" style="background:#86EFAC"></span><span class="muted">Labor</span></div>
                  <div class="leg-item"><span class="dot" style="background:#F59E0B"></span><span class="muted">Overhead</span></div>
                  <div class="leg-item"><span class="dot" style="background:#60A5FA"></span><span class="muted">Profit</span></div>
                  <div class="leg-item"><span class="dot" style="background:#FCA5A5"></span><span class="muted">Tax</span></div>
                </div>
              </div>
            </div>
          </div>
        </div><!-- grid-2 -->
      </div>
    </section>
    <input type="file" accept=".csv,text/csv" data-role="file" style="display:none"/>
  `;

  // --------- refs ---------
  const qs = (s) => el.querySelector(s);
  const shell = qs('[data-shell]'); // para margen dinámico vs aside

  const r = {
    grand: qs('[data-role="grand"]'),
    overhead: qs('[data-role="overhead"]'),
    profit:   qs('[data-role="profit"]'),
    tax:      qs('[data-role="tax"]'),
    // materials UI
    matBody:      qs('[data-role="mat-body"]'),
    matEmpty:     qs('[data-role="mat-empty"]'),
    matName:      qs('[data-role="mat-name"]'),
    matQty:       qs('[data-role="mat-qty"]'),
    matUnit:      qs('[data-role="mat-unit"]'),
    matNewTotal:  qs('[data-role="mat-new-total"]'),
    matAdd:       qs('[data-role="mat-add"]'),
    matTotal:     qs('[data-role="mat-total"]'),
    // labor UI
    labBody:      qs('[data-role="lab-body"]'),
    labEmpty:     qs('[data-role="lab-empty"]'),
    labRole:      qs('[data-role="lab-role"]'),
    labHours:     qs('[data-role="lab-hours"]'),
    labRate:      qs('[data-role="lab-rate"]'),
    labNewTotal:  qs('[data-role="lab-new-total"]'),
    labAdd:       qs('[data-role="lab-add"]'),
    labTotal:     qs('[data-role="lab-total"]'),
    // notes
    contractors:  qs('[data-role="contractors"]'),
    allocation:   qs('[data-role="allocation"]'),
    // summary
    sMat: qs('[data-role="s-mat"]'),
    sLab: qs('[data-role="s-lab"]'),
    sSub: qs('[data-role="s-sub"]'),
    sOh:  qs('[data-role="s-oh"]'),
    sPr:  qs('[data-role="s-pr"]'),
    sTax: qs('[data-role="s-tax"]'),
    donut: qs('[data-role="donut"]'),
    // toolbar
    btnAddMat: qs('[data-role="add-mat"]'),
    btnAddLab: qs('[data-role="add-lab"]'),
    btnExport: qs('[data-role="export"]'),
    btnImport: qs('[data-role="import"]'),
    btnSave:   qs('[data-role="save"]'),
    file:      qs('[data-role="file"]'),
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

  // --------- listeners ---------
  r.overhead.value = String(state.overheadPct);
  r.profit.value   = String(state.profitPct);
  r.tax.value      = String(state.taxPct);

  [r.overhead,r.profit,r.tax].forEach(inp=>{
    inp.addEventListener("input", ()=>{
      state.overheadPct = clampNum(r.overhead.value,0,999);
      state.profitPct   = clampNum(r.profit.value,0,999);
      state.taxPct      = clampNum(r.tax.value,0,999);
      save(); render();
    });
  });

  // Alta rápida Material
  [r.matQty, r.matUnit].forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const qty  = clampNum(r.matQty.value, 0, 1e9);
      const unit = clampNum(r.matUnit.value,0, 1e9);
      r.matNewTotal.textContent = fmtMoney(qty*unit);
    });
  });
  r.matAdd.addEventListener("click", ()=>{
    const name = (r.matName.value||"").trim();
    const qty  = clampNum(r.matQty.value, 0, 1e9);
    const unit = clampNum(r.matUnit.value,0, 1e9);
    if(!name) { toast("Enter a material name"); r.matName.focus(); return; }
    state.materials.push({ name, qty, unit });
    r.matName.value=""; r.matQty.value="1"; r.matUnit.value="0"; r.matNewTotal.textContent = fmtMoney(0);
    save(); render();
  });

  // Alta rápida Labor
  [r.labHours, r.labRate].forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const h  = clampNum(r.labHours.value, 0, 1e9);
      const rt = clampNum(r.labRate.value, 0, 1e9);
      r.labNewTotal.textContent = fmtMoney(h*rt);
    });
  });
  r.labAdd.addEventListener("click", ()=>{
    const role  = (r.labRole.value||"").trim();
    const hours = clampNum(r.labHours.value, 0, 1e9);
    const rate  = clampNum(r.labRate.value, 0, 1e9);
    if(!role) { toast("Enter a labor role"); r.labRole.focus(); return; }
    state.labor.push({ role, hours, rate });
    r.labRole.value=""; r.labHours.value="1"; r.labRate.value="0"; r.labNewTotal.textContent = fmtMoney(0);
    save(); render();
  });

  // Notas
  r.contractors.value = state.contractors;
  r.allocation.value  = state.allocation;
  r.contractors.addEventListener("input", (e)=>{ state.contractors = e.target.value; save(); });
  r.allocation.addEventListener("input",  (e)=>{ state.allocation  = e.target.value;  save(); });

  // Export CSV
  r.btnExport.addEventListener("click", ()=>{
    const csv = toCSV();
    const { summary } = calcSummary();
    download(`breakdown.csv`, csv, "text/csv");
    el.dispatchEvent(new CustomEvent("ml:export",{bubbles:true,detail:{csv, summary}}));
  });

  // Import CSV
  r.btnImport.addEventListener("click", ()=> r.file.click());
  r.file.addEventListener("change", ()=>{
    const f = r.file.files?.[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const txt = String(reader.result||"");
        const parsed = parseCSV(txt);
        if(parsed.materials || parsed.labor){
          state.materials = parsed.materials || [];
          state.labor = parsed.labor || [];
          save(); render();
          toast("CSV imported");
        } else { toast("CSV format not recognized","warn"); }
      } catch { toast("Failed to import CSV","warn"); }
      r.file.value = "";
    };
    reader.readAsText(f);
  });

  // Save
  r.btnSave.addEventListener("click", ()=>{ save(); toast("Saved"); });

  // Atajos
  const onKey = (e)=>{
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key.toLowerCase()==="n") r.matName.focus();
    if (e.key.toLowerCase()==="l") r.labRole.focus();
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase()==="e"){ e.preventDefault(); r.btnExport.click(); }
  };
  document.addEventListener("keydown", onKey);

  // --------- render + eventos ---------
  render();

  return {
    getState(){ return JSON.parse(JSON.stringify(state)); },
    setState(patch={}){ Object.assign(state, patch); save(); render(); },
    destroy(){
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("ui:sidebar:toggle", onAsideToggle);
    }
  };

  /* ================= helpers ================= */

  function render() {
    // tablas
    r.matBody.innerHTML = state.materials.map((m, i)=> matRow(m,i)).join("");
    r.labBody.innerHTML = state.labor.map((l, i)=> labRow(l,i)).join("");

    r.matEmpty.style.display = state.materials.length ? "none" : "flex";
    r.labEmpty.style.display = state.labor.length ? "none" : "flex";

    // listeners por fila
    // Materiales
    r.matBody.querySelectorAll("[data-i]").forEach(row=>{
      const i = +row.dataset.i;
      const q = (sel)=> row.querySelector(sel);
      q('[data-f="name"]').addEventListener("input", (e)=>{ state.materials[i].name = e.target.value; save(); updateLineTotals(row,"mat",i); });
      q('[data-f="qty"]').addEventListener("input",  (e)=>{ state.materials[i].qty  = clampNum(e.target.value,0,1e9); save(); updateLineTotals(row,"mat",i); });
      q('[data-f="unit"]').addEventListener("input", (e)=>{ state.materials[i].unit = clampNum(e.target.value,0,1e9); save(); updateLineTotals(row,"mat",i); });
      q('[data-dup]').addEventListener("click", ()=>{ state.materials.splice(i+1,0, {...state.materials[i]}); save(); render(); });
      q('[data-del]').addEventListener("click", ()=>{ state.materials.splice(i,1); save(); render(); });
    });

    // Labor
    r.labBody.querySelectorAll("[data-i]").forEach(row=>{
      const i = +row.dataset.i;
      const q = (sel)=> row.querySelector(sel);
      q('[data-f="role"]').addEventListener("input", (e)=>{ state.labor[i].role = e.target.value; save(); updateLineTotals(row,"lab",i); });
      q('[data-f="hours"]').addEventListener("input",(e)=>{ state.labor[i].hours = clampNum(e.target.value,0,1e9); save(); updateLineTotals(row,"lab",i); });
      q('[data-f="rate"]').addEventListener("input", (e)=>{ state.labor[i].rate  = clampNum(e.target.value,0,1e9); save(); updateLineTotals(row,"lab",i); });
      q('[data-dup]').addEventListener("click", ()=>{ state.labor.splice(i+1,0, {...state.labor[i]}); save(); render(); });
      q('[data-del]').addEventListener("click", ()=>{ state.labor.splice(i,1); save(); render(); });
    });

    // resumen
    const { mat, lab, summary } = calcSummary();
    r.matTotal.textContent = fmtMoney(mat);
    r.labTotal.textContent = fmtMoney(lab);

    r.sMat.textContent = fmtMoney(summary.materials);
    r.sLab.textContent = fmtMoney(summary.labor);
    r.sSub.textContent = fmtMoney(summary.subtotal);
    r.sOh.textContent  = fmtMoney(summary.overhead);
    r.sPr.textContent  = fmtMoney(summary.profit);
    r.sTax.textContent = fmtMoney(summary.tax);
    r.grand.textContent= fmtMoney(summary.total);

    r.donut.innerHTML = donut([
      { v: summary.materials, color:"#22D3EE" },
      { v: summary.labor,     color:"#86EFAC" },
      { v: summary.overhead,  color:"#F59E0B" },
      { v: summary.profit,    color:"#60A5FA" },
      { v: summary.tax,       color:"#FCA5A5" },
    ]);

    // notificar a la app para correlación con el resto
    el.dispatchEvent(new CustomEvent("ml:updated", {
      bubbles:true,
      detail: { materials:state.materials.slice(), labor:state.labor.slice(), summary }
    }));
  }

  function updateLineTotals(row, kind, idx){
    if(kind==="mat"){
      const it = state.materials[idx] || {qty:0,unit:0};
      row.querySelector('[data-total]').textContent = fmtMoney(it.qty * it.unit);
    } else {
      const it = state.labor[idx] || {hours:0,rate:0};
      row.querySelector('[data-total]').textContent = fmtMoney(it.hours * it.rate);
    }
    save(); render(); // refrescar sumarios y donut
  }

  function matRow(m, i){
    const t = m.qty * m.unit;
    return `
      <tr class="row" data-i="${i}">
        <td class="td"><input class="inp" data-f="name" value="${escAttr(m.name||"")}" placeholder="Item"/></td>
        <td class="td"><input class="inp inp-num" type="number" step="0.01" min="0" data-f="qty"  value="${escAttr(m.qty ?? 0)}"/></td>
        <td class="td"><input class="inp inp-num" type="number" step="0.01" min="0" data-f="unit" value="${escAttr(m.unit ?? 0)}"/></td>
        <td class="td" data-total>${fmtMoney(t)}</td>
        <td class="td">
          <div class="actions">
            <button class="ic" title="Duplicate" data-dup>${icoCopy()}</button>
            <button class="ic danger" title="Remove" data-del>${icoTrash()}</button>
          </div>
        </td>
      </tr>
    `;
  }

  function labRow(l, i){
    const t = l.hours * l.rate;
    return `
      <tr class="row" data-i="${i}">
        <td class="td"><input class="inp" data-f="role" value="${escAttr(l.role||"")}" placeholder="Role"/></td>
        <td class="td"><input class="inp inp-num" type="number" step="0.01" min="0" data-f="hours" value="${escAttr(l.hours ?? 0)}"/></td>
        <td class="td"><input class="inp inp-num" type="number" step="0.01" min="0" data-f="rate"  value="${escAttr(l.rate ?? 0)}"/></td>
        <td class="td" data-total>${fmtMoney(t)}</td>
        <td class="td">
          <div class="actions">
            <button class="ic" title="Duplicate" data-dup>${icoCopy()}</button>
            <button class="ic danger" title="Remove" data-del>${icoTrash()}</button>
          </div>
        </td>
      </tr>
    `;
  }

  function calcSummary(){
    const mat = state.materials.reduce((s,x)=> s + toNum(x.qty)*toNum(x.unit), 0);
    const lab = state.labor.reduce((s,x)=> s + toNum(x.hours)*toNum(x.rate), 0);
    const subtotal = mat + lab;
    const overhead = subtotal * (toNum(state.overheadPct)/100);
    const profit   = (subtotal + overhead) * (toNum(state.profitPct)/100);
    const tax      = (subtotal + overhead + profit) * (toNum(state.taxPct)/100);
    const total    = subtotal + overhead + profit + tax;
    return {
      mat, lab,
      summary: { materials:mat, labor:lab, subtotal, overhead, profit, tax, total }
    };
  }

  function donut(parts){
    const w=170,h=170,cx=w/2,cy=h/2,r=60,stroke=16;
    const sum = parts.reduce((s,p)=>s+(p.v>0?p.v:0),0) || 1;
    let acc = 0;
    const segs = parts.map(p=>{
      const pct = Math.max(0,(p.v||0)/sum);
      const dash = Math.max(.001, pct)*100;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="transparent" stroke="${p.color}"
                     stroke-width="${stroke}" stroke-dasharray="${dash} ${100-dash}"
                     stroke-dashoffset="${-acc}"></circle>`;
      acc += dash;
      return seg;
    }).join("");
    return `
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="transparent" stroke="rgba(255,255,255,.06)" stroke-width="${stroke}"></circle>
        ${segs}
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#E5E7EB" font-size="13" font-weight="800">${fmtMoney(calcSummary().summary.total)}</text>
      </svg>
    `;
  }

  function toCSV(){
    const lines = [];
    lines.push("MATERIALS");
    lines.push("name,qty,unit,line_total");
    state.materials.forEach(m=> lines.push(csv([m.name, m.qty, m.unit, toNum(m.qty)*toNum(m.unit)])));
    lines.push("");
    lines.push("LABOR");
    lines.push("role,hours,rate,line_total");
    state.labor.forEach(l=> lines.push(csv([l.role, l.hours, l.rate, toNum(l.hours)*toNum(l.rate)])));
    lines.push("");
    const { summary } = calcSummary();
    lines.push(csv(["overheadPct", state.overheadPct]));
    lines.push(csv(["profitPct", state.profitPct]));
    lines.push(csv(["taxPct", state.taxPct]));
    lines.push(csv(["TOTAL", summary.total]));
    lines.push("");
    lines.push("CONTRACTORS"); lines.push(safeText(state.contractors));
    lines.push("");
    lines.push("ALLOCATION");  lines.push(safeText(state.allocation));
    return lines.join("\n");
  }

  function parseCSV(txt){
    // Secciones MATERIALS / LABOR + headers simples
    const rows = txt.split(/\r?\n/);
    let mode = "none";
    const materials = [], labor = [];
    for (let raw of rows){
      const line = raw.trim();
      if (!line) continue;
      const up = line.toUpperCase();
      if (up==="MATERIALS"){ mode="mat"; continue; }
      if (up==="LABOR"){ mode="lab"; continue; }
      if (line.startsWith("name,") || line.startsWith("role,")) continue;
      if (up.startsWith("CONTRACTORS")) { mode="contractors"; continue; }
      if (up.startsWith("ALLOCATION"))  { mode="allocation";  continue; }
      if (line.includes("overheadPct")||line.includes("profitPct")||line.includes("taxPct")) {
        const [k,v] = line.split(","); if(k&&v) state[k]=toNum(v); continue;
      }
      if (mode==="mat"){
        const [name,qty,unit] = splitCSV(line);
        if(name) materials.push({ name, qty:toNum(qty), unit:toNum(unit) });
      } else if (mode==="lab"){
        const [role,hours,rate] = splitCSV(line);
        if(role) labor.push({ role, hours:toNum(hours), rate:toNum(rate) });
      } else if (mode==="contractors"){
        state.contractors += (state.contractors? "\n":"") + line;
      } else if (mode==="allocation"){
        state.allocation += (state.allocation? "\n":"") + line;
      }
    }
    return { materials, labor };
  }

  function save(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }

  // --------- utilidades ---------
  function fmtMoney(n){
    try{
      return new Intl.NumberFormat("en-US", { style:"currency", currency: state.currency||"USD", maximumFractionDigits: 2 }).format(+n||0);
    }catch{ return `$ ${Number(n||0).toLocaleString("en-US",{maximumFractionDigits:2})}`; }
  }
  function csv(arr){ return arr.map(s=> `"${String(s).replaceAll('"','""')}"`).join(","); }
  function splitCSV(line){ return line.split(",").map(x=>x.replace(/^"|"$/g,"")); }
  function safeText(s){ return String(s||"").replaceAll(/\r?\n/g, " "); }
  function download(name, content, type="text/plain"){
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content],{type}));
    a.download = name; a.click();
    setTimeout(()=> URL.revokeObjectURL(a.href), 300);
  }
  function clampNum(v,min,max){ const n = Number(v); if(!isFinite(n)) return min; return Math.max(min, Math.min(max, n)); }
  function esc(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }
  function escAttr(s){ return esc(String(s)).replaceAll('"',"&quot;"); }

  function toast(msg){
    if (!document.querySelector("[data-ml-toast]")){
      const host = document.createElement("div");
      host.setAttribute("data-ml-toast","");
      host.style.cssText = "position:fixed;right:16px;bottom:16px;display:grid;gap:8px;z-index:200";
      document.body.appendChild(host);
    }
    const box = document.querySelector("[data-ml-toast]");
    const n = document.createElement("div");
    n.style.cssText = "background:#1F2937;color:#E5E7EB;border:1px solid var(--line);padding:10px 12px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:.3s";
    n.textContent = msg; box.appendChild(n);
    setTimeout(()=>{ n.style.opacity="0"; n.style.transform="translateY(-6px)"; }, 2200);
    setTimeout(()=> n.remove(), 3000);
  }

  // Icons
  function icoPlus(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2z"/></svg>`}
  function icoTrash(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 7h12v2H6z"/><path d="M8 9h8v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V9z"/><path d="M9 4h6v2H9z"/></svg>`}
  function icoCopy(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>`}
  function icoSave(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5a2 2 0 0 0-2 2v14l4-4h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg>`}
  function icoDownload(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2zM12 2v12l4-4 1.41 1.41L12 17.83l-5.41-5.42L8 10l4 4V2z"/></svg>`}
  function icoUpload(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2z"/><path d="M12 2l5 5-1.41 1.41L13 6.83V16h-2V6.83L8.41 8.41 7 7l5-5z"/></svg>`}
  function icoMoney(){return `<svg width="18" height="18" viewBox="0 0 24 24" fill="#86EFAC"><path d="M12 1a1 1 0 011 1v1.06A7 7 0 1112 20a1 1 0 010-2 5 5 0 100-10 1 1 0 110-2 7 7 0 010 14V22a1 1 0 11-2 0v-1.06A7 7 0 1112 1z"/></svg>`}
  function icoFolder(){return `<svg width="20" height="20" viewBox="0 0 24 24" fill="#94A3B8"><path d="M10 4l2 2h8a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h5z"/></svg>`}
}

/* ---------- helpers globales ---------- */
function ensureGlobalBackground(){
  injectOnce("ml-global-bg", `body{background:radial-gradient(1400px 700px at 20% -10%, #0F1720 0%, #0B0F14 60%, #0B0F14 100%); color:#E5E7EB}`);
}
function injectOnce(id, css){
  if (document.getElementById(id)) return;
  const st = document.createElement("style"); st.id=id; st.textContent=css; document.head.appendChild(st);
}
