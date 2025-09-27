// /components/blueprint-analyzer/blueprint-analyzer.js
// v5.0 — Left Column Editor + Responsive Viewer upgrades
// Base: v4.0 (Dark UI + detector robusto CUADRADOS)
// Nuevos: Editor de columnas (tipo/nota/ID) + anotación auto; layout responsive + auto-fit inteligente.

export default async function mount(el, props = {}) {
  /* =========================
     CONFIG + ESTADO GLOBAL
  ========================= */
  const PDFJS_URL = window.PDFJS_URL || "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
  const WORKER_URL = window.WORKER_URL || "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const JSPDF_URL = window.JSPDF_URL || "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
  const LS_KEY = window.LS_KEY || "bp_projects_v2";

  const ASIDE_EL = document.querySelector("[data-aside]") || null;
  const BASE_RENDER_SCALE = 1;
  let RENDER_SCALE = BASE_RENDER_SCALE;
  const FIT = { WIDTH: "WIDTH", PAGE: "PAGE", MANUAL: "MANUAL", AUTO: "AUTO" };
  let fitMode = FIT.WIDTH;

  // Herramientas
  let currentTool = "hand";
  let strokeColor = "#60a5fa"; // sky-400 por defecto
  let strokeWidth = 3;
  let textSize = 16;
  let highlightAlpha = 0.25;
  let showGrid = false;
  let showRulers = false;
  let autoFitOnResize = true; // NUEVO: para responsive

  // Estado de documento
  let pdfDoc = null;
  let pdfArrayBuffer = null;
  let jsPDFReady = false;
  let activePage = 1;

  // Mapa por página
  const pageNodes = new Map();         // {wrapper, canvas, overlay, ann, octx, actx, viewport}
  const annotationsByPage = new Map(); // { items, undo, redo, dims }
  const columnsByPage = new Map();     // [{x,y,w,h,id,type,note,color,highlight}]
  const roiByPage = new Map();         // {x,y,w,h}
  const selectedPages = new Set();

  // Proyectos
  let projects = loadProjectsIndex();
  let currentProject = projects.last;

  /* =========================
     HELPERS
  ========================= */
  const $ = (s) => el.querySelector(s);
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const clampScale = (s) => clamp(Math.round(s * 100) / 100, 0.1, 5); // Permitir escalas más pequeñas para páginas grandes
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHTML = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const hexToRgba = (hex, alpha = 0.25) => {
    let h = String(hex || "").trim();
    if (h.startsWith("#")) h = h.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  };
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  /* =========================
     SKIN (DARK)
  ========================= */
  const css = `
  .bp-root{ --c-bg:#0b1220; --c-srf:#0f172a; --c-srf-2:#0b1220; --c-text:#e5e7eb; --c-dim:#94a3b8; --c-border:#1f2937; --c-ink:#111827; --brand:#6366f1; --ok:#10b981; --warn:#f59e0b; --bad:#ef4444; width: calc(100vw - var(--bp-aside-w, 0px)); margin-left: var(--bp-aside-w, 0px); }
  .bp-dark { color: var(--c-text); background: var(--c-bg); }
  .bp-card{ background: var(--c-srf); border: 1px solid var(--c-border); border-radius: 14px; overflow:hidden; }
  .bp-hdr{ background: rgba(15,23,42,.8); border-bottom:1px solid var(--c-border); backdrop-filter: blur(6px); }
  .bp-btn{ border:1px solid var(--c-border); background: var(--c-srf-2); color:var(--c-text); border-radius: 10px; padding:.45rem .7rem; }
  .bp-btn:hover{ background:#0e1628; }
  .bp-btn.brand{ border-color:#4f46e5; background:#4f46e5; color:white; }
  .bp-btn.brand:hover{ background:#6366f1; }
  .bp-switch{ display:inline-flex; align-items:center; gap:.4rem; font-size:.85rem; color:var(--c-dim)}
  .bp-chip{ display:inline-flex; align-items:center; gap:.5rem; padding:.25rem .6rem; border:1px solid var(--c-border); border-radius: 999px; background: var(--c-srf-2); color:var(--c-dim); }
  .bp-thumb{ border:1px solid var(--c-border); border-radius:12px; background:#0b1220; overflow:hidden; cursor:pointer; position:relative; transition: transform .06s ease, box-shadow .12s ease; }
  .bp-thumb:hover{ transform: translateY(-1px); box-shadow:0 8px 24px rgba(0,0,0,.25) }
  .bp-thumb .hdr{ display:flex; align-items:center; justify-content:space-between; font-size:11px; padding:4px 8px; background:#111827; border-bottom:1px solid var(--c-border); color:var(--c-dim) }
  .bp-thumb.selected{ box-shadow: 0 0 0 2px var(--ok) inset; }
  .bp-thumb .roi-badge{ position:absolute; inset:22px 0 0 0; pointer-events:none; }
  .thumb-select{ position:absolute; top:6px; left:6px; z-index:2; display:flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:6px; background:#0b1220; border:1px solid var(--c-border); }
  .thumb-select input{ appearance:none; width:16px; height:16px; margin:0; border:1px solid var(--c-border); border-radius:4px; background:#0b1220; }
  .thumb-select input:checked{ background:var(--ok); border-color:var(--ok); }
  .toolbar-btn[aria-pressed="true"]{ outline:2px solid #4f46e5; border-radius:8px; }
  .cursor-hand{ cursor: grab; } .cursor-pen{ cursor: crosshair; } .cursor-erase{ cursor: cell; }
  .bp-page-wrap{ position:relative; display:inline-block; }
  .bp-stage{ position:relative; width:max-content; height:max-content; }
  .ruler-x,.ruler-y{ position:sticky; background:#0b1220; z-index:4; color:#64748b; font: 10px ui-sans-serif; }
  .ruler-x{ top:0; height:20px; border-bottom:1px solid var(--c-border); }
  .ruler-y{ left:0; width:28px; border-right:1px solid var(--c-border); }
  .grid-canvas{ position:absolute; inset:0; pointer-events:none; opacity:.25 }

  /* ===== Responsive Layout ===== */
  .bp-main-grid{
    display:grid;
    grid-template-columns: 320px minmax(0,1fr) 320px;
    gap: 1rem;
    height: calc(100vh - 92px);
    padding: 1rem 1.5rem;
  }
  .bp-col-viewer{
    min-height: 0; /* Permitir que el visor use todo el espacio disponible */
  }
  .bp-col-viewer [data-role="viewer-wrap"]{
    overflow: auto; /* Restaurar overflow auto para funcionalidad normal */
    /* Ocultar scrollbars visualmente pero mantener funcionalidad */
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* Internet Explorer 10+ */
  }
  .bp-col-viewer [data-role="viewer-wrap"]::-webkit-scrollbar {
    display: none; /* Safari y Chrome */
  }
  .bp-col-thumbs{
    overflow: hidden; /* Contenedor principal sin scroll */
  }
  .bp-col-thumbs .flex-1{
    overflow-y: auto; /* Solo scroll vertical en las miniaturas */
  }
  @media (max-width: 1200px){
    .bp-main-grid{
      grid-template-columns: 320px minmax(0,1fr);
      grid-template-rows: auto 1fr auto;
    }
    .bp-col-thumbs{ grid-column: 1 / -1; height: 32vh; }
  }
  @media (max-width: 860px){
    .bp-main-grid{
      grid-template-columns: 1fr;
      grid-auto-rows: auto;
      height: auto;
    }
    .bp-col-panel, .bp-col-viewer, .bp-col-thumbs{ height: auto; }
    .bp-root{ width: 100vw; margin-left: 0; }
  }
  `;
  const tag = document.createElement("style");
  tag.id = "bp-analyzer-skin";
  tag.textContent = css;
  document.head.appendChild(tag);

  /* =========================
     UI (DARK)
  ========================= */
  el.innerHTML = `
    <div class="bp-root bp-dark h-screen w-full overflow-hidden">
      <header class="bp-hdr px-6 md:px-8 py-4">
        <div class="flex items-center gap-4">
          <h1 class="text-2xl md:text-3xl font-black tracking-tight">BLUEPRINT ANALYZER</h1>
          <div class="text-sm text-slate-400">Projects · square-columns detection · tools</div>
          <div class="ml-auto flex items-center gap-2">
            <select data-role="proj-select" class="bp-btn"></select>
            <button class="bp-btn" data-role="proj-new">New</button>
            <button class="bp-btn" data-role="proj-save">Save</button>
            <button class="bp-btn" data-role="proj-del">Delete</button>
            <label class="hidden md:block ml-3 bp-switch">
              <span>PDF</span>
              <input type="file" accept="application/pdf" data-role="pdf-input" class="bp-btn" />
            </label>
            <button class="bp-btn brand" data-role="cv">Detect columns</button>
          </div>
        </div>
        <div class="mt-3 flex items-center gap-3 flex-wrap">
          <div class="bp-chip"><span>Status:</span> <b class="text-slate-200" data-role="status">—</b></div>
          <div class="flex-1 min-w-[180px] h-2 bg-slate-800 rounded overflow-hidden"><div data-role="progress" class="h-2 bg-indigo-500" style="width:0%"></div></div>
          <div class="bp-chip">Σ columns: <b data-role="col-total">0</b></div>
          <label class="bp-switch"><input type="checkbox" data-role="grid"> Grid</label>
          <label class="bp-switch"><input type="checkbox" data-role="rulers"> Rulers</label>
          <label class="bp-switch"><input type="checkbox" data-role="autofit" checked> Auto-fit</label>
        </div>
      </header>

      <main class="bp-main-grid">
        <!-- Panel -->
        <section class="bp-card overflow-hidden flex flex-col bp-col-panel">
          <div class="px-3 py-2 border-b border-slate-700 bg-slate-900 text-sm font-medium">Panel</div>
          <div class="p-3 space-y-4 overflow-auto">
            <div>
              <div class="text-xs text-slate-400 mb-1">Summary</div>
              <div class="overflow-auto max-h-44 border border-slate-700 rounded">
                <table class="min-w-full text-sm">
                  <thead class="sticky top-0 bg-slate-900">
                    <tr class="text-left text-slate-300 border-b border-slate-700">
                      <th class="py-2 px-3">Page</th>
                      <th class="py-2 px-3">Cols</th>
                    </tr>
                  </thead>
                  <tbody data-role="count-cols" class="divide-y divide-slate-800"></tbody>
                </table>
              </div>
            </div>

            <div>
              <div class="text-xs text-slate-400 mb-1">Columns (active page)</div>
              <ul data-role="col-list" class="text-sm border border-slate-700 rounded p-2 space-y-1 max-h-56 overflow-auto"></ul>
            </div>

            <!-- NUEVO: Editor de columnas -->
            <div>
              <div class="text-xs text-slate-400 mb-1">Tipos/Notas de columnas (página activa)</div>
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <button data-role="annotate-all" class="bp-btn brand text-sm">Anotar todas</button>
                  <label class="bp-switch"><input type="checkbox" data-role="auto-highlight" checked> Resaltar al anotar</label>
                </div>
                <div data-role="col-editor" class="border border-slate-700 rounded p-2 max-h-72 overflow-auto space-y-2"></div>
              </div>
            </div>

            <div>
              <div class="text-xs text-slate-400 mb-1">Annotations by type</div>
              <div class="overflow-auto max-h-64 border border-slate-700 rounded">
                <table class="min-w-full text-sm">
                  <thead class="sticky top-0 bg-slate-900">
                    <tr class="text-left text-slate-300 border-b border-slate-700">
                      <th class="py-2 px-3">Type</th>
                      <th class="py-2 px-3">Count</th>
                    </tr>
                  </thead>
                  <tbody data-role="count-ann" class="divide-y divide-slate-800"></tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <!-- Viewer -->
        <section class="bp-card overflow-hidden flex flex-col bp-col-viewer">
          <div class="px-3 py-2 border-b border-slate-700 bg-slate-900 flex flex-wrap items-center gap-2">
            <strong class="text-sm">Page:</strong>
            <select data-role="page-select" class="bp-btn"></select>

            <div class="ml-1 inline-flex bg-slate-900 rounded-lg overflow-hidden border border-slate-700 text-lg">
              <button class="px-3 py-1.5 toolbar-btn" data-tool="hand" title="Hand">🖐️</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="pen" title="Pen">✏️</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="rect" title="Rect">▭</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="ellipse" title="Ellipse">◯</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="line" title="Line">／</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="arrow" title="Arrow">➤</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="dblarrow" title="Double">↔</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="measure" title="Measure">📏</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="highlight" title="Highlight">▨</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="text" title="Text">🔤</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="erase" title="Eraser">🧹</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="lassoerase" title="Lasso erase">🪄</button>
              <button class="px-3 py-1.5 toolbar-btn" data-tool="roi" title="ROI">🟩</button>
            </div>

            <label class="ml-2 text-xs text-slate-300">Color
              <input type="color" value="#60a5fa" data-role="stroke-color" class="ml-1 h-8 w-10 align-middle border border-slate-700 rounded bg-slate-900"/>
            </label>
            <label class="ml-2 text-xs text-slate-300">Width
              <input type="range" min="1" max="12" value="3" data-role="stroke-width" class="ml-1 align-middle"/>
              <span data-role="stroke-width-val" class="ml-1">3px</span>
            </label>
            <label class="ml-2 text-xs text-sate-300">Text
              <input type="number" min="8" max="72" value="16" data-role="text-size" class="ml-1 w-16 align-middle border border-slate-700 rounded px-2 py-1 bg-slate-900 text-slate-100"/> px
            </label>
            <label class="ml-2 text-xs text-slate-300">HL alpha
              <input type="range" min="0.05" max="0.9" step="0.05" value="0.25" data-role="highlight-alpha" class="ml-1 align-middle"/>
              <span data-role="highlight-alpha-val" class="ml-1">0.25</span>
            </label>

            <div class="ml-auto flex items-center gap-1">
              <button data-role="fit-width" class="bp-btn">Fit width</button>
              <button data-role="fit-page" class="bp-btn">Fit page</button>
              <button data-role="center-page" class="bp-btn">Center</button>
              <button data-role="reset-zoom" class="bp-btn">100%</button>
              <button data-role="zoom-out" class="bp-btn">−</button>
              <input data-role="zoom-slider" type="range" min="10" max="500" value="100" title="Zoom %" />
              <span data-role="zoom-label" class="text-sm">100%</span>
              <button data-role="zoom-in" class="bp-btn">+</button>
              <button data-role="undo" class="bp-btn" title="Undo">↶</button>
              <button data-role="redo" class="bp-btn" title="Redo">↷</button>
              <button data-role="clear" class="bp-btn">🗑</button>
              <button data-role="save-json" class="bp-btn">JSON</button>
              <button data-role="export" class="bp-btn">PNG</button>
              <button data-role="export-pdf" class="bp-btn">PDF</button>
            </div>
          </div>

          <div class="flex-1 relative" data-role="viewer-wrap">
            <!-- Rulers -->
            <div class="ruler-x hidden" data-role="ruler-x"></div>
            <div class="ruler-y hidden" data-role="ruler-y"></div>

            <div data-role="viewer">
              <div class="bp-stage relative" data-role="stage"></div>
            </div>
          </div>
        </section>

        <!-- Thumbs -->
        <section class="bp-card overflow-hidden flex flex-col bp-col-thumbs">
          <div class="px-3 py-2 border-b border-slate-700 bg-slate-900 text-sm font-medium flex items-center gap-2">
            Thumbnails
            <button data-role="detect-roi" class="ml-auto bp-btn brand text-sm">Detect in ROI</button>
          </div>
          <div class="flex-1 overflow-auto p-2"><div data-role="thumbs"></div></div>
        </section>
      </main>
    </div>
  `;

  /* =========================
     DOM refs
  ========================= */
  const pdfInput = $("[data-role='pdf-input']");
  const btnDetect = $("[data-role='cv']");
  const btnDetectROI = $("[data-role='detect-roi']");
  const statusEl = $("[data-role='status']");
  const progressEl = $("[data-role='progress']");
  const colTotalEl = $("[data-role='col-total']");
  const countColsBody = $("[data-role='count-cols']");
  const countAnnBody = $("[data-role='count-ann']");
  const viewerWrap = $("[data-role='viewer-wrap']");
  const viewer = $("[data-role='viewer']");
  const stage = $("[data-role='stage']");
  const thumbs = $("[data-role='thumbs']");
  const pageSelect = $("[data-role='page-select']");
  const projSelect = $("[data-role='proj-select']");
  const btnProjNew = $("[data-role='proj-new']");
  const btnProjSave = $("[data-role='proj-save']");
  const btnProjDel = $("[data-role='proj-del']");
  const toolButtons = [...el.querySelectorAll(".toolbar-btn")];
  const colorInput = $("[data-role='stroke-color']");
  const widthInput = $("[data-role='stroke-width']");
  const widthVal = $("[data-role='stroke-width-val']");
  const textSizeInput = $("[data-role='text-size']");
  const hlAlphaInput = $("[data-role='highlight-alpha']");
  const hlAlphaVal = $("[data-role='highlight-alpha-val']");
  const btnUndo = $("[data-role='undo']");
  const btnRedo = $("[data-role='redo']");
  const btnClear = $("[data-role='clear']");
  const btnExportPNG = $("[data-role='export']");
  const btnExportPDF = $("[data-role='export-pdf']");
  const btnSaveJSON = $("[data-role='save-json']");
  const btnZoomIn = $("[data-role='zoom-in']");
  const btnZoomOut = $("[data-role='zoom-out']");
  const zoomSlider = $("[data-role='zoom-slider']");
  const btnFitWidth = $("[data-role='fit-width']");
  const btnFitPage = $("[data-role='fit-page']");
  const btnCenter = $("[data-role='center-page']");
  const btnResetZoom = $("[data-role='reset-zoom']");
  const zoomLabel = $("[data-role='zoom-label']");
  const colListContainer = $("[data-role='col-list']");
  const chkGrid = $("[data-role='grid']");
  const chkRulers = $("[data-role='rulers']");
  const chkAutoFit = $("[data-role='autofit']");
  const rulerX = $("[data-role='ruler-x']");
  const rulerY = $("[data-role='ruler-y']");
  // NUEVO editor columnas
  const colEditorBox = $("[data-role='col-editor']");
  const btnAnnotateAll = $("[data-role='annotate-all']");
  const chkAutoHighlight = $("[data-role='auto-highlight']");

  /* =========================
     Aside width sync
  ========================= */
  function updateAsideWidth() {
    try {
      const visible = ASIDE_EL ? getComputedStyle(ASIDE_EL).display !== "none" : false;
      const measured = ASIDE_EL && visible ? Math.max(0, Math.floor(ASIDE_EL.getBoundingClientRect().width)) : 0;
      const w = measured;
      document.documentElement.style.setProperty("--bp-aside-w", `${w}px`);
    } catch {}
  }
  updateAsideWidth();
  if (ASIDE_EL && typeof ResizeObserver !== "undefined") new ResizeObserver(updateAsideWidth).observe(ASIDE_EL);
  window.addEventListener("resize", updateAsideWidth);

  // Auto-fit también cuando cambia el tamaño del VISOR central
  if (typeof ResizeObserver !== "undefined") {
    let resizeTimeout;
    const ro = new ResizeObserver(() => {
      if (!pdfDoc || !autoFitOnResize || fitMode === FIT.MANUAL) return;
      
      // Debounce más agresivo para evitar loops
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Solo aplicar si realmente hay un cambio significativo en las dimensiones
        const { maxW, maxH } = getViewerInnerSize();
        if (maxW > 200 && maxH > 200) {
          applyFit();
        }
      }, 300); // Aumentar a 300ms para mayor estabilidad
    });
    ro.observe(viewerWrap);
  }

  /* =========================
     Estado/acciones UI
  ========================= */
  const status = (m) => (statusEl.textContent = m || "—");
  const setProgress = (p) => (progressEl.style.width = `${p}%`);
  function updateButtons() {
    const ready = !!pdfArrayBuffer;
    btnDetect.disabled = !ready;
    btnDetectROI.disabled = !ready;
    btnExportPDF.disabled = !ready || !jsPDFReady;
  }
  function updateToolSelection() {
    toolButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === currentTool)));
    const node = pageNodes.get(activePage);
    if (!node) return;
    const target = node.ann;
    target.classList.remove("cursor-hand", "cursor-pen", "cursor-erase");
    if (["hand", "select"].includes(currentTool)) {
      target.classList.add("cursor-hand");
      target.style.pointerEvents = "none";
    } else if (["erase", "lassoerase"].includes(currentTool)) {
      target.classList.add("cursor-erase");
      target.style.pointerEvents = "auto";
    } else {
      target.classList.add("cursor-pen");
      target.style.pointerEvents = "auto";
    }
  }

  toolButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      currentTool = btn.dataset.tool;
      updateToolSelection();
    })
  );
  colorInput.addEventListener("input", (e) => {
    strokeColor = e.target.value;
    renderAnnotations(activePage);
  });
  widthInput.addEventListener("input", (e) => {
    strokeWidth = +e.target.value || 1;
    widthVal.textContent = `${strokeWidth}px`;
  });
  textSizeInput.addEventListener("input", (e) => {
    textSize = Math.max(8, Math.min(72, +e.target.value || 16));
  });
  hlAlphaInput.addEventListener("input", (e) => {
    highlightAlpha = clamp(+e.target.value || 0.25, 0.05, 0.9);
    hlAlphaVal.textContent = String(highlightAlpha);
  });

  chkGrid.addEventListener("change", () => {
    showGrid = chkGrid.checked;
    renderSinglePage(activePage, { remeasure: false });
  });
  chkRulers.addEventListener("change", () => {
    showRulers = chkRulers.checked;
    rulerX.classList.toggle("hidden", !showRulers);
    rulerY.classList.toggle("hidden", !showRulers);
    centerPageInView(false);
  });
  chkAutoFit.addEventListener("change", () => {
    autoFitOnResize = chkAutoFit.checked;
    if (autoFitOnResize && pdfDoc) {
      fitMode = FIT.PAGE; // Siempre usar fit page para vista completa profesional
      applyFit();
    }
  });

  /* =========================
     Librerías externas
  ========================= */
  await ensureScript(PDFJS_URL);
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  try {
    await ensureScript(JSPDF_URL);
    jsPDFReady = !!window.jspdf;
  } catch {
    jsPDFReady = false;
  }
  updateButtons();

  /* =========================
     Proyectos
  ========================= */
  function loadProjectsIndex() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { projects: { "Project 1": {} }, last: "Project 1" };
      const obj = JSON.parse(raw);
      if (!obj.projects) obj.projects = { "Project 1": {} };
      if (!obj.last) obj.last = Object.keys(obj.projects)[0] || "Project 1";
      return obj;
    } catch {
      return { projects: { "Project 1": {} }, last: "Project 1" };
    }
  }
  function saveProjectsIndex() {
    localStorage.setItem(LS_KEY, JSON.stringify(projects));
  }
  function refreshProjectSelect() {
    const names = Object.keys(projects.projects).sort((a, b) => a.localeCompare(b));
    if (!projects.projects[currentProject]) currentProject = names[0] || "Project 1";
    projSelect.innerHTML = names
      .map((n) => `<option value="${escapeHTML(n)}"${n === currentProject ? " selected" : ""}>${escapeHTML(n)}</option>`)
      .join("");
  }
  function serializeProject() {
    const ann = {}, roi = {}, cols = {};
    for (const [p, s] of annotationsByPage.entries()) ann[p] = s;
    for (const [p, s] of roiByPage.entries()) roi[p] = s;
    for (const [p, s] of columnsByPage.entries()) cols[p] = s;
    return { annotations: ann, rois: roi, columns: cols, meta: { ts: Date.now() } };
  }
  function hydrateProject(data) {
    annotationsByPage.clear();
    roiByPage.clear();
    columnsByPage.clear();
    if (data) {
      if (data.annotations) for (const k of Object.keys(data.annotations)) annotationsByPage.set(+k, data.annotations[k]);
      if (data.rois) for (const k of Object.keys(data.rois)) roiByPage.set(+k, data.rois[k]);
      if (data.columns) for (const k of Object.keys(data.columns)) columnsByPage.set(+k, data.columns[k]);
    }
    for (const [p] of pageNodes.entries()) {
      renderAnnotations(p);
      drawROIOverlay(p);
    }
    renderCountsPanels();
    renderColumnEditor(); // NUEVO: refrescar editor
  }
  projects = loadProjectsIndex();
  currentProject = projects.last;
  refreshProjectSelect();
  projSelect.addEventListener("change", () => {
    currentProject = projSelect.value;
    projects.last = currentProject;
    saveProjectsIndex();
    hydrateProject(projects.projects[currentProject]);
    status(`Loaded: ${currentProject}`);
  });
  btnProjNew.addEventListener("click", () => {
    const name = prompt("Project name:", `Project ${Object.keys(projects.projects).length + 1}`);
    if (!name) return;
    if (projects.projects[name]) {
      alert("Project already exists.");
      return;
    }
    projects.projects[name] = {};
    currentProject = name;
    projects.last = name;
    saveProjectsIndex();
    refreshProjectSelect();
    hydrateProject(projects.projects[name]);
    status(`Created: ${name}`);
  });
  btnProjSave.addEventListener("click", () => {
    projects.projects[currentProject] = serializeProject();
    projects.last = currentProject;
    saveProjectsIndex();
    status("Saved ✅");
  });
  btnProjDel.addEventListener("click", () => {
    if (!confirm(`Delete project "${currentProject}"?`)) return;
    delete projects.projects[currentProject];
    projects.last = Object.keys(projects.projects)[0] || "Project 1";
    saveProjectsIndex();
    refreshProjectSelect();
    hydrateProject(projects.projects[projects.last]);
    status("Deleted");
  });

  /* =========================
     PDF flujo
  ========================= */
  pdfInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    pdfArrayBuffer = await file.arrayBuffer();
    await openPDF();
    updateButtons();
  });
  btnDetect.addEventListener("click", async () => {
    if (!pdfDoc) return;
    await detectSquaresOn(activePage);
  });
  btnDetectROI.addEventListener("click", async () => {
    if (!pdfDoc) return;
    await detectSquaresOn(activePage, { useROI: true });
  });

  async function openPDF() {
    stage.innerHTML = "";
    thumbs.innerHTML = "";
    pageNodes.clear();
    columnsByPage.clear();
    selectedPages.clear();

    status("Loading PDF…");
    const loading = pdfjsLib.getDocument({ data: pdfArrayBuffer });
    pdfDoc = await loading.promise;
    status("Rendering…");

    pageSelect.innerHTML = Array.from({ length: pdfDoc.numPages }, (_, i) => `<option value="${i + 1}">Page ${i + 1}</option>`).join("");
    pageSelect.onchange = (e) => showPage(+e.target.value);

    await renderAllThumbs(pdfDoc);

    const first = await pdfDoc.getPage(1);
    const baseVp = first.getViewport({ scale: 1 });

    // Arrancar siempre en "Fit page"
    fitMode = FIT.PAGE; // siempre llenar el espacio disponible
    
    // Esperar un frame para asegurar que el DOM esté completamente renderizado
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    const initialScale = computeFitScale(baseVp);
    applyScale(initialScale, { remeasure: false });

    activePage = 1;
    await renderSinglePage(activePage);
    highlightThumb(activePage);

    hydrateProject(projects.projects[currentProject]);
    renderCountsPanels();
    status("Ready ✅");
  }

  async function renderAllThumbs(pdf) {
    const THUMB_W = 280;
    thumbs.innerHTML = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = THUMB_W / base.width;
      const vp = page.getViewport({ scale });
      const wrap = document.createElement("div");
      wrap.className = "bp-thumb relative";
      wrap.dataset.page = String(p);

      const selBox = document.createElement("label");
      selBox.className = "thumb-select";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      selBox.appendChild(chk);
      wrap.appendChild(selBox);

      const header = document.createElement("div");
      header.className = "hdr";
      header.innerHTML = `<span>Page ${p}</span><span class="font-semibold"><span data-thumb-count="${p}">—</span> cols</span>`;
      wrap.appendChild(header);

      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.className = "block";
      wrap.appendChild(c);

      const roiOverlay = document.createElement("canvas");
      roiOverlay.width = c.width;
      roiOverlay.height = c.height;
      roiOverlay.className = "roi-badge";
      wrap.appendChild(roiOverlay);

      thumbs.appendChild(wrap);
      await page.render({ canvasContext: c.getContext("2d", { willReadFrequently: true }), viewport: vp }).promise;

      wrap.addEventListener("click", () => showPage(p));
      chk.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleThumbSelect(p, chk.checked);
      });

      wrap._roiOverlay = roiOverlay;
      updateThumbROI(p);
    }
  }
  function toggleThumbSelect(pageNum, value) {
    const wrap = thumbs.querySelector(`[data-page="${pageNum}"]`);
    if (!wrap) return;
    const chk = wrap.querySelector("input[type='checkbox']");
    const val = value !== undefined ? value : !selectedPages.has(pageNum);
    if (val) {
      selectedPages.add(pageNum);
      wrap.classList.add("selected");
      if (chk) chk.checked = true;
    } else {
      selectedPages.delete(pageNum);
      wrap.classList.remove("selected");
      if (chk) chk.checked = false;
    }
  }
  function updateThumbROI(pageNum) {
    const wrap = thumbs.querySelector(`[data-page="${pageNum}"]`);
    if (!wrap || !wrap._roiOverlay) return;
    const o = wrap._roiOverlay.getContext("2d");
    o.clearRect(0, 0, wrap._roiOverlay.width, wrap._roiOverlay.height);
    const roi = roiByPage.get(pageNum);
    const node = pageNodes.get(pageNum);
    if (!roi || !node) return;
    const s = wrap._roiOverlay.width / node.canvas.width;
    o.save();
    o.strokeStyle = "rgba(16,185,129,.95)";
    o.lineWidth = 2;
    o.setLineDash([6, 4]);
    o.strokeRect(roi.x * s, roi.y * s, roi.w * s, roi.h * s);
    o.restore();
  }

  async function showPage(p) {
    if (!pdfDoc) return;
    status(`Page ${p}…`);

    if (fitMode !== FIT.MANUAL) {
      const page = await pdfDoc.getPage(p);
      const baseVp = page.getViewport({ scale: 1 });
      const newScale = computeFitScale(baseVp);
      // Solo aplicar nuevo scale si hay una diferencia significativa
      if (Math.abs(newScale - RENDER_SCALE) > 0.01) {
        applyScale(newScale, { remeasure: true });
      }
    }

    await renderSinglePage(p);
    status(`Page ${p}: ${(columnsByPage.get(p) || []).length} columns`);
  }

  /* =========================
     Render page
  ========================= */
  function getViewerInnerSize() {
    const w = viewerWrap.clientWidth - (showRulers ? 28 : 0);
    const h = viewerWrap.clientHeight - (showRulers ? 20 : 0);
    return { maxW: Math.max(200, w), maxH: Math.max(200, h) };
  }
  function computeFitScale(viewport) {
    const { maxW, maxH } = getViewerInnerSize();
    const pageW = viewport.width, pageH = viewport.height;
    
    if (fitMode === FIT.WIDTH) return clampScale((maxW / pageW) * BASE_RENDER_SCALE);
    if (fitMode === FIT.PAGE) {
      const sW = maxW / pageW, sH = maxH / pageH;
      // Usar todo el espacio disponible para mostrar la página completa
      return clampScale(Math.min(sW, sH) * BASE_RENDER_SCALE);
    }
    if (fitMode === FIT.AUTO) {
      const sW = maxW / pageW, sH = maxH / pageH;
      // prioriza ancho sin pasarse del alto
      return clampScale(Math.min(Math.max(sW * 0.95, Math.min(sW, sH)), sH) * BASE_RENDER_SCALE);
    }
    return RENDER_SCALE;
  }
  function applyScale(newScale, { remeasure = true, keepCenter = false } = {}) {
    const clamped = clampScale(newScale);
    const before = RENDER_SCALE;
    RENDER_SCALE = clamped;
    const pct = Math.round((RENDER_SCALE / BASE_RENDER_SCALE) * 100);
    zoomLabel.textContent = `${pct}%`;
    zoomSlider.value = String(pct);

    const node = pageNodes.get(activePage);
    let cx = 0, cy = 0;
    if (keepCenter && node) {
      const rect = node.wrapper.getBoundingClientRect();
      cx = viewerWrap.scrollLeft + rect.width / 2;
      cy = viewerWrap.scrollTop + rect.height / 2;
    }
    if (pdfDoc && remeasure) {
      renderSinglePage(activePage, { remeasure: true }).then(() => {
        if (keepCenter && node) {
          const ratio = RENDER_SCALE / before;
          viewerWrap.scrollLeft = cx * ratio - node.wrapper.getBoundingClientRect().width / 2;
          viewerWrap.scrollTop = cy * ratio - node.wrapper.getBoundingClientRect().height / 2;
        }
      });
    }
  }
  function centerPageInView(smooth = false) {
    const wrap = viewerWrap;
    const targetL = Math.max(0, (wrap.scrollWidth - wrap.clientWidth) / 2);
    const targetT = Math.max(0, (wrap.scrollHeight - wrap.clientHeight) / 2);
    if (smooth) smoothScrollTo(wrap, targetL, targetT, 220);
    else { wrap.scrollLeft = targetL; wrap.scrollTop = targetT; }
  }
  function smoothScrollTo(el, x, y, dur = 200) {
    const sx = el.scrollLeft, sy = el.scrollTop, dx = x - sx, dy = y - sy;
    const t0 = performance.now();
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      el.scrollLeft = sx + dx * e; el.scrollTop = sy + dy * e;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  async function renderSinglePage(pageNum, opt = {}) {
    if (!pdfDoc) return;
    setProgress(Math.round((pageNum / pdfDoc.numPages) * 100));
    const page = await pdfDoc.getPage(pageNum);
    let viewport = page.getViewport({ scale: RENDER_SCALE });

    let node = pageNodes.get(pageNum);
    if (!node) {
      const { wrapper, canvas, overlay, octx, ann, actx } = createPageCanvases(viewport);
      wrapper.dataset.page = String(pageNum);
      wrapper.classList.add("bp-page-wrap");
      wrapper.style.visibility = "hidden";
      const footer = document.createElement("div");
      footer.className = "px-3 py-2 text-xs text-slate-400";
      footer.dataset.role = "page-footer";
      wrapper.appendChild(footer);
      if (showRulers) {
        rulerX.style.left = showRulers ? "28px" : "0";
        rulerX.style.right = "0";
        rulerY.style.top = "0";
        rulerY.style.bottom = "0";
      }
      stage.appendChild(wrapper);
      pageNodes.set(pageNum, { wrapper, canvas, overlay, octx, ann, actx, viewport, footer, renderTask: null, grid: null });
      ensureAnnoState(pageNum, canvas.width, canvas.height);
      attachAnnotationHandlers(pageNum);
    } else {
      node.viewport = viewport;
    }

    if (opt.remeasure) {
      viewport = page.getViewport({ scale: RENDER_SCALE });
      const n = pageNodes.get(pageNum);
      n.viewport = viewport;
      n.wrapper.style.width = `${viewport.width}px`;
      n.wrapper.style.height = `${viewport.height}px`;
      n.canvas.width = Math.floor(viewport.width);
      n.canvas.height = Math.floor(viewport.height);
      n.overlay.width = n.canvas.width;
      n.overlay.height = n.canvas.height;
      n.ann.width = n.canvas.width;
      n.ann.height = n.canvas.height;
      updateThumbROI(pageNum);
    }

    const n = pageNodes.get(pageNum);
    const ctx = n.canvas.getContext("2d", { alpha: false });
    ctx.clearRect(0, 0, n.canvas.width, n.canvas.height);
    n.octx.clearRect(0, 0, n.overlay.width, n.overlay.height);

    if (n.renderTask) { try { n.renderTask.cancel(); } catch {} }
    const renderTask = page.render({ canvasContext: ctx, viewport });
    n.renderTask = renderTask;
    try { await renderTask.promise; } catch (err) { if (!(err && err.name === "RenderingCancelledException")) throw err; } finally { if (n.renderTask === renderTask) n.renderTask = null; }

    if (showGrid) drawGrid(n);

    const cols = columnsByPage.get(pageNum) || [];
    drawRects(n.octx, cols, { fill: "rgba(99,102,241,.22)", stroke: "rgba(99,102,241,.95)" });
    drawColumnLabels(n.octx, cols);

    renderAnnotations(pageNum);
    drawROIOverlay(pageNum);

    n.footer.textContent = `Page ${pageNum} · ${Math.round(viewport.width)}×${Math.round(viewport.height)} px · Zoom ${Math.round(
      (RENDER_SCALE / BASE_RENDER_SCALE) * 100
    )}%`;

    for (const [p, x] of pageNodes.entries()) x.wrapper.style.display = p === pageNum ? "inline-block" : "none";
    activePage = pageNum;
    pageSelect.value = String(pageNum);
    highlightThumb(pageNum);
    updateToolSelection();
    renderCountsPanels();
    renderColumnEditor(); // NUEVO

    centerPageInView(false); // Sin animación para evitar bugs
    n.wrapper.style.visibility = "visible";
  }

  function createPageCanvases(viewport) {
    const wrapper = document.createElement("div");
    wrapper.className = "bp-page-wrap";
    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = "block";

    const overlay = document.createElement("canvas");
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    overlay.className = "absolute left-0 top-0 pointer-events-none";
    const octx = overlay.getContext("2d", { willReadFrequently: true });

    const ann = document.createElement("canvas");
    ann.width = canvas.width;
    ann.height = canvas.height;
    ann.className = "absolute left-0 top-0";
    const actx = ann.getContext("2d", { willReadFrequently: true });

    wrapper.appendChild(canvas);
    wrapper.appendChild(overlay);
    wrapper.appendChild(ann);
    return { wrapper, canvas, overlay, octx, ann, actx };
  }

  function drawGrid(node) {
    if (node.grid) node.grid.remove();
    const g = document.createElement("canvas");
    g.width = node.canvas.width;
    g.height = node.canvas.height;
    g.className = "grid-canvas";
    node.wrapper.appendChild(g);
    node.grid = g;
    const ctx = g.getContext("2d");
    ctx.strokeStyle = "rgba(148,163,184,.25)";
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x < g.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, g.height);
      ctx.stroke();
    }
    for (let y = 0; y < g.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(g.width, y + 0.5);
      ctx.stroke();
    }
  }

  function drawROIOverlay(pageNum) {
    const node = pageNodes.get(pageNum);
    if (!node) return;
    const { octx } = node;
    const roi = roiByPage.get(pageNum);
    if (!roi) return;
    octx.save();
    octx.strokeStyle = "rgba(16,185,129,.95)";
    octx.setLineDash([6, 4]);
    octx.lineWidth = 2;
    octx.strokeRect(roi.x, roi.y, roi.w, roi.h);
    octx.restore();
  }

  /* =========================
     Contadores + navegación
  ========================= */
  function renderCountsPanels() {
    const p = activePage;
    const cols = columnsByPage.get(p) || [];

    if (pdfDoc) {
      let total = 0;
      let rows = "";
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const n = (columnsByPage.get(i) || []).length;
        total += n;
        rows += `<tr><td class="py-1.5 px-3">P.${i}</td><td class="py-1.5 px-3">${n}</td></tr>`;
      }
      rows += `<tr class="border-t border-slate-700 font-semibold"><td class="py-1.5 px-3">Total</td><td class="py-1.5 px-3">${total}</td></tr>`;
      countColsBody.innerHTML = rows;
      colTotalEl.textContent = String(total);
    } else {
      countColsBody.innerHTML = `<tr><td class="py-1.5 px-3">P.${p}</td><td class="py-1.5 px-3">${cols.length}</td></tr>`;
      colTotalEl.textContent = String(cols.length);
    }

    if (!cols.length) {
      colListContainer.innerHTML = `<li class="text-slate-400">No columns.</li>`;
    } else {
      colListContainer.innerHTML = cols
        .map(
          (c, i) => `
        <li class="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-slate-800">
          <span><b>${escapeHTML(c.id || `C${i + 1}`)}</b> · (${Math.round(c.x)}, ${Math.round(c.y)}) ${Math.round(c.w)}×${Math.round(c.h)}</span>
          <button class="text-indigo-400 underline" data-jump="${escapeHTML(c.id || `C${i + 1}`)}">View</button>
        </li>`
        )
        .join("");
      colListContainer.querySelectorAll("[data-jump]").forEach((b) =>
        b.addEventListener("click", () => focusColumn(p, b.getAttribute("data-jump")))
      );
    }

    const s = annotationsByPage.get(p);
    const agg = {};
    if (s) for (const it of s.items) agg[it.type] = (agg[it.type] || 0) + 1;
    const order = ["rect", "ellipse", "line", "arrow", "dblarrow", "measure", "text", "highlight", "pen"];
    const rows = order.filter((k) => agg[k]).map((k) => `<tr><td class="py-1.5 px-3">${k}</td><td class="py-1.5 px-3">${agg[k]}</td></tr>`);
    countAnnBody.innerHTML =
      rows.length ? rows.join("") : `<tr><td colspan="2" class="py-6 text-slate-500 text-center">No annotations.</td></tr>`;
  }
  function highlightThumb(p) {
    [...thumbs.children].forEach((w) => {
      w.classList.toggle("selected", Number(w.dataset.page) === p);
    });
  }

  // Zoom con rueda (natural)
  viewerWrap.addEventListener(
    "wheel",
    (e) => {
      const allowZoom = ["hand", "select", "roi"].includes(currentTool) || e.ctrlKey;
      if (!allowZoom) return;
      e.preventDefault();
      const delta = Math.sign(e.deltaY);
      const factor = 0.12;
      const before = RENDER_SCALE;
      const after = clampScale(before * (1 - delta * factor));
      const node = pageNodes.get(activePage);
      if (!node) {
        applyScale(after);
        return;
      }
      const rect = node.wrapper.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const sx = mx + viewerWrap.scrollLeft, sy = my + viewerWrap.scrollTop;
      const ratio = after / before;
      applyScale(after, { remeasure: true });
      requestAnimationFrame(() => {
        viewerWrap.scrollLeft = sx * ratio - mx;
        viewerWrap.scrollTop = sy * ratio - my;
      });
    },
    { passive: false }
  );
  (function enableDragPan() {
    let panning = false, start = { x: 0, y: 0 }, orig = { l: 0, t: 0 };
    const canPan = () => ["hand", "select"].includes(currentTool);
    viewerWrap.addEventListener("mousedown", (e) => {
      if ((e.button === 0 && canPan()) || e.button === 1) {
        panning = true;
        start = { x: e.clientX, y: e.clientY };
        orig = { l: viewerWrap.scrollLeft, t: viewerWrap.scrollTop };
        viewer.classList.add("cursor-hand");
        e.preventDefault();
      }
    });
    window.addEventListener("mousemove", (e) => {
      if (!panning) return;
      viewerWrap.scrollLeft = orig.l + (start.x - e.clientX);
      viewerWrap.scrollTop = orig.t + (start.y - e.clientY);
    });
    window.addEventListener("mouseup", () => {
      if (panning) { panning = false; viewer.classList.remove("cursor-hand"); }
    });
  })();

  /* =========================
     ZOOM / FITS
  ========================= */
  btnZoomIn.addEventListener("click", () => { fitMode = FIT.MANUAL; applyScale(RENDER_SCALE + 0.15, { keepCenter: true }); });
  btnZoomOut.addEventListener("click", () => { fitMode = FIT.MANUAL; applyScale(RENDER_SCALE - 0.15, { keepCenter: true }); });
  zoomSlider.addEventListener("input", (e) => {
    fitMode = FIT.MANUAL;
    const pct = clamp(+e.target.value || 100, 50, 300);
    applyScale((pct / 100) * BASE_RENDER_SCALE, { keepCenter: true });
  });
  btnFitWidth.addEventListener("click", () => { fitMode = FIT.WIDTH; applyFit(); });
  btnFitPage.addEventListener("click", () => { fitMode = FIT.PAGE; applyFit(); });
  btnCenter.addEventListener("click", () => centerPageInView(true));
  btnResetZoom.addEventListener("click", () => { fitMode = FIT.MANUAL; applyScale(BASE_RENDER_SCALE); });
  let windowResizeTimeout;
  window.addEventListener("resize", () => {
    if (!pdfDoc || !autoFitOnResize || fitMode === FIT.MANUAL) return;
    clearTimeout(windowResizeTimeout);
    windowResizeTimeout = setTimeout(() => applyFit(), 250);
  });
  
  window.addEventListener("orientationchange", () => {
    if (!pdfDoc || !autoFitOnResize || fitMode === FIT.MANUAL) return;
    setTimeout(() => applyFit(), 500); // Más tiempo para orientationchange
  });
  function applyFit() {
    if (!pdfDoc) return;
    pdfDoc.getPage(activePage).then((page) => {
      const baseVp = page.getViewport({ scale: 1 });
      const newScale = computeFitScale(baseVp);
      // Solo aplicar si hay una diferencia significativa
      if (Math.abs(newScale - RENDER_SCALE) > 0.01) {
        applyScale(newScale, { remeasure: true });
      }
    });
  }

  /* =========================
     DETECCIÓN — CUADRADOS
     Vector-only con pdf.js (100%).
  ========================= */
  async function detectSquaresOn(pageNum, { useROI = false } = {}) {
    if (!pdfDoc) return [];
    status(`Detecting columns (squares) on page ${pageNum}…`);

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const ops = await page.getOperatorList();

    const T = pdfjsLib.Util.transform;
    const applyPoint = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    let path = [];

    const candidates = [];
    const pushRectFromPath = (mat) => {
      if (!path.length) return;
      const pts = [...path];
      const isClosed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.5;
      if (!isClosed) pts.push({ ...pts[0] });

      const M = T(viewport.transform, mat);
      const trPts = pts.map((p) => applyPoint(M, p.x, p.y));
      const xs = trPts.map((p) => p.x), ys = trPts.map((p) => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
      if (w < 4 || h < 4) return;
      const asp = w > h ? w / h : h / w;
      if (asp > 1.25) return;
      const aRel = (w * h) / (viewport.width * viewport.height);
      if (aRel < 0.00001 || aRel > 0.12) return;
      candidates.push({ x, y, w, h, score: 1 / (Math.abs(1 - asp) + 1e-3) });
    };

    const OPS = pdfjsLib.OPS;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      switch (fn) {
        case OPS.save: stack.push(ctm.slice()); break;
        case OPS.restore: ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
        case OPS.transform: ctm = T(ctm, args); break;
        case OPS.constructPath: {
          const [pathOps, coords] = args;
          path = [];
          let idx = 0;
          for (const op of pathOps) {
            if (op === "m") { const x = coords[idx++], y = coords[idx++]; path.push({ x, y }); }
            else if (op === "l") { const x = coords[idx++], y = coords[idx++]; path.push({ x, y }); }
            else if (op === "re") {
              const x = coords[idx++], y = coords[idx++], w = coords[idx++], h = coords[idx++];
              const M = T(viewport.transform, ctm);
              const p0 = applyPoint(M, x, y);
              const p1 = applyPoint(M, x + w, y + h);
              const rx = Math.min(p0.x, p1.x), ry = Math.min(p0.y, p1.y);
              const rw = Math.abs(p1.x - p0.x), rh = Math.abs(p1.y - p0.y);
              const asp = rw > rh ? rw / rh : rh / rw;
              const aRel = (rw * rh) / (viewport.width * viewport.height);
              if (rw >= 4 && rh >= 4 && asp <= 1.25 && aRel >= 0.00001 && aRel <= 0.12) {
                candidates.push({ x: rx, y: ry, w: rw, h: rh, score: 1 / (Math.abs(1 - asp) + 1e-3) + 0.5 });
              }
            } else { idx += op === "c" ? 6 : op === "v" || op === "y" ? 4 : 0; }
          }
          break;
        }
        case OPS.fill:
        case OPS.stroke:
        case OPS.fillStroke:
          if (path && path.length >= 4) pushRectFromPath(ctm);
          break;
        default: break;
      }
    }

    const roi = useROI ? roiByPage.get(pageNum) : null;
    let rects = candidates;
    if (roi) {
      const x2 = roi.x + roi.w, y2 = roi.y + roi.h;
      rects = rects.filter((r) => r.x >= roi.x && r.y >= roi.y && r.x + r.w <= x2 && r.y + r.h <= y2);
    }

    rects = nms(rects, 0.35).map((r, i) => ({
      x: r.x, y: r.y, w: r.w, h: r.h,
      id: `C${i + 1}`,
      type: r.type || "",  // NUEVO: campos editables
      note: r.note || "",
      color: r.color || "#6366f1",
      highlight: r.highlight ?? true
    }));

    columnsByPage.set(pageNum, rects);
    applyAutoColumnHighlights(pageNum, rects, { color: "#6366f1", alpha: highlightAlpha });

    const node = pageNodes.get(pageNum);
    if (node) {
      node.octx.clearRect(0, 0, node.overlay.width, node.overlay.height);
      drawRects(node.octx, rects, { fill: "rgba(99,102,241,.22)", stroke: "rgba(99,102,241,.95)" });
      drawColumnLabels(node.octx, rects);
      if (pageNum === activePage) renderAnnotations(pageNum);
    }
    const lbl = thumbs.querySelector(`[data-thumb-count="${pageNum}"]`);
    if (lbl) lbl.textContent = String(rects.length);
    renderCountsPanels();
    renderColumnEditor(); // NUEVO
    status(`Page ${pageNum}: ${rects.length} columns (squares)`);
    return rects;
  }

  function nms(rects, iouThr = 0.35) {
    if (!rects || !rects.length) return [];
    const arr = [...rects].sort((a, b) => (b.score || 0) - (a.score || 0));
    const out = [];
    for (const r of arr) if (!out.some((o) => iou(o, r) > iouThr)) out.push(r);
    return out;
  }
  function iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
    const inter = iw * ih; if (inter <= 0) return 0;
    const ua = a.w * a.h + b.w * b.h - inter;
    return inter / ua;
  }

  /* =========================
    ANOTACIONES
  ========================= */
  function ensureAnnoState(pageNum, w, h) {
    if (!annotationsByPage.has(pageNum)) annotationsByPage.set(pageNum, { items: [], undo: [], redo: [], dims: { w, h } });
  }
  function renderAnnotations(pageNum) {
    const node = pageNodes.get(pageNum);
    if (!node) return;
    const { ann, actx } = node;
    actx.clearRect(0, 0, ann.width, ann.height);
    const s = annotationsByPage.get(pageNum);
    if (!s) return;
    const baseW = s.dims?.w || ann.width, baseH = s.dims?.h || ann.height;
    const sx = baseW ? ann.width / baseW : 1, sy = baseH ? ann.height / baseH : 1;
    for (const it of s.items) drawAnnotation(actx, scaleAnno(it, sx, sy));
  }

  function scaleAnno(it, sx, sy) {
    const copy = JSON.parse(JSON.stringify(it));
    switch (it.type) {
      case "rect":
      case "highlight":
      case "ellipse":
        copy.x = it.x * sx; copy.y = it.y * sy; copy.w = it.w * sx; copy.h = it.h * sy; break;
      case "line":
      case "arrow":
      case "dblarrow":
      case "measure":
        copy.x1 = it.x1 * sx; copy.y1 = it.y1 * sy; copy.x2 = it.x2 * sx; copy.y2 = it.y2 * sy; break;
      case "pen":
        copy.points = it.points.map((p) => ({ x: p.x * sx, y: p.y * sy })); break;
      case "text":
        copy.x = it.x * sx; copy.y = it.y * sy; copy.size = it.size * (sx + sy) / 2; break;
    }
    if (copy.width) copy.width = Math.max(1, it.width * (sx + sy) / 2);
    return copy;
  }

  function drawAnnotation(ctx, it) {
    const col = it.color || strokeColor;
    const w = Math.max(1, it.width || strokeWidth);
    ctx.save();
    ctx.lineWidth = w;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const drawArrowHead = (x1, y1, x2, y2, size = Math.max(6, 4 + w * 1.5)) => {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const a = ang + Math.PI - Math.PI / 6;
      const b = ang + Math.PI + Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 + size * Math.cos(a), y2 + size * Math.sin(a));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 + size * Math.cos(b), y2 + size * Math.sin(b));
      ctx.stroke();
    };

    switch (it.type) {
      case "rect": { ctx.strokeRect(it.x + 0.5, it.y + 0.5, it.w, it.h); break; }
      case "ellipse": {
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(it.w / 2), Math.abs(it.h / 2), 0, 0, Math.PI * 2); ctx.stroke(); break;
      }
      case "line": { ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke(); break; }
      case "arrow": { ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke(); drawArrowHead(it.x1, it.y1, it.x2, it.y2); break; }
      case "dblarrow": { ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke(); drawArrowHead(it.x2, it.y2, it.x1, it.y1); drawArrowHead(it.x1, it.y1, it.x2, it.y2); break; }
      case "measure": {
        ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke();
        const len = Math.hypot(it.x2 - it.x1, it.y2 - it.y1);
        const midx = (it.x1 + it.x2) / 2, midy = (it.y1 + it.y2) / 2;
        const label = `${Math.round(len)} px`;
        ctx.font = `bold ${Math.max(10, (it.labelSize || 12))}px ui-sans-serif`;
        const pad = 4; const tw = ctx.measureText(label).width; const th = (it.labelSize || 12) + 6;
        ctx.fillStyle = "rgba(15,23,42,.9)"; ctx.strokeStyle = "rgba(100,116,139,.8)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(midx - tw / 2 - pad, midy - th / 2, tw + pad * 2, th); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#e5e7eb"; ctx.textBaseline = "middle"; ctx.fillText(label, midx - tw / 2, midy);
        break;
      }
      case "highlight": {
        const a = it.alpha ?? 0.25;
        ctx.fillStyle = hexToRgba(it.color || "#fbbf24", a);
        ctx.fillRect(it.x, it.y, it.w, it.h);
        ctx.strokeStyle = hexToRgba(it.color || "#fbbf24", Math.min(0.65, a + 0.25));
        ctx.strokeRect(it.x + 0.5, it.y + 0.5, it.w, it.h);
        break;
      }
      case "pen": {
        const pts = it.points || [];
        if (pts.length < 2) break;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke(); break;
      }
      case "text": {
        const fs = Math.max(8, it.size || 16);
        ctx.font = `${it.bold ? "bold " : ""}${fs}px ui-sans-serif`;
        ctx.fillStyle = it.color || "#e5e7eb";
        ctx.textBaseline = "top";
        const lines = String(it.text || "").split(/\r?\n/);
        const lh = Math.round(fs * 1.25);
        lines.forEach((ln, i) => ctx.fillText(ln, it.x, it.y + i * lh));
        break;
      }
    }
    ctx.restore();
  }

  function getAnnoBBox(it) {
    switch (it.type) {
      case "rect":
      case "highlight":
      case "ellipse": {
        const x = Math.min(it.x, it.x + it.w), y = Math.min(it.y, it.y + it.h);
        const w = Math.abs(it.w), h = Math.abs(it.h);
        return { x, y, w, h };
      }
      case "line":
      case "arrow":
      case "dblarrow":
      case "measure": {
        const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2);
        const w = Math.abs(it.x2 - it.x1), h = Math.abs(it.y2 - it.y1);
        return { x, y, w, h };
      }
      case "pen": {
        const xs = it.points.map((p) => p.x), ys = it.points.map((p) => p.y);
        const x = Math.min(...xs), y = Math.min(...ys);
        const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
        return { x, y, w, h };
      }
      case "text": {
        return { x: it.x, y: it.y, w: Math.max(40, (it.text?.length || 1) * (it.size || 16) * 0.6), h: (it.size || 16) * 1.6 };
      }
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const pointInRect = (px, py, r) => px >= r.x && py >= r.y && px <= r.x + r.w && py <= r.y + r.h;
  const rectContainsRect = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

  function distToSegment(px, py, x1, y1, x2, y2) {
    const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
    const dot = A * C + B * D;
    const len = C * C + D * D;
    let t = len ? dot / len : -1;
    t = Math.max(0, Math.min(1, t));
    const xx = x1 + t * C, yy = y1 + t * D;
    return Math.hypot(px - xx, py - yy);
  }
  function hitTest(it, px, py) {
    const bb = getAnnoBBox(it);
    const margin = Math.max(4, (it.width || 2) + 4);
    if (["rect", "highlight", "ellipse", "text"].includes(it.type)) {
      return pointInRect(px, py, { x: bb.x - margin, y: bb.y - margin, w: bb.w + margin * 2, h: bb.h + margin * 2 });
    }
    if (["line", "arrow", "dblarrow", "measure"].includes(it.type)) {
      return distToSegment(px, py, it.x1, it.y1, it.x2, it.y2) <= margin;
    }
    if (it.type === "pen") {
      for (let i = 1; i < it.points.length; i++) {
        if (distToSegment(px, py, it.points[i - 1].x, it.points[i - 1].y, it.points[i].x, it.points[i].y) <= margin) return true;
      }
      return false;
    }
    return false;
  }

  function attachAnnotationHandlers(pageNum) {
    const node = pageNodes.get(pageNum);
    if (!node) return;
    const { ann, actx } = node;

    let drawing = false;
    let start = { x: 0, y: 0 };
    let temp = null;
    let lastPt = null;

    const getPos = (e) => {
      const rect = ann.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, ann.width);
      const y = clamp(e.clientY - rect.top, 0, ann.height);
      return { x, y };
    };

    function commit(it) {
      if (!it) return;
      const s = annotationsByPage.get(pageNum);
      if (!s) return;
      s.undo.push(JSON.parse(JSON.stringify(s.items)));
      s.redo.length = 0;
      s.items.push(it);
      renderAnnotations(pageNum);
      renderCountsPanels();
    }

    function eraseAt(x, y) {
      const s = annotationsByPage.get(pageNum);
      if (!s || !s.items.length) return;
      const idx = [...s.items].reverse().findIndex((it) => hitTest(it, x, y));
      if (idx === -1) return;
      const realIndex = s.items.length - 1 - idx;
      s.undo.push(JSON.parse(JSON.stringify(s.items)));
      s.redo.length = 0;
      s.items.splice(realIndex, 1);
      renderAnnotations(pageNum);
      renderCountsPanels();
    }

    function eraseLasso(selRect) {
      const s = annotationsByPage.get(pageNum);
      if (!s || !s.items.length) return;
      const keep = s.items.filter((it) => !rectContainsRect(selRect, getAnnoBBox(it)));
      if (keep.length === s.items.length) return;
      s.undo.push(JSON.parse(JSON.stringify(s.items)));
      s.redo.length = 0;
      s.items = keep;
      renderAnnotations(pageNum);
      renderCountsPanels();
    }

    function redrawTemp() {
      renderAnnotations(pageNum);
      if (!temp) return;
      drawAnnotation(actx, temp);
    }

    ann.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const pos = getPos(e);
      start = pos;
      drawing = true;
      lastPt = pos;

      if (currentTool === "pen") {
        temp = { type: "pen", points: [pos], color: strokeColor, width: strokeWidth };
      } else if (currentTool === "rect") {
        temp = { type: "rect", x: pos.x, y: pos.y, w: 0, h: 0, color: strokeColor, width: strokeWidth };
      } else if (currentTool === "ellipse") {
        temp = { type: "ellipse", x: pos.x, y: pos.y, w: 0, h: 0, color: strokeColor, width: strokeWidth };
      } else if (currentTool === "line") {
        temp = { type: "line", x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color: strokeColor, width: strokeWidth };
      } else if (currentTool === "arrow") {
        temp = { type: "arrow", x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color: strokeColor, width: strokeWidth };
      } else if (currentTool === "dblarrow") {
        temp = { type: "dblarrow", x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color: strokeColor, width: strokeWidth };
      } else if (currentTool === "measure") {
        temp = { type: "measure", x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color: strokeColor, width: Math.max(2, strokeWidth), labelSize: Math.max(10, textSize) };
      } else if (currentTool === "highlight") {
        temp = { type: "highlight", x: pos.x, y: pos.y, w: 0, h: 0, color: strokeColor, alpha: highlightAlpha, width: 1 };
      } else if (currentTool === "erase") {
        eraseAt(pos.x, pos.y);
        drawing = false;
      } else if (currentTool === "lassoerase") {
        temp = { type: "rect", x: pos.x, y: pos.y, w: 0, h: 0, color: "#f87171", width: 1, _eraser: true };
      } else if (currentTool === "roi") {
        temp = { _roi: true, x: pos.x, y: pos.y, w: 0, h: 0 };
      } else if (currentTool === "text") {
        const txt = prompt("Texto:");
        if (txt && txt.trim()) { commit({ type: "text", x: pos.x, y: pos.y, text: txt.trim(), color: strokeColor, size: textSize }); }
        drawing = false;
      } else {
        drawing = false;
      }

      if (drawing) redrawTemp();
    });

    window.addEventListener("mousemove", (e) => {
      if (!drawing) return;
      const pos = getPos(e);
      if (!temp) return;

      if (temp.type === "pen") {
        if (Math.hypot(pos.x - lastPt.x, pos.y - lastPt.y) > 1.5) { temp.points.push(pos); lastPt = pos; }
      } else if (temp._roi) {
        temp.w = pos.x - start.x; temp.h = pos.y - start.y; renderOverlay(pageNum, temp);
      } else if (temp._eraser) {
        temp.w = pos.x - start.x; temp.h = pos.y - start.y;
      } else {
        if ("w" in temp) { temp.w = pos.x - start.x; temp.h = pos.y - start.y; }
        else if ("x2" in temp) { temp.x2 = pos.x; temp.y2 = pos.y; }
      }
      redrawTemp();
    });

    window.addEventListener("mouseup", () => {
      if (!drawing) return;
      drawing = false;
      const fin = temp;
      temp = null;

      if (!fin) return;

      if (fin._roi) {
        const x = Math.min(fin.x, fin.x + fin.w), y = Math.min(fin.y, fin.y + fin.h);
        const w = Math.abs(fin.w), h = Math.abs(fin.h);
        if (w >= 4 && h >= 4) {
          roiByPage.set(pageNum, { x, y, w, h });
          renderOverlay(pageNum);
          updateThumbROI(pageNum);
          status("ROI definida 🟩");
        } else { status("ROI ignorada (muy pequeña)"); }
        return;
      }

      if (fin._eraser) {
        const r = { x: Math.min(fin.x, fin.x + fin.w), y: Math.min(fin.y, fin.y + fin.h), w: Math.abs(fin.w), h: Math.abs(fin.h) };
        eraseLasso(r); renderAnnotations(pageNum); return;
      }

      if (["rect", "ellipse", "highlight"].includes(fin.type)) {
        const x = Math.min(fin.x, fin.x + fin.w), y = Math.min(fin.y, fin.y + fin.h);
        const w = Math.abs(fin.w), h = Math.abs(fin.h);
        if (w < 3 && h < 3) return;
        fin.x = x; fin.y = y; fin.w = w; fin.h = h;
      }
      if (["line", "arrow", "dblarrow", "measure"].includes(fin.type)) {
        if (Math.hypot(fin.x2 - fin.x1, fin.y2 - fin.y1) < 3) return;
      }
      if (fin.type === "pen") {
        if (!fin.points || fin.points.length < 2) return;
      }

      commit(fin);
    });
  }

  function renderOverlay(pageNum, tempROI = null) {
    const node = pageNodes.get(pageNum);
    if (!node) return;
    const { octx } = node;
    octx.clearRect(0, 0, node.overlay.width, node.overlay.height);

    const cols = columnsByPage.get(pageNum) || [];
    drawRects(octx, cols, { fill: "rgba(99,102,241,.22)", stroke: "rgba(99,102,241,.95)" });
    drawColumnLabels(octx, cols);

    const roi = tempROI?._roi
      ? { x: Math.min(tempROI.x, tempROI.x + tempROI.w), y: Math.min(tempROI.y, tempROI.y + tempROI.h), w: Math.abs(tempROI.w), h: Math.abs(tempROI.h) }
      : roiByPage.get(pageNum);

    if (roi) {
      octx.save();
      octx.strokeStyle = "rgba(16,185,129,.95)";
      octx.setLineDash([6, 4]);
      octx.lineWidth = 2;
      octx.strokeRect(roi.x, roi.y, roi.w, roi.h);
      octx.restore();
    }
  }

  function drawRects(ctx, rects, { fill = "rgba(99,102,241,.22)", stroke = "rgba(99,102,241,.95)" } = {}) {
    if (!rects || !rects.length) return;
    ctx.save();
    ctx.strokeStyle = stroke; ctx.fillStyle = fill; ctx.lineWidth = 2;
    for (const r of rects) { ctx.beginPath(); ctx.rect(r.x + 0.5, r.y + 0.5, r.w, r.h); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }

  function drawColumnLabels(ctx, rects) {
    if (!rects || !rects.length) return;
    ctx.save();
    ctx.font = "bold 12px ui-sans-serif";
    ctx.textBaseline = "top";
    for (const r of rects) {
      const label = String(r.id || "");
      if (!label) continue;
      const pad = 4;
      const extra = r.type ? ` · ${r.type}` : "";
      const txt = label + extra;
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = "rgba(15,23,42,.9)";
      ctx.strokeStyle = "rgba(100,116,139,.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(r.x + 6, r.y + 6, tw + pad * 2, 18);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#e5e7eb";
      ctx.fillText(txt, r.x + 6 + pad, r.y + 6 + 3);
    }
    ctx.restore();
  }

  function applyAutoColumnHighlights(_pageNum, _rects, _opt) {
    // Overlay ya pinta columnas + labels; mantenemos hook para futuras automatizaciones.
  }

  function focusColumn(pageNum, id) {
    const rects = columnsByPage.get(pageNum) || [];
    const target = rects.find((r) => String(r.id) === String(id));
    if (!target) return;
    if (activePage !== pageNum) showPage(pageNum);
    const wrap = viewerWrap;
    const node = pageNodes.get(pageNum);
    if (!node) return;
    const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
    const tx = Math.max(0, cx - wrap.clientWidth / 2), ty = Math.max(0, cy - wrap.clientHeight / 2);
    smoothScrollTo(wrap, tx, ty, 240);

    const ctx = node.octx;
    ctx.save();
    ctx.strokeStyle = "rgba(34,197,94,1)";
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(target.x, target.y, target.w, target.h);
    setTimeout(() => renderOverlay(pageNum), 350);
    ctx.restore();
  }

  /* =========================
     UNDO / REDO / CLEAR
  ========================= */
  btnUndo.addEventListener("click", () => {
    const s = annotationsByPage.get(activePage);
    if (!s || !s.undo.length) return;
    s.redo.push(JSON.parse(JSON.stringify(s.items)));
    s.items = s.undo.pop() || [];
    renderAnnotations(activePage);
    renderCountsPanels();
  });
  btnRedo.addEventListener("click", () => {
    const s = annotationsByPage.get(activePage);
    if (!s || !s.redo.length) return;
    s.undo.push(JSON.parse(JSON.stringify(s.items)));
    s.items = s.redo.pop() || [];
    renderAnnotations(activePage);
    renderCountsPanels();
  });
  btnClear.addEventListener("click", () => {
    const s = annotationsByPage.get(activePage);
    if (!s) return;
    if (!confirm("Clear all annotations on this page?")) return;
    s.undo.push(JSON.parse(JSON.stringify(s.items)));
    s.redo.length = 0;
    s.items = [];
    renderAnnotations(activePage);
    renderCounts
        renderAnnotations(activePage);
    renderCountsPanels();
  });

  /* =========================
     SAVE JSON / EXPORT
  ========================= */
  btnSaveJSON.addEventListener("click", () => {
    try {
      const payload = serializeProject();
      const name = (currentProject || "project") + "-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      status("Proyecto exportado a JSON ✅");
    } catch (e) {
      console.error(e);
      status("Error al exportar JSON 😿");
    }
  });

  btnExportPNG.addEventListener("click", async () => {
    if (!pdfDoc) return;
    try {
      const c = await mergePageToCanvas(activePage);
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `bp-page-${activePage}.png`;
      a.click();
      status("PNG exportado ✅");
    } catch (e) {
      console.error(e);
      status("Error al exportar PNG 😿");
    }
  });

  btnExportPDF.addEventListener("click", async () => {
    if (!pdfDoc || !jsPDFReady) { status("jsPDF no disponible"); return; }
    try {
      const { jsPDF } = window.jspdf;
      let doc;
      const pagesToExport = selectedPages.size ? [...selectedPages] : Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);

      for (let i = 0; i < pagesToExport.length; i++) {
        const p = pagesToExport[i];
        const canvas = await mergePageToCanvas(p);
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        // Tamaño: ajustamos a puntos A4 según orientación de la página renderizada
        const isLandscape = canvas.width > canvas.height;
        const pageW = isLandscape ? 297 : 210; // mm
        const pageH = isLandscape ? 210 : 297; // mm
        if (!doc) doc = new jsPDF({ orientation: isLandscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
        else doc.addPage(undefined, isLandscape ? "landscape" : "portrait");

        const margin = 5; // mm
        const maxW = pageW - margin * 2, maxH = pageH - margin * 2;
        const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
        const w = canvas.width * ratio, h = canvas.height * ratio;
        const x = (pageW - w) / 2, y = (pageH - h) / 2;
        doc.addImage(imgData, "JPEG", x, y, w, h);
      }

      const name = (currentProject || "bp") + "-" + new Date().toISOString().slice(0, 10) + ".pdf";
      doc.save(name);
      status("PDF exportado ✅");
    } catch (e) {
      console.error(e);
      status("Error al exportar PDF 😿");
    }
  });

  async function mergePageToCanvas(pageNum) {
    const node = pageNodes.get(pageNum);
    if (!node) throw new Error("Página no renderizada");
    // Aseguramos que la página esté dibujada con el scale actual
    await renderSinglePage(pageNum, { remeasure: false });

    const off = document.createElement("canvas");
    off.width = node.canvas.width;
    off.height = node.canvas.height;
    const ctx = off.getContext("2d");

    // Orden: base PDF -> overlay (columnas + ROI) -> annotations
    ctx.drawImage(node.canvas, 0, 0);
    ctx.drawImage(node.overlay, 0, 0);
    ctx.drawImage(node.ann, 0, 0);
    return off;
  }

  /* =========================
     EDITOR DE COLUMNAS (NUEVO)
  ========================= */
  btnAnnotateAll.addEventListener("click", () => {
    const cols = columnsByPage.get(activePage) || [];
    if (!cols.length) { status("No hay columnas para anotar"); return; }
    const s = annotationsByPage.get(activePage);
    if (!s) return;
    s.undo.push(JSON.parse(JSON.stringify(s.items)));
    s.redo.length = 0;

    const addHL = chkAutoHighlight.checked;
    for (const r of cols) {
      const label = [r.id, r.type].filter(Boolean).join(" · ");
      // Texto en esquina superior-izquierda de cada columna
      s.items.push({
        type: "text",
        x: r.x + 8,
        y: r.y + 8,
        text: label || String(r.id || ""),
        color: r.color || "#e5e7eb",
        size: Math.max(11, Math.round(12 * (RENDER_SCALE / BASE_RENDER_SCALE)))
      });
      if (addHL || r.highlight) {
        s.items.push({
          type: "highlight",
          x: r.x, y: r.y, w: r.w, h: r.h,
          color: r.color || "#6366f1",
          alpha: highlightAlpha,
          width: 1
        });
      }
    }
    renderAnnotations(activePage);
    renderCountsPanels();
    status("Columnas anotadas ✅");
  });

  chkAutoHighlight.addEventListener("change", () => {
    // no-op; se usa al anotar
  });

  function renderColumnEditor() {
    const cols = columnsByPage.get(activePage) || [];
    if (!cols.length) {
      colEditorBox.innerHTML = `<div class="text-slate-400 text-sm px-1 py-2">No hay columnas detectadas.</div>`;
      return;
    }
    colEditorBox.innerHTML = cols
      .map((c, i) => {
        const id = escapeHTML(c.id || `C${i + 1}`);
        const type = escapeHTML(c.type || "");
        const note = escapeHTML(c.note || "");
        const color = escapeHTML(c.color || "#6366f1");
        const checked = c.highlight ? "checked" : "";
        return `
          <div class="border border-slate-700 rounded p-2">
            <div class="flex items-center gap-2">
              <label class="text-xs w-14">ID</label>
              <input data-ed="id" data-i="${i}" class="bp-btn w-28" value="${id}" />
              <label class="text-xs w-14">Tipo</label>
              <input data-ed="type" data-i="${i}" class="bp-btn flex-1" placeholder="ej: square, column, ref" value="${type}" />
            </div>
            <div class="mt-2 flex items-center gap-2">
              <label class="text-xs w-14">Nota</label>
              <input data-ed="note" data-i="${i}" class="bp-btn flex-1" placeholder="nota breve…" value="${note}" />
            </div>
            <div class="mt-2 flex items-center gap-3">
              <label class="text-xs">Color
                <input type="color" data-ed="color" data-i="${i}" value="${color}" class="ml-1 h-7 w-10 align-middle border border-slate-700 rounded bg-slate-900"/>
              </label>
              <label class="text-xs bp-switch"><input type="checkbox" data-ed="highlight" data-i="${i}" ${checked}> Resaltar</label>
              <button class="bp-btn text-xs ml-auto" data-ed="focus" data-i="${i}">Ver</button>
            </div>
          </div>
        `;
      })
      .join("");

    colEditorBox.querySelectorAll("[data-ed]").forEach((el) => {
      el.addEventListener("input", onEditColumnField);
      el.addEventListener("change", onEditColumnField);
      if (el.dataset.ed === "focus") {
        el.addEventListener("click", () => {
          const i = +el.dataset.i;
          const c = (columnsByPage.get(activePage) || [])[i];
          if (c) focusColumn(activePage, c.id || `C${i + 1}`);
        });
      }
    });
  }

  function onEditColumnField(ev) {
    const el = ev.currentTarget;
    const idx = +el.dataset.i;
    const key = el.dataset.ed;
    const cols = columnsByPage.get(activePage) || [];
    const c = cols[idx];
    if (!c) return;

    if (key === "id") c.id = String(el.value).trim();
    else if (key === "type") c.type = String(el.value).trim();
    else if (key === "note") c.note = String(el.value).trim();
    else if (key === "color") c.color = String(el.value || "#6366f1");
    else if (key === "highlight") c.highlight = !!el.checked;

    // Redibujar overlay (labels usan id + type) y thumbnails
    const node = pageNodes.get(activePage);
    if (node) {
      node.octx.clearRect(0, 0, node.overlay.width, node.overlay.height);
      drawRects(node.octx, cols, { fill: "rgba(99,102,241,.22)", stroke: "rgba(99,102,241,.95)" });
      drawColumnLabels(node.octx, cols);
    }
  }

  /* =========================
     UTILS
  ========================= */
  async function ensureScript(url) {
    if (!url) throw new Error("URL de script inválida");
    // ¿ya cargado?
    if ([...document.scripts].some((s) => s.src === url)) return;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = res;
      s.onerror = () => rej(new Error("Error cargando " + url));
      document.head.appendChild(s);
    });
  }
}
