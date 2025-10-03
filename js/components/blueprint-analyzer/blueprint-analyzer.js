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
  let zoomLocked = false; // NUEVO: controlar bloqueo de zoom
  let manualCountMode = false; // NUEVO: modo conteo manual
  let deleteMode = false; // NUEVO: modo eliminación manual
  let hasDetectionRun = false; // NUEVO: controlar si se ha ejecutado detección

  // Estado de documento
  let pdfDoc = null;
  let pdfArrayBuffer = null;
  let jsPDFReady = false;
  let activePage = 1;

  // Mapa por página
  const pageNodes = new Map();         // {wrapper, canvas, overlay, ann, octx, actx, viewport}
  const annotationsByPage = new Map(); // { items, undo, redo, dims }
  const columnsByPage = new Map();     // [{x,y,w,h,id,type,note,color,highlight}]
  const detectedColumns = [];          // Array for new table modal system
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
  .cursor-manual-count{ cursor: crosshair !important; }
  .cursor-delete{ cursor: pointer !important; }
  .bp-btn.locked{ background: #ef4444; color: white; border-color: #ef4444; }
  .bp-btn.active-manual{ background: #10b981; color: white; border-color: #10b981; }
  .bp-btn.active-delete{ background: #dc2626; color: white; border-color: #dc2626; }
  .bp-page-wrap{ position:relative; display:inline-block; }
  .bp-stage{ position:relative; width:max-content; height:max-content; }
  .ruler-x,.ruler-y{ position:sticky; background:#0b1220; z-index:4; color:#64748b; font: 10px ui-sans-serif; }
  .ruler-x{ top:0; height:20px; border-bottom:1px solid var(--c-border); }
  .ruler-y{ left:0; width:28px; border-right:1px solid var(--c-border); }
  .grid-canvas{ position:absolute; inset:0; pointer-events:none; opacity:.25 }

  /* ===== Drop Zone Styles ===== */
  .bp-drop-zone{
    transition: all 0.3s ease;
    background: linear-gradient(135deg, rgba(15,23,42,0.8), rgba(30,41,59,0.8));
  }
  .bp-drop-zone:hover{
    background: linear-gradient(135deg, rgba(30,41,59,0.9), rgba(51,65,85,0.9));
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  .bp-drop-zone.dragover{
    border-color: #6366f1 !important;
    background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1));
    transform: scale(1.02);
  }
  .bp-file-info{
    animation: slideIn 0.3s ease-out;
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .bp-processing{
    position: relative;
    overflow: hidden;
  }
  .bp-processing::after{
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(99,102,241,0.3), transparent);
    animation: shimmer 1.5s infinite;
  }
  @keyframes shimmer {
    to { left: 100%; }
  }
  .bp-empty-state{
    backdrop-filter: blur(2px);
    background: rgba(11,18,32,0.8);
  }
  /* ===== Sistema de Modales Optimizado ===== */
  .bp-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s ease;
  }
  .bp-modal.show {
    opacity: 1;
    visibility: visible;
  }
  .bp-modal-content {
    background: var(--c-srf);
    border: 1px solid var(--c-border);
    border-radius: 12px;
    padding: 1.5rem;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    transform: scale(0.9);
    transition: transform 0.2s ease;
  }
  .bp-modal.show .bp-modal-content {
    transform: scale(1);
  }
  .bp-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--c-border);
  }
  .bp-modal-close {
    background: none;
    border: none;
    color: var(--c-dim);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
  }
  .bp-modal-close:hover {
    background: var(--c-border);
    color: var(--c-text);
  }
  
  /* ===== Tabla de Columnas Estilo BEAM ===== */
  .bp-columns-table {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  .bp-columns-table th {
    background: var(--c-bg);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 0.75rem;
  }
  .bp-columns-table td {
    vertical-align: middle;
  }
  .bp-columns-table tr:hover {
    background: rgba(99, 102, 241, 0.05);
  }
  .bp-columns-table input[type="text"],
  .bp-columns-table select {
    font-size: 0.875rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--c-text);
    transition: all 0.2s ease;
    width: 100%;
  }
  .bp-columns-table input[type="text"]:focus,
  .bp-columns-table select:focus {
    outline: none;
    border-color: var(--brand);
    background: var(--c-bg);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
  }
  .bp-columns-table input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--brand);
  }
  .bp-columns-table button {
    padding: 0.25rem;
    border-radius: 4px;
    border: 1px solid var(--c-border);
    background: var(--c-bg);
    color: var(--c-text);
    cursor: pointer;
    transition: all 0.2s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .bp-columns-table button:hover {
    background: var(--brand);
    color: white;
    border-color: var(--brand);
  }
  
  /* ===== Modal de Tabla Grande ===== */
  .bp-modal[data-role="columns-table-modal"] .bp-modal-content {
    max-width: 1200px;
    max-height: 85vh;
    padding: 0;
    overflow: hidden;
  }
  .bp-modal[data-role="columns-table-modal"] .bp-modal-header {
    padding: 1.5rem;
    margin-bottom: 0;
    border-bottom: 1px solid var(--c-border);
    background: linear-gradient(135deg, var(--c-bg) 0%, var(--c-srf) 100%);
  }
  .bp-modal[data-role="columns-table-modal"] .bp-modal-close {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--c-border);
    background: var(--c-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: bold;
  }
  .bp-modal[data-role="columns-table-modal"] .bp-modal-close:hover {
    background: var(--bad);
    color: white;
    border-color: var(--bad);
    transform: scale(1.1);
  }
  
  /* Modal específicos */
  .bp-column-form {
    display: grid;
    gap: 1rem;
  }
  .bp-form-group {
    display: grid;
    gap: 0.5rem;
  }
  .bp-form-label {
    font-size: 0.85rem;
    color: var(--c-dim);
    font-weight: 500;
  }
  .bp-form-input {
    background: var(--c-bg);
    border: 1px solid var(--c-border);
    border-radius: 6px;
    padding: 0.5rem;
    color: var(--c-text);
    font-size: 0.9rem;
  }
  .bp-form-input:focus {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
  }
  .bp-form-textarea {
    min-height: 80px;
    resize: vertical;
  }
  .bp-form-select {
    background: var(--c-bg);
    border: 1px solid var(--c-border);
    border-radius: 6px;
    padding: 0.5rem;
    color: var(--c-text);
    cursor: pointer;
  }
  
  /* Progress específico */
  .bp-progress-content {
    text-align: center;
    padding: 2rem 1rem;
  }
  .bp-crane-emoji {
    font-size: 3rem;
    animation: craneWork 2s ease-in-out infinite;
    margin-bottom: 1rem;
  }
  @keyframes craneWork {
    0%, 100% { transform: rotate(-5deg) scale(1); }
    50% { transform: rotate(5deg) scale(1.1); }
  }
  .bp-progress-bar {
    width: 100%;
    height: 6px;
    background: var(--c-border);
    border-radius: 3px;
    overflow: hidden;
    margin: 1rem 0;
  }
  .bp-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--brand), #8b5cf6);
    border-radius: 3px;
    width: 0%;
    transition: width 0.3s ease;
  }

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
            <button class="bp-btn brand flex items-center gap-2" data-role="cv">
              <span>🔍</span>
              <span>Detectar Columnas</span>
            </button>
            <button class="bp-btn flex items-center gap-1" data-role="dataset-config">
              <span>⚙️</span>
              <span class="hidden md:inline">Config</span>
            </button>
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
            
            <!-- NUEVA ZONA DE CARGA DE DOCUMENTOS -->
            <div data-role="upload-section">
              <div class="text-xs text-slate-400 mb-2">Cargar Plano</div>
              <div data-role="drop-zone" class="bp-drop-zone border-2 border-dashed border-slate-600 rounded-lg p-4 text-center cursor-pointer">
                <div class="space-y-2">
                  <div class="text-3xl">📋</div>
                  <div class="text-sm text-slate-300 font-medium">Arrastra tu PDF aquí</div>
                  <div class="text-xs text-slate-400">o haz click para seleccionar</div>
                  <div class="text-xs text-slate-500">Formatos soportados: PDF</div>
                </div>
                <input type="file" accept="application/pdf" data-role="pdf-input-hidden" class="hidden" />
              </div>
              
              <!-- Información del archivo cargado -->
              <div data-role="file-info" class="bp-file-info hidden mt-2 p-3 bg-slate-800/50 rounded border border-slate-700">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="w-2 h-2 bg-green-400 rounded-full"></div>
                    <span class="text-sm font-medium text-slate-200" data-role="file-name">archivo.pdf</span>
                  </div>
                  <button data-role="remove-file" class="text-slate-400 hover:text-red-400 text-sm">✕</button>
                </div>
                <div class="text-xs text-slate-400 mt-1">
                  <span data-role="file-size">1.2 MB</span> • 
                  <span data-role="file-pages">5 páginas</span>
                </div>
              </div>
            </div>
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
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <button data-role="open-columns-table" class="bp-btn brand text-sm" style="display: flex; align-items: center; gap: 0.5rem;">
                    <span>📊</span>
                    <span>Manage Columns</span>
                  </button>
                  <span data-role="quick-count" class="text-xs text-slate-400">0 detected</span>
                </div>
                <ul data-role="col-list" class="text-sm border border-slate-700 rounded p-2 space-y-1 max-h-56 overflow-auto"></ul>
              </div>
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
              <button data-role="lock-zoom" class="bp-btn" title="Bloquear/Desbloquear Zoom">🔓</button>
              <button data-role="manual-count" class="bp-btn" title="Conteo Manual de Columnas">👆</button>
              <button data-role="delete-mode" class="bp-btn" title="Eliminar Columnas Manualmente">🗑️</button>
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
            <!-- Estado vacío -->
            <div data-role="empty-state" class="absolute inset-0 flex items-center justify-center">
              <div class="text-center space-y-4">
                <div class="text-6xl text-slate-600">🏗️</div>
                <div class="text-xl text-slate-400 font-medium">No hay plano cargado</div>
                <div class="text-sm text-slate-500">Carga un archivo PDF para comenzar el análisis</div>
                <div class="text-xs text-slate-600">
                  El algoritmo identificará automáticamente las columnas en tu plano
                </div>
              </div>
            </div>
            
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
            <button data-role="detect-roi" class="ml-auto bp-btn brand text-sm">🎯 Detectar en Área</button>
          </div>
          <div class="flex-1 overflow-auto p-2"><div data-role="thumbs"></div></div>
        </section>
      </main>
      
      <!-- Modales del Sistema -->
      <!-- Modal de Progreso -->
      <div class="bp-modal" data-role="progress-modal">
        <div class="bp-modal-content">
          <div class="bp-progress-content">
            <div class="bp-crane-emoji">🏗️</div>
            <h3 style="margin: 0 0 0.5rem; color: var(--c-text);" data-role="progress-title">Analizando Plano</h3>
            <p style="margin: 0 0 1rem; color: var(--c-dim); font-size: 0.9rem;" data-role="progress-text">Iniciando...</p>
            <div class="bp-progress-bar">
              <div class="bp-progress-fill" data-role="progress-fill"></div>
            </div>
            <div style="font-size: 0.8rem; color: var(--c-dim);" data-role="progress-percent">0%</div>
          </div>
        </div>
      </div>
      
      <!-- Modal de Gestión de Columnas -->
      <div class="bp-modal" data-role="columns-table-modal">
        <div class="bp-modal-content" style="max-width: 1200px; max-height: 85vh;">
          <div class="bp-modal-header">
            <div>
              <h3 style="margin: 0; color: var(--c-text); display: flex; align-items: center; gap: 0.5rem;">
                <span>📊</span>
                <span>Column Features</span>
                <span style="background: var(--c-border); color: var(--c-dim); padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.8rem;" data-role="columns-count">Total: 0</span>
              </h3>
              <p style="margin: 0.5rem 0 0; color: var(--c-dim); font-size: 0.9rem;">Página <span data-role="active-page-num">1</span> - Gestión de columnas detectadas</p>
            </div>
            <button class="bp-modal-close" data-role="close-columns-modal">×</button>
          </div>
          
          <!-- Toolbar -->
          <div style="display: flex; gap: 1rem; margin-bottom: 1rem; padding: 1rem; background: var(--c-bg); border-radius: 8px; border: 1px solid var(--c-border);">
            <div style="display: flex; gap: 0.5rem;">
              <button class="bp-btn brand" data-role="add-column" style="display: flex; align-items: center; gap: 0.5rem;">
                <span>+</span>
                <span>Add Column</span>
              </button>
              <button class="bp-btn" data-role="sync-columns" style="display: flex; align-items: center; gap: 0.5rem;" title="Sincronizar columnas">
                <span>🔄</span>
                <span>Sync</span>
              </button>
              <button class="bp-btn" data-role="export-columns" style="display: flex; align-items: center; gap: 0.5rem;">
                <span>📤</span>
                <span>Export</span>
              </button>
              <button class="bp-btn" data-role="import-columns" style="display: flex; align-items: center; gap: 0.5rem;">
                <span>📥</span>
                <span>Import</span>
              </button>
            </div>
            <div style="margin-left: auto; display: flex; align-items: center; gap: 0.5rem;">
              <input type="text" placeholder="Search columns..." class="bp-form-input" data-role="column-search" style="width: 200px;">
              <select class="bp-form-select" data-role="filter-type" style="width: 150px;">
                <option value="">All Types</option>
                <option value="structural">Structural</option>
                <option value="decorative">Decorative</option>
                <option value="support">Support</option>
                <option value="pillar">Pillar</option>
                <option value="custom">Custom</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>
          
          <!-- Tabla de Columnas -->
          <div style="overflow: auto; max-height: 50vh; border: 1px solid var(--c-border); border-radius: 8px;">
            <table class="bp-columns-table" style="width: 100%; border-collapse: collapse; background: var(--c-srf);">
              <thead style="position: sticky; top: 0; background: var(--c-bg); border-bottom: 2px solid var(--c-border); z-index: 10;">
                <tr>
                  <th style="padding: 0.75rem; text-align: left; font-size: 0.85rem; color: var(--c-dim); border-right: 1px solid var(--c-border); width: 40px;">
                    <input type="checkbox" data-role="select-all-columns" style="margin: 0;">
                  </th>
                  <th style="padding: 0.75rem; text-align: left; font-size: 0.85rem; color: var(--c-dim); border-right: 1px solid var(--c-border); min-width: 120px;">Column ID</th>
                  <th style="padding: 0.75rem; text-align: left; font-size: 0.85rem; color: var(--c-dim); border-right: 1px solid var(--c-border); min-width: 100px;">Type</th>
                  <th style="padding: 0.75rem; text-align: left; font-size: 0.85rem; color: var(--c-dim); border-right: 1px solid var(--c-border); min-width: 200px;">Description</th>
                  <th style="padding: 0.75rem; text-align: left; font-size: 0.85rem; color: var(--c-dim); border-right: 1px solid var(--c-border); min-width: 120px;">Dimensions</th>
                  <th style="padding: 0.75rem; text-align: left; font-size: 0.85rem; color: var(--c-dim); border-right: 1px solid var(--c-border); min-width: 100px;">Position</th>
                  <th style="padding: 0.75rem; text-align: left; font-size: 0.85rem; color: var(--c-dim); border-right: 1px solid var(--c-border); min-width: 80px;">Confidence</th>
                  <th style="padding: 0.75rem; text-align: left; font-size: 0.85rem; color: var(--c-dim); border-right: 1px solid var(--c-border); min-width: 100px;">Material</th>
                  <th style="padding: 0.75rem; text-align: left; font-size: 0.85rem; color: var(--c-dim); border-right: 1px solid var(--c-border); min-width: 80px;">Unit</th>
                  <th style="padding: 0.75rem; text-align: center; font-size: 0.85rem; color: var(--c-dim); width: 100px;">Actions</th>
                </tr>
              </thead>
              <tbody data-role="columns-table-body" style="font-size: 0.9rem;">
                <!-- Filas generadas dinámicamente -->
              </tbody>
            </table>
          </div>
          
          <!-- Footer con estadísticas -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; padding: 0.75rem; background: var(--c-bg); border-radius: 8px; border: 1px solid var(--c-border);">
            <div style="display: flex; gap: 2rem; font-size: 0.85rem; color: var(--c-dim);">
              <span>Selected: <strong data-role="selected-count">0</strong></span>
              <span>Total: <strong data-role="total-count">0</strong></span>
              <span>Structural: <strong data-role="structural-count">0</strong></span>
              <span>Decorative: <strong data-role="decorative-count">0</strong></span>
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <button class="bp-btn" data-role="bulk-edit" disabled>Bulk Edit</button>
              <button class="bp-btn" data-role="delete-selected" disabled style="color: var(--bad);">Delete Selected</button>
              <button class="bp-btn brand" data-role="save-columns">Save Changes</button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Modal de Dataset/YOLO -->
      <div class="bp-modal" data-role="dataset-modal">
        <div class="bp-modal-content" style="max-width: 600px;">
          <div class="bp-modal-header">
            <h3 style="margin: 0; color: var(--c-text);">Configuración de Detección</h3>
            <button class="bp-modal-close" data-role="close-dataset-modal">×</button>
          </div>
          <div style="display: grid; gap: 1rem; max-height: 60vh; overflow-y: auto; padding-right: 0.5rem;">
            
            <!-- Configuración básica -->
            <div class="bp-form-group">
              <label class="bp-form-label">Modelo de Detección</label>
              <select class="bp-form-select" data-role="detection-model">
                <option value="vectorial">Vectorial - Cuadradito con Cerebro 🧠</option>
              </select>
            </div>
            <div class="bp-form-group">
              <label class="bp-form-label">Precisión Mínima (%)</label>
              <input type="range" min="30" max="99" value="85" class="bp-form-input" data-role="confidence-threshold">
              <span style="font-size: 0.8rem; color: var(--c-dim);" data-role="confidence-value">85%</span>
            </div>
            
            <!-- Configuración avanzada del algoritmo vectorial -->
            <div style="border-top: 1px solid var(--c-border); padding-top: 1rem; margin-top: 0.5rem;">
              <h4 style="margin: 0 0 1rem 0; color: var(--c-text); font-size: 0.9rem;">Parámetros Avanzados (Algoritmo Vectorial)</h4>
              
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="bp-form-group">
                  <label class="bp-form-label">Tolerancia Angular (°)</label>
                  <input type="number" min="5" max="30" value="12" class="bp-form-input" data-role="angular-tolerance">
                  <span style="font-size: 0.75rem; color: var(--c-dim);">Para detectar cuadrados</span>
                </div>
                <div class="bp-form-group">
                  <label class="bp-form-label">Lado Mínimo (px)</label>
                  <input type="number" min="5" max="100" value="12" class="bp-form-input" data-role="min-side-length">
                  <span style="font-size: 0.75rem; color: var(--c-dim);">Tamaño mínimo</span>
                </div>
              </div>
              
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="bp-form-group">
                  <label class="bp-form-label">Corte Derecho (%)</label>
                  <input type="number" min="0" max="40" value="12" class="bp-form-input" data-role="right-cut-percent">
                  <span style="font-size: 0.75rem; color: var(--c-dim);">Evitar rótulos</span>
                </div>
                <div class="bp-form-group">
                  <label class="bp-form-label">Corte Superior (%)</label>
                  <input type="number" min="0" max="40" value="6" class="bp-form-input" data-role="top-cut-percent">
                  <span style="font-size: 0.75rem; color: var(--c-dim);">Evitar headers</span>
                </div>
              </div>
              
              <div class="bp-form-group">
                <label class="bp-form-label">Relación Cuadrado Mínima</label>
                <input type="range" min="0.5" max="1.0" step="0.01" value="0.70" class="bp-form-input" data-role="square-ratio-min">
                <span style="font-size: 0.8rem; color: var(--c-dim);" data-role="square-ratio-value">0.70</span>
              </div>
              
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="bp-form-group">
                  <label class="bp-form-label">Longitud Grilla (%)</label>
                  <input type="number" min="5" max="40" value="10" class="bp-form-input" data-role="grid-length-percent">
                  <span style="font-size: 0.75rem; color: var(--c-dim);">Ejes estructurales</span>
                </div>
                <div class="bp-form-group">
                  <label class="bp-form-label">Tolerancia Grilla (px)</label>
                  <input type="number" min="4" max="30" value="10" class="bp-form-input" data-role="grid-tolerance">
                  <span style="font-size: 0.75rem; color: var(--c-dim);">Clustering ejes</span>
                </div>
              </div>
              
              <div class="bp-form-group">
                <label class="bp-form-label">Radio Búsqueda (× lado)</label>
                <input type="range" min="1.0" max="4.0" step="0.1" value="2.2" class="bp-form-input" data-role="radius-multiplier">
                <span style="font-size: 0.8rem; color: var(--c-dim);" data-role="radius-multiplier-value">2.2</span>
              </div>
            </div>
            
            <!-- Dataset personalizado -->
            <div style="border-top: 1px solid var(--c-border); padding-top: 1rem;">
              <div class="bp-form-group">
                <label class="bp-form-label">Dataset Personalizado</label>
                <input type="file" accept=".json,.yaml,.txt" class="bp-form-input" data-role="custom-dataset">
                <span style="font-size: 0.8rem; color: var(--c-dim);">Formatos: JSON, YAML, TXT</span>
              </div>
            </div>
            
            <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
              <button type="button" class="bp-btn brand" data-role="apply-detection-config" style="flex: 1;">Aplicar</button>
              <button type="button" class="bp-btn" data-role="cancel-detection-config" style="flex: 1;">Cancelar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  /* =========================
     DOM refs
  ========================= */
  const pdfInput = $("[data-role='pdf-input']");
  const pdfInputHidden = $("[data-role='pdf-input-hidden']");
  const dropZone = $("[data-role='drop-zone']");
  const fileInfo = $("[data-role='file-info']");
  const fileName = $("[data-role='file-name']");
  const fileSize = $("[data-role='file-size']");
  const filePages = $("[data-role='file-pages']");
  const removeFileBtn = $("[data-role='remove-file']");
  const btnDetect = $("[data-role='cv']");
  const btnDetectROI = $("[data-role='detect-roi']");
  const btnDatasetConfig = $("[data-role='dataset-config']");
  const statusEl = $("[data-role='status']");
  const progressEl = $("[data-role='progress']");
  const colTotalEl = $("[data-role='col-total']");
  const countColsBody = $("[data-role='count-cols']");
  const countAnnBody = $("[data-role='count-ann']");
  const viewerWrap = $("[data-role='viewer-wrap']");
  const viewer = $("[data-role='viewer']");
  const stage = $("[data-role='stage']");
  const emptyState = $("[data-role='empty-state']");
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
  const btnLockZoom = $("[data-role='lock-zoom']");
  const btnManualCount = $("[data-role='manual-count']");
  const btnDeleteMode = $("[data-role='delete-mode']");
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
  
  // Modal de progreso
  const progressModal = $("[data-role='progress-modal']");
  const progressText = $("[data-role='progress-text']");
  const progressFill = $("[data-role='progress-fill']");
  const progressPercent = $("[data-role='progress-percent']");
  
  // Modal de columna
  const columnModal = $("[data-role='column-modal']");
  const columnForm = $("[data-role='column-form']");
  const columnId = $("[data-role='column-id']");
  const columnType = $("[data-role='column-type']");
  const columnNotes = $("[data-role='column-notes']");
  const columnColor = $("[data-role='column-color']");
  const closeColumnModal = $("[data-role='close-column-modal']");
  const cancelColumnEdit = $("[data-role='cancel-column-edit']");
  
  // Modal de dataset/YOLO
  const datasetModal = $("[data-role='dataset-modal']");
  const detectionModel = $("[data-role='detection-model']");
  const confidenceThreshold = $("[data-role='confidence-threshold']");
  const confidenceValue = $("[data-role='confidence-value']");
  const customDataset = $("[data-role='custom-dataset']");
  const applyDetectionConfig = $("[data-role='apply-detection-config']");
  const cancelDetectionConfig = $("[data-role='cancel-detection-config']");
  const closeDatasetModal = $("[data-role='close-dataset-modal']");

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
  /* =========================
     CONFIGURACIÓN YOLO v8 Y DATASET
  ========================= */
  
  // Configuración de detección
  let detectionConfig = {
    model: 'vectorial', // 'vectorial', 'yolo8', 'hybrid'
    confidence: 0.85,
    customDataset: null,
    yoloModelPath: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/model.json',
    
    // Parámetros del algoritmo "cuadradito con cerebro"
    angularTolerance: 12,      // Tolerancia angular para detectar cuadrados (grados)
    minSideLength: 12,         // Mínimo lado en pixels
    rightCutPercent: 12,       // Ignorar % derecho (evitar rótulos)
    topCutPercent: 6,          // Corte superior % (evitar headers)
    squareRatioMin: 0.70,      // Relación mínima cuadrado (min/max)
    gridLengthPercent: 10,     // Longitud mínima ejes de grilla (% ancho/alto)
    gridTolerance: 10,         // Tolerancia cluster ejes (px)
    radiusMultiplier: 2.2,     // Radio búsqueda grilla (× lado)
    
    datasetConfig: {
      columns: {
        structural: { confidence: 0.9, color: '#10b981' },
        decorative: { confidence: 0.85, color: '#f59e0b' },
        support: { confidence: 0.88, color: '#6366f1' },
        pillar: { confidence: 0.92, color: '#ef4444' },
        custom: { confidence: 0.8, color: '#8b5cf6' }
      }
    }
  };
  
  // Dataset con patrones específicos de columnas
  const COLUMN_PATTERNS = {
    structural: {
      minArea: 400,
      maxArea: 10000,
      aspectRatio: [0.8, 1.2], // Casi cuadradas
      thickness: [20, 80], // Grosor en pixels
      contexts: ['foundation', 'main_structure', 'load_bearing']
    },
    decorative: {
      minArea: 200,
      maxArea: 5000,
      aspectRatio: [0.7, 1.3],
      thickness: [15, 60],
      contexts: ['facade', 'interior', 'ornamental']
    },
    support: {
      minArea: 300,
      maxArea: 8000,
      aspectRatio: [0.6, 1.4],
      thickness: [18, 70],
      contexts: ['beam_support', 'intermediate', 'secondary']
    },
    pillar: {
      minArea: 500,
      maxArea: 15000,
      aspectRatio: [0.9, 1.1], // Muy cuadradas
      thickness: [25, 100],
      contexts: ['main_pillar', 'central_support', 'heavy_load']
    }
  };
  
  function loadYOLOModel() {
    // Placeholder para carga de YOLO v8
    return new Promise((resolve) => {
      console.log('🧠 Cargando modelo YOLO v8...');
      // Aquí iría la carga real del modelo
      setTimeout(() => {
        console.log('✅ Modelo YOLO v8 cargado');
        resolve({ loaded: true });
      }, 1000);
    });
  }
  
  async function detectWithYOLO(imageData, config = {}) {
    // Placeholder para detección YOLO v8
    return new Promise((resolve) => {
      console.log('🔍 Ejecutando detección YOLO v8...');
      // Aquí iría la detección real
      setTimeout(() => {
        // Simulación de resultados YOLO
        const mockResults = [
          { 
            bbox: [100, 150, 80, 85], 
            confidence: 0.92, 
            class: 'structural',
            score: 0.92
          },
          { 
            bbox: [300, 200, 75, 78], 
            confidence: 0.88, 
            class: 'decorative',
            score: 0.88
          }
        ];
        resolve(mockResults);
      }, 500);
    });
  }
  /* =========================
     SISTEMA DE MODALES
  ========================= */
  
  function showModal(modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  
  function hideModal(modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
  
  // Modal de progreso
  function showProgressModal(title = "Analizando Plano") {
    progressModal.querySelector('[data-role="progress-title"]').textContent = title;
    showModal(progressModal);
    updateProgress(0, "Iniciando...");
  }
  
  function hideProgressModal() {
    hideModal(progressModal);
  }
  
  function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressPercent.textContent = `${Math.round(percent)}%`;
    if (text) progressText.textContent = text;
  }
  
  // Modal de edición de columna
  function showColumnModal(columnData) {
    columnId.value = columnData.id || '';
    columnType.value = columnData.type || 'structural';
    columnNotes.value = columnData.note || '';
    columnColor.value = columnData.color || '#6366f1';
    
    // Guardar referencia para edición
    columnModal._editingColumn = columnData;
    
    showModal(columnModal);
  }
  
  function hideColumnModal() {
    hideModal(columnModal);
    columnModal._editingColumn = null;
  }
  
  // Modal de configuración dataset
  function showDatasetModal() {
    detectionModel.value = detectionConfig.model;
    confidenceThreshold.value = Math.round(detectionConfig.confidence * 100);
    confidenceValue.textContent = `${Math.round(detectionConfig.confidence * 100)}%`;
    showModal(datasetModal);
  }
  
  function hideDatasetModal() {
    hideModal(datasetModal);
  }
  function updateButtons() {
    const ready = !!pdfArrayBuffer;
    
    // Botones principales
    btnDetect.disabled = !ready;
    btnDetectROI.disabled = !ready;
    btnExportPDF.disabled = !ready || !jsPDFReady;
    btnExportPNG.disabled = !ready;
    btnSaveJSON.disabled = !ready;
    
    // Controles de herramientas
    toolButtons.forEach(btn => btn.disabled = !ready);
    
    // Controles de zoom y vista
    [btnFitWidth, btnFitPage, btnCenter, btnResetZoom, 
     btnZoomIn, btnZoomOut, zoomSlider].forEach(el => {
      if (el) el.disabled = !ready;
    });
    
    // Controles de anotaciones
    [btnUndo, btnRedo, btnClear].forEach(el => {
      if (el) el.disabled = !ready;
    });
    
    // Visual feedback con clases CSS
    const viewerToolbar = $(".flex-wrap.items-center.gap-2");
    if (viewerToolbar) {
      viewerToolbar.classList.toggle('bp-disabled', !ready);
    }
  }
  function updateToolSelection() {
    toolButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === currentTool)));
    const node = pageNodes.get(activePage);
    if (!node) return;
    const target = node.ann;
    target.classList.remove("cursor-hand", "cursor-pen", "cursor-erase", "cursor-manual-count", "cursor-delete");
    if (["hand", "select"].includes(currentTool)) {
      target.classList.add("cursor-hand");
      target.style.pointerEvents = "none";
    } else if (currentTool === "manual-count") {
      target.classList.add("cursor-manual-count");
      target.style.pointerEvents = "auto";
    } else if (currentTool === "delete-mode") {
      target.classList.add("cursor-delete");
      target.style.pointerEvents = "auto";
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
  
  // Inicializar PDF.js
  let pdfjsLib;
  try {
    // Intentar usar PDF.js desde CDN
    if (window.pdfjsLib) {
      pdfjsLib = window.pdfjsLib;
    } else if (window.pdfjs) {
      pdfjsLib = window.pdfjs;
    } else {
      // Fallback: cargar desde CDN si no está disponible
      await ensureScript(PDFJS_URL);
      pdfjsLib = window.pdfjsLib || window.pdfjs || window["pdfjs-dist/build/pdf"];
    }
    
    if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
      // Configurar worker para CDN
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    
    console.log("✅ PDF.js initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing PDF.js:", error);
    status("❌ Error initializing PDF.js library");
    return;
  }
  
  // Inicializar jsPDF
  try {
    await ensureScript(JSPDF_URL);
    jsPDFReady = !!window.jspdf;
  } catch {
    jsPDFReady = false;
  }
  updateButtons();

  /* =========================
     Inicialización
  ========================= */
  function initializeComponent() {
    // Mostrar estado vacío inicialmente
    if (emptyState) emptyState.classList.remove('hidden');
    
    // Cargar configuración de detección guardada
    try {
      const savedConfig = localStorage.getItem('bp_detection_config');
      if (savedConfig) {
        detectionConfig = { ...detectionConfig, ...JSON.parse(savedConfig) };
      }
    } catch (error) {
      console.warn('Error cargando configuración:', error);
    }
    
    // Configurar estado inicial
    status("Listo para cargar plano");
    updateButtons();
    
    // Inicializar herramienta por defecto
    currentTool = "hand";
    updateToolSelection();
  }

  // Llamar inicialización
  initializeComponent();

  /* =========================
     EVENT LISTENERS PARA MODALES
  ========================= */
  
  // Verificar que los elementos existan antes de agregar event listeners
  try {
    // Modal de columna (sistema legacy - verificar existencia)
    const closeColumnModal = $("[data-role='close-column-modal']");
    const cancelColumnEdit = $("[data-role='cancel-column-edit']");
    const columnForm = $("[data-role='column-form']");
    
    if (closeColumnModal) {
      closeColumnModal.addEventListener('click', hideColumnModal);
    }
    if (cancelColumnEdit) {
      cancelColumnEdit.addEventListener('click', hideColumnModal);
    }
    
    if (columnForm) {
      columnForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const editingColumn = columnModal._editingColumn;
        if (!editingColumn) return;
        
        // Actualizar datos de la columna
        const columnType = $("[data-role='column-type']");
        const columnNotes = $("[data-role='column-notes']");
        const columnColor = $("[data-role='column-color']");
        
        if (columnType) editingColumn.type = columnType.value;
        if (columnNotes) editingColumn.note = columnNotes.value;
        if (columnColor) editingColumn.color = columnColor.value;
        
        // Actualizar en el mapa de columnas
        const pageColumns = columnsByPage.get(activePage) || [];
        const columnIndex = pageColumns.findIndex(c => c.id === editingColumn.id);
        if (columnIndex !== -1) {
          pageColumns[columnIndex] = { ...pageColumns[columnIndex], ...editingColumn };
          columnsByPage.set(activePage, pageColumns);
        }
        
        // Re-renderizar
        renderCountsPanels();
        renderColumnEditor();
        renderAnnotations(activePage);
        scheduleAutoSave();
        hideColumnModal();
        status("Column updated ✅");
      });
    }
  } catch (error) {
    console.warn("Some modal elements not found (expected if using new table modal):", error);
  }

  // Event listeners para modal de dataset (verificar existencia)
  try {
    const closeDatasetModal = $("[data-role='close-dataset-modal']");
    const cancelDetectionConfig = $("[data-role='cancel-detection-config']");
    const confidenceThreshold = $("[data-role='confidence-threshold']");
    const confidenceValue = $("[data-role='confidence-value']");
    const applyDetectionConfig = $("[data-role='apply-detection-config']");
    const detectionModel = $("[data-role='detection-model']");
    const customDataset = $("[data-role='custom-dataset']");
    
    // Nuevos campos de configuración avanzada
    const angularTolerance = $("[data-role='angular-tolerance']");
    const minSideLength = $("[data-role='min-side-length']");
    const rightCutPercent = $("[data-role='right-cut-percent']");
    const topCutPercent = $("[data-role='top-cut-percent']");
    const squareRatioMin = $("[data-role='square-ratio-min']");
    const squareRatioValue = $("[data-role='square-ratio-value']");
    const gridLengthPercent = $("[data-role='grid-length-percent']");
    const gridTolerance = $("[data-role='grid-tolerance']");
    const radiusMultiplier = $("[data-role='radius-multiplier']");
    const radiusMultiplierValue = $("[data-role='radius-multiplier-value']");
    
    if (closeDatasetModal) {
      closeDatasetModal.addEventListener('click', hideDatasetModal);
    }
    if (cancelDetectionConfig) {
      cancelDetectionConfig.addEventListener('click', hideDatasetModal);
    }
    
    // Event listeners para sliders con valores dinámicos
    if (confidenceThreshold && confidenceValue) {
      confidenceThreshold.addEventListener('input', (e) => {
        const value = e.target.value;
        confidenceValue.textContent = `${value}%`;
      });
    }
    
    if (squareRatioMin && squareRatioValue) {
      squareRatioMin.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        squareRatioValue.textContent = value.toFixed(2);
      });
    }
    
    if (radiusMultiplier && radiusMultiplierValue) {
      radiusMultiplier.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        radiusMultiplierValue.textContent = value.toFixed(1);
      });
    }
    
    // Inicializar valores desde configuración actual
    function loadConfigToUI() {
      if (detectionModel) detectionModel.value = detectionConfig.model;
      if (confidenceThreshold) {
        confidenceThreshold.value = Math.round(detectionConfig.confidence * 100);
        if (confidenceValue) confidenceValue.textContent = `${Math.round(detectionConfig.confidence * 100)}%`;
      }
      if (angularTolerance) angularTolerance.value = detectionConfig.angularTolerance;
      if (minSideLength) minSideLength.value = detectionConfig.minSideLength;
      if (rightCutPercent) rightCutPercent.value = detectionConfig.rightCutPercent;
      if (topCutPercent) topCutPercent.value = detectionConfig.topCutPercent;
      if (squareRatioMin) {
        squareRatioMin.value = detectionConfig.squareRatioMin;
        if (squareRatioValue) squareRatioValue.textContent = detectionConfig.squareRatioMin.toFixed(2);
      }
      if (gridLengthPercent) gridLengthPercent.value = detectionConfig.gridLengthPercent;
      if (gridTolerance) gridTolerance.value = detectionConfig.gridTolerance;
      if (radiusMultiplier) {
        radiusMultiplier.value = detectionConfig.radiusMultiplier;
        if (radiusMultiplierValue) radiusMultiplierValue.textContent = detectionConfig.radiusMultiplier.toFixed(1);
      }
    }
    
    // Cargar configuración al abrir el modal
    loadConfigToUI();
    
    if (applyDetectionConfig) {
      applyDetectionConfig.addEventListener('click', async () => {
        // Configuración básica
        if (detectionModel) detectionConfig.model = detectionModel.value;
        if (confidenceThreshold) detectionConfig.confidence = confidenceThreshold.value / 100;
        
        // Configuración avanzada del algoritmo
        if (angularTolerance) detectionConfig.angularTolerance = parseInt(angularTolerance.value);
        if (minSideLength) detectionConfig.minSideLength = parseInt(minSideLength.value);
        if (rightCutPercent) detectionConfig.rightCutPercent = parseInt(rightCutPercent.value);
        if (topCutPercent) detectionConfig.topCutPercent = parseInt(topCutPercent.value);
        if (squareRatioMin) detectionConfig.squareRatioMin = parseFloat(squareRatioMin.value);
        if (gridLengthPercent) detectionConfig.gridLengthPercent = parseInt(gridLengthPercent.value);
        if (gridTolerance) detectionConfig.gridTolerance = parseInt(gridTolerance.value);
        if (radiusMultiplier) detectionConfig.radiusMultiplier = parseFloat(radiusMultiplier.value);
        
        // Dataset personalizado
        if (customDataset && customDataset.files[0]) {
          try {
            const file = customDataset.files[0];
            const text = await file.text();
            detectionConfig.customDataset = JSON.parse(text);
            status(`✅ Dataset personalizado cargado: ${file.name}`);
          } catch (error) {
            status(`❌ Error cargando dataset: ${error.message}`);
            return;
          }
        }
        
        // Guardar configuración
        localStorage.setItem('bp_detection_config', JSON.stringify(detectionConfig));
        
        hideDatasetModal();
        status(`✅ Configuración aplicada: ${detectionConfig.model} (${Math.round(detectionConfig.confidence * 100)}%) 🧠`);
        
        // Actualizar indicador en la UI si es algoritmo vectorial optimizado
        if (detectionConfig.model === 'vectorial') {
          const statusEl = $("[data-role='status']");
          if (statusEl) {
            statusEl.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            statusEl.style.color = 'white';
            statusEl.innerHTML = '🧠 Algoritmo "Cuadradito con Cerebro" activado';
            setTimeout(() => {
              statusEl.style.background = '';
              statusEl.style.color = '';
              statusEl.innerHTML = 'Ready';
            }, 3000);
          }
        }
      });
    }
  } catch (error) {
    console.warn("Dataset modal elements not found:", error);
  }
  
  // Event listeners globales
  try {
    // Cerrar modales con ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const columnModal = $("[data-role='column-modal']");
        const datasetModal = $("[data-role='dataset-modal']");
        const columnsTableModal = $("[data-role='columns-table-modal']");
        
        if (columnModal && columnModal.classList.contains('show')) hideColumnModal();
        if (datasetModal && datasetModal.classList.contains('show')) hideDatasetModal();
        if (columnsTableModal && columnsTableModal.classList.contains('show')) closeColumnsTableModal();
      }
    });
    
    // Cerrar modales clickeando fuera
    const modals = ['column-modal', 'dataset-modal', 'columns-table-modal'];
    modals.forEach(modalName => {
      const modal = $(`[data-role='${modalName}']`);
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            if (modalName === 'column-modal') hideColumnModal();
            else if (modalName === 'dataset-modal') hideDatasetModal();
            else if (modalName === 'columns-table-modal') closeColumnsTableModal();
          }
        });
      }
    });
  } catch (error) {
    console.warn("Error setting up global event listeners:", error);
  }

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
  
  // Auto-guardado cuando se realizan cambios
  function autoSave() {
    try {
      projects.projects[currentProject] = serializeProject();
      projects.last = currentProject;
      saveProjectsIndex();
      console.log('Auto-guardado realizado:', new Date().toLocaleTimeString());
    } catch (error) {
      console.warn('Error en auto-guardado:', error);
    }
  }
  
  // Debounced auto-save para evitar guardados excesivos
  let autoSaveTimeout;
  function scheduleAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(autoSave, 1000); // Auto-guardar después de 1 segundo
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
    // renderColumnEditor(); // COMENTADO: Solo mostrar después de detectar
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
     Gestión de Columnas - Tabla Modal
  ========================= */

  // Referencias al modal de tabla de columnas
  const columnsTableModal = $("[data-role='columns-table-modal']");
  const closeColumnsModal = $("[data-role='close-columns-modal']");
  const addColumnBtn = $("[data-role='add-column']");
  const syncColumnsBtn = $("[data-role='sync-columns']");
  const exportColumnsBtn = $("[data-role='export-columns']");
  const importColumnsBtn = $("[data-role='import-columns']");
  const columnSearchInput = $("[data-role='column-search']");
  const filterTypeSelect = $("[data-role='filter-type']");
  const columnsTableBody = $("[data-role='columns-table-body']");
  const selectAllColumns = $("[data-role='select-all-columns']");
  const bulkEditBtn = $("[data-role='bulk-edit']");
  const deleteSelectedBtn = $("[data-role='delete-selected']");
  const saveColumnsBtn = $("[data-role='save-columns']");

  // Variables para gestión de selección
  let selectedColumns = new Set();
  let filteredColumns = [];

  // Función para sincronizar sistemas de columnas
  function syncColumnSystems() {
    // Convertir de columnsByPage a detectedColumns para compatibilidad
    const currentPageColumns = columnsByPage.get(activePage) || [];
    
    console.log(`🔄 Sincronizando página ${activePage}:`, {
      before: detectedColumns.filter(c => c.page === activePage).length,
      columnsByPageCount: currentPageColumns.length,
      currentPageColumns
    });
    
    // Limpiar columnas de la página actual en detectedColumns
    for (let i = detectedColumns.length - 1; i >= 0; i--) {
      if (detectedColumns[i].page === activePage) {
        detectedColumns.splice(i, 1);
      }
    }
    
    // Agregar columnas actuales
    currentPageColumns.forEach((col, index) => {
      const newDetectedCol = {
        id: col.id || `C-${index + 1}`,
        x: col.x,
        y: col.y,
        width: col.w,
        height: col.h,
        page: activePage,
        type: col.type || 'structural',
        confidence: col.confidence || 0.85,
        description: col.description || `Column ${col.id || `C-${index + 1}`}`,
        material: col.material || '',
        unit: col.unit || 'count',
        notes: col.notes || col.note || col.id || `C-${index + 1}`,
        color: col.color || '#6366f1',
        manual: col.manual || false
      };
      
      detectedColumns.push(newDetectedCol);
    });
    
    const afterCount = detectedColumns.filter(c => c.page === activePage).length;
    console.log(`✅ Sincronización completada: ${afterCount} columnas en detectedColumns para página ${activePage}`);
  }

  // Función para sincronizar de detectedColumns a columnsByPage
  function syncToColumnsByPage() {
    const pageColumns = detectedColumns.filter(col => col.page === activePage);
    
    const converted = pageColumns.map(col => ({
      id: col.id,
      x: col.x,
      y: col.y,
      w: col.width || col.w,
      h: col.height || col.h,
      type: col.type,
      confidence: col.confidence,
      description: col.description,
      material: col.material,
      unit: col.unit,
      notes: col.notes,
      color: col.color
    }));
    
    columnsByPage.set(activePage, converted);
  }

  // Función para actualizar ambos sistemas cuando se detectan nuevas columnas
  function addColumnToSystems(columnData) {
    // Agregar a columnsByPage (sistema existente)
    const currentCols = columnsByPage.get(activePage) || [];
    currentCols.push(columnData);
    columnsByPage.set(activePage, currentCols);
    
    // Agregar a detectedColumns (nuevo sistema)
    const detectedCol = {
      id: columnData.id || `COL_${activePage}_${Date.now()}`,
      x: columnData.x,
      y: columnData.y,
      width: columnData.w,
      height: columnData.h,
      page: activePage,
      type: columnData.type || 'structural',
      confidence: columnData.confidence || 0.85,
      description: columnData.description || '',
      material: columnData.material || '',
      unit: columnData.unit || 'count',
      notes: columnData.notes || '',
      color: columnData.color || '#6366f1'
    };
    detectedColumns.push(detectedCol);
  }

  // Función auxiliar para agregar columna a ambos sistemas
  function addColumnToSystems(columnData) {
    // Agregar a columnsByPage (sistema existente)
    const currentCols = columnsByPage.get(activePage) || [];
    currentCols.push(columnData);
    columnsByPage.set(activePage, currentCols);
    
    // Agregar a detectedColumns (nuevo sistema)
    const detectedCol = {
      id: columnData.id || `COL_${activePage}_${Date.now()}`,
      x: columnData.x,
      y: columnData.y,
      width: columnData.w,
      height: columnData.h,
      page: activePage,
      type: columnData.type || 'structural',
      confidence: columnData.confidence || 0.85,
      description: columnData.description || '',
      material: columnData.material || '',
      unit: columnData.unit || 'count',
      notes: columnData.notes || '',
      color: columnData.color || '#6366f1'
    };
    detectedColumns.push(detectedCol);
  }

  // Sincronizar sistemas al cambiar de página
  const originalPageChange = pageChange;
  function pageChange(newPage) {
    syncColumnSystems(); // Sincronizar antes del cambio
    originalPageChange(newPage);
    syncToColumnsByPage(); // Sincronizar después del cambio
  }

  // Función para abrir el modal de tabla de columnas
  function openColumnsTableModal() {
    console.log(`🚀 ABRIENDO MODAL - FORZANDO CARGA DE DATOS...`);
    
    // FUERZA BRUTA: leer de ambos sistemas
    const pageColumns = columnsByPage.get(activePage) || [];
    const detectedPageColumns = detectedColumns.filter(col => col.page === activePage);
    
    console.log(`� DATOS AL ABRIR MODAL:`, {
      activePage,
      columnsByPageCount: pageColumns.length,
      detectedColumnsCount: detectedPageColumns.length,
      hasDetectionRun
    });
    
    // Si no hay datos en columnsByPage pero sí en detectedColumns, SINCRONIZAR AHORA
    if (pageColumns.length === 0 && detectedPageColumns.length > 0) {
      console.log("🔄 SINCRONIZANDO AL ABRIR MODAL...");
      const syncedColumns = detectedPageColumns.map((col, index) => ({
        id: col.id || `C-${index + 1}`,
        type: col.type || 'structural',
        x: col.x,
        y: col.y,
        w: col.width || 12,
        h: col.height || 240,
        confidence: col.confidence || 0.85,
        note: col.notes || col.id,
        manual: col.manual || false
      }));
      
      columnsByPage.set(activePage, syncedColumns);
      console.log(`✅ SINCRONIZADO: ${syncedColumns.length} columnas`);
    }
    
    $("[data-role='active-page-num']").textContent = activePage;
    updateColumnsCount();
    
    // FORZAR regeneración de tabla
    console.log("🔄 FORZANDO REGENERACIÓN DE TABLA...");
    generateColumnsTable();
    
    columnsTableModal.classList.add('show');
  }

  // Función para cerrar el modal de tabla de columnas
  function closeColumnsTableModal() {
    columnsTableModal.classList.remove('show');
    selectedColumns.clear();
    updateBulkActions();
  }

  // Función para generar la tabla de columnas
  function generateColumnsTable() {
    console.log("🔄 Generando tabla de columnas...");
    
    // FORZAR LECTURA DIRECTA DE LAS FUENTES DE DATOS
    const columnsByPageData = columnsByPage.get(activePage) || [];
    const detectedColumnsData = detectedColumns.filter(col => col.page === activePage);
    
    console.log(`� DATOS ENCONTRADOS:`, {
      activePage,
      columnsByPageCount: columnsByPageData.length,
      detectedColumnsCount: detectedColumnsData.length,
      hasDetectionRun
    });
    
    // Si no hay datos y no se ha ejecutado detección, mostrar mensaje
    if (!hasDetectionRun) {
      columnsTableBody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 2rem; color: var(--c-dim);">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 1rem;">
              <span style="font-size: 3rem;">🔍</span>
              <p>Presiona "Detectar" para encontrar columnas</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }
    
    // Usar la fuente de datos que tenga columnas
    let sourceColumns = [];
    
    if (columnsByPageData.length > 0) {
      console.log("✅ Usando columnsByPage como fuente");
      sourceColumns = columnsByPageData.map((col, index) => ({
        id: col.id || `C-${index + 1}`,
        type: col.type || 'structural',
        description: `Column ${col.id || `C-${index + 1}`}`,
        width: col.w || 12,
        height: col.h || 240,
        x: Math.round(col.x),
        y: Math.round(col.y),
        confidence: Math.round((col.confidence || 0.85) * 100),
        material: col.material || '',
        unit: col.unit || 'count',
        manual: col.manual || false
      }));
    } else if (detectedColumnsData.length > 0) {
      console.log("✅ Usando detectedColumns como fuente");
      sourceColumns = detectedColumnsData.map((col, index) => ({
        id: col.id || `C-${index + 1}`,
        type: col.type || 'structural',
        description: col.description || `Column ${col.id || `C-${index + 1}`}`,
        width: col.width || 12,
        height: col.height || 240,
        x: Math.round(col.x),
        y: Math.round(col.y),
        confidence: Math.round((col.confidence || 0.85) * 100),
        material: col.material || '',
        unit: col.unit || 'count',
        manual: col.manual || false
      }));
    }
    
    console.log(`� Procesando ${sourceColumns.length} columnas para la tabla`);
    
    filteredColumns = filterColumns(sourceColumns);
    columnsTableBody.innerHTML = '';
    
    if (filteredColumns.length === 0) {
      columnsTableBody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 2rem; color: var(--c-dim);">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 1rem;">
              <span style="font-size: 3rem;">📋</span>
              <p>No columns found on this page</p>
              <p style="font-size: 0.9rem; color: var(--c-dim);">ColumnsByPage: ${columnsByPageData.length} | DetectedColumns: ${detectedColumnsData.length}</p>
              <button class="bp-btn" onclick="window.forceTableRefresh()" style="background: #dc2626; color: white;">🔄 Force Refresh</button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    filteredColumns.forEach((column, index) => {
      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid var(--c-border)';
      row.style.transition = 'background-color 0.2s ease';
      
      // Color indicator
      const typeColors = {
        'structural': '#3b82f6',
        'decorative': '#8b5cf6',
        'support': '#10b981',
        'pillar': '#f59e0b',
        'custom': '#6b7280'
      };
      
      const typeColor = typeColors[column.type] || typeColors.custom;
      const confidence = Math.round((column.confidence || 0.85) * 100);
      
      row.innerHTML = `
        <td style="padding: 0.75rem; border-right: 1px solid var(--c-border);">
          <input type="checkbox" data-column-id="${column.id}" onchange="toggleColumnSelection('${column.id}')">
        </td>
        <td style="padding: 0.75rem; border-right: 1px solid var(--c-border); font-family: monospace; font-weight: 500;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: ${typeColor};"></div>
            ${column.id}
            ${column.manual ? '<span style="background: #10b981; color: white; font-size: 0.7rem; padding: 2px 4px; border-radius: 4px; margin-left: 0.5rem;">MANUAL</span>' : ''}
          </div>
        </td>
        <td style="padding: 0.75rem; border-right: 1px solid var(--c-border);">
          <select class="bp-form-select" onchange="updateColumnType('${column.id}', this.value)" style="border: none; background: transparent; padding: 0;">
            <option value="structural" ${column.type === 'structural' ? 'selected' : ''}>Structural</option>
            <option value="decorative" ${column.type === 'decorative' ? 'selected' : ''}>Decorative</option>
            <option value="support" ${column.type === 'support' ? 'selected' : ''}>Support</option>
            <option value="pillar" ${column.type === 'pillar' ? 'selected' : ''}>Pillar</option>
            <option value="custom" ${column.type === 'custom' ? 'selected' : ''}>Custom</option>
          </select>
        </td>
        <td style="padding: 0.75rem; border-right: 1px solid var(--c-border);">
          <input type="text" value="${column.description || ''}" onchange="updateColumnDescription('${column.id}', this.value)" 
                 style="border: none; background: transparent; width: 100%; padding: 0;" 
                 placeholder="Add description...">
        </td>
        <td style="padding: 0.75rem; border-right: 1px solid var(--c-border); font-family: monospace; font-size: 0.85rem;">
          ${column.width ? `${Math.round(column.width)}×${Math.round(column.height)}` : 'Auto'}
        </td>
        <td style="padding: 0.75rem; border-right: 1px solid var(--c-border); font-family: monospace; font-size: 0.85rem;">
          (${Math.round(column.x)}, ${Math.round(column.y)})
        </td>
        <td style="padding: 0.75rem; border-right: 1px solid var(--c-border);">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <div style="flex: 1; background: var(--c-border); height: 4px; border-radius: 2px; overflow: hidden;">
              <div style="background: ${confidence > 80 ? '#10b981' : confidence > 60 ? '#f59e0b' : '#ef4444'}; height: 100%; width: ${confidence}%; transition: width 0.3s ease;"></div>
            </div>
            <span style="font-size: 0.8rem; color: var(--c-dim);">${confidence}%</span>
          </div>
        </td>
        <td style="padding: 0.75rem; border-right: 1px solid var(--c-border);">
          <input type="text" value="${column.material || ''}" onchange="updateColumnMaterial('${column.id}', this.value)" 
                 style="border: none; background: transparent; width: 100%; padding: 0;" 
                 placeholder="Material...">
        </td>
        <td style="padding: 0.75rem; border-right: 1px solid var(--c-border);">
          <select class="bp-form-select" onchange="updateColumnUnit('${column.id}', this.value)" style="border: none; background: transparent; padding: 0;">
            <option value="count" ${column.unit === 'count' ? 'selected' : ''}>count</option>
            <option value="m" ${column.unit === 'm' ? 'selected' : ''}>m</option>
            <option value="cm" ${column.unit === 'cm' ? 'selected' : ''}>cm</option>
            <option value="mm" ${column.unit === 'mm' ? 'selected' : ''}>mm</option>
            <option value="ft" ${column.unit === 'ft' ? 'selected' : ''}>ft</option>
            <option value="in" ${column.unit === 'in' ? 'selected' : ''}>in</option>
          </select>
        </td>
        <td style="padding: 0.75rem; text-align: center;">
          <div style="display: flex; gap: 0.25rem; justify-content: center;">
            <button class="bp-btn" onclick="highlightColumn('${column.id}')" title="Highlight" style="padding: 0.25rem; width: 28px; height: 28px;">👁️</button>
            <button class="bp-btn" onclick="editColumnDetails('${column.id}')" title="Edit" style="padding: 0.25rem; width: 28px; height: 28px;">✏️</button>
            <button class="bp-btn" onclick="deleteColumn('${column.id}')" title="Delete" style="padding: 0.25rem; width: 28px; height: 28px; color: var(--bad);">🗑️</button>
          </div>
        </td>
      `;
      
      // Hover effects
      row.addEventListener('mouseenter', () => {
        row.style.backgroundColor = 'var(--c-bg)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.backgroundColor = 'transparent';
      });
      
      columnsTableBody.appendChild(row);
    });
    
    console.log(`✅ TABLA GENERADA: ${filteredColumns.length} filas agregadas al DOM`);
    updateColumnStats();
  }

  // Función para filtrar columnas
  function filterColumns(columns) {
    const searchTerm = columnSearchInput.value.toLowerCase();
    const typeFilter = filterTypeSelect.value;
    
    return columns.filter(column => {
      const matchesSearch = !searchTerm || 
        column.id.toLowerCase().includes(searchTerm) ||
        (column.description || '').toLowerCase().includes(searchTerm) ||
        (column.material || '').toLowerCase().includes(searchTerm);
      
      const matchesType = !typeFilter || column.type === typeFilter;
      
      return matchesSearch && matchesType;
    });
  }

  // Función para ejecutar detección de columnas desde el modal
  window.runColumnDetection = function() {
    // Usar el sistema de detección existente
    const detectBtn = $("[data-role='cv']");
    if (detectBtn && !detectBtn.disabled) {
      detectBtn.click();
    } else {
      // Fallback: ejecutar detección directa si el botón no está disponible
      detectColumnsVectorial();
    }
    
    // Cerrar modal temporalmente mientras se ejecuta la detección
    closeColumnsTableModal();
    
    // Reabrir modal después de un delay para mostrar resultados
    setTimeout(() => {
      syncColumnSystems(); // Asegurar sincronización
      if (detectedColumns.filter(col => col.page === activePage).length > 0) {
        openColumnsTableModal();
      }
    }, 2000);
  };

  // NUEVA: Función para sincronizar y refrescar la tabla
  window.syncAndRefreshTable = function() {
    console.log("🔄 Sincronización manual iniciada...");
    
    // BUSCAR COLUMNAS EN TODOS LOS LUGARES POSIBLES
    const columnsByPageData = columnsByPage.get(activePage) || [];
    const detectedColumnsData = detectedColumns.filter(col => col.page === activePage);
    const allColumnsByPage = Array.from(columnsByPage.entries());
    
    console.log(`🔍 DEBUGGING COMPLETO:`, {
      activePage,
      columnsByPageForThisPage: columnsByPageData.length,
      columnsByPageData,
      detectedColumnsForThisPage: detectedColumnsData.length,
      detectedColumnsData,
      allColumnsByPageEntries: allColumnsByPage,
      totalDetectedColumns: detectedColumns.length
    });
    
    // Si columnsByPage está vacío pero detectedColumns tiene datos, usar detectedColumns
    let sourceColumns = columnsByPageData;
    if (columnsByPageData.length === 0 && detectedColumnsData.length > 0) {
      console.log("📋 columnsByPage está vacío, usando detectedColumns como fuente");
      sourceColumns = detectedColumnsData.map(col => ({
        id: col.id,
        x: col.x,
        y: col.y,
        w: col.width,
        h: col.height,
        type: col.type,
        confidence: col.confidence,
        note: col.notes,
        manual: col.manual || false
      }));
      
      // Guardar en columnsByPage para consistencia
      columnsByPage.set(activePage, sourceColumns);
    }
    
    console.log(`✅ Usando ${sourceColumns.length} columnas de fuente final`);
    
    // Refrescar la tabla
    generateColumnsTable();
    updateColumnsCount();
    
    status(`🔄 Tabla sincronizada: ${sourceColumns.length} columnas`);
  };

  // Función de fuerza bruta para refrescar tabla
  window.forceTableRefresh = function() {
    console.log("💥 FUERZA BRUTA: Refrescando tabla...");
    
    // Buscar en TODAS las páginas
    let foundColumns = [];
    for (let [pageNum, columns] of columnsByPage.entries()) {
      if (columns && columns.length > 0) {
        console.log(`📄 Página ${pageNum}: ${columns.length} columnas`);
        if (pageNum === activePage) {
          foundColumns = columns;
        }
      }
    }
    
    // Si no encontramos en columnsByPage, buscar en detectedColumns
    if (foundColumns.length === 0) {
      foundColumns = detectedColumns.filter(col => col.page === activePage);
      console.log(`📋 Encontradas ${foundColumns.length} en detectedColumns`);
    }
    
    console.log(`💪 FORZANDO con ${foundColumns.length} columnas`);
    
    if (foundColumns.length > 0) {
      // Limpiar y regenerar
      filteredColumns = foundColumns.map((col, index) => ({
        id: col.id || `C-${index + 1}`,
        type: col.type || 'structural',
        description: `Column ${col.id || `C-${index + 1}`}`,
        width: col.w || col.width || 12,
        height: col.h || col.height || 240,
        x: Math.round(col.x),
        y: Math.round(col.y),
        confidence: Math.round((col.confidence || 0.85) * 100),
        material: col.material || '',
        unit: col.unit || 'count',
        manual: col.manual || false
      }));
      
      // Regenerar tabla directamente
      generateColumnsTable();
      status(`💥 FORZADO: ${foundColumns.length} columnas cargadas`);
    } else {
      status("❌ No se encontraron columnas en ningún sistema");
    }
  };

  // Función de detección vectorial específica para el modal
  async function detectColumnsVectorial() {
    if (!pdfDoc) {
      status("❌ No PDF loaded");
      return;
    }
    
    try {
      status("🔍 Detecting columns...");
      await detectSquaresOn(activePage);
      
      // Sincronizar sistemas después de la detección
      syncColumnSystems();
      status(`✅ Detection completed: ${detectedColumns.filter(col => col.page === activePage).length} columns found`);
    } catch (error) {
      console.error("Error in column detection:", error);
      status("❌ Error during column detection");
    }
  }

  // Función para actualizar estadísticas
  function updateColumnStats() {
    // LEER DIRECTAMENTE DE LA MISMA FUENTE QUE EL PANEL IZQUIERDO
    const columns = columnsByPage.get(activePage) || [];
    const tableColumns = columns.map((col) => ({
      type: col.type || 'structural'
    }));
    
    const selected = selectedColumns.size;
    const total = tableColumns.length;
    const structural = tableColumns.filter(col => col.type === 'structural').length;
    const decorative = tableColumns.filter(col => col.type === 'decorative').length;
    
    $("[data-role='selected-count']").textContent = selected;
    $("[data-role='total-count']").textContent = total;
    $("[data-role='structural-count']").textContent = structural;
    $("[data-role='decorative-count']").textContent = decorative;
    $("[data-role='columns-count']").textContent = `Total: ${total}`;
  }

  // Función para actualizar conteo de columnas
  function updateColumnsCount() {
    // LEER DIRECTAMENTE DE LA MISMA FUENTE QUE EL PANEL IZQUIERDO
    const columns = columnsByPage.get(activePage) || [];
    console.log(`📊 Actualizando contador desde columnsByPage: ${columns.length} columnas en página ${activePage}`);
    $("[data-role='columns-count']").textContent = `Total: ${columns.length}`;
  }

  // Función para toggle de selección de columnas
  function toggleColumnSelection(columnId) {
    if (selectedColumns.has(columnId)) {
      selectedColumns.delete(columnId);
    } else {
      selectedColumns.add(columnId);
    }
    updateBulkActions();
    updateColumnStats();
  }

  // Función para actualizar acciones en lote
  function updateBulkActions() {
    const hasSelection = selectedColumns.size > 0;
    bulkEditBtn.disabled = !hasSelection;
    deleteSelectedBtn.disabled = !hasSelection;
    
    // Update select all checkbox
    const checkboxes = columnsTableBody.querySelectorAll('input[type="checkbox"]');
    const checkedBoxes = columnsTableBody.querySelectorAll('input[type="checkbox"]:checked');
    selectAllColumns.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < checkboxes.length;
    selectAllColumns.checked = checkboxes.length > 0 && checkedBoxes.length === checkboxes.length;
  }

  // Funciones de actualización de propiedades
  window.updateColumnType = function(columnId, type) {
    // Actualizar en detectedColumns
    const detectedColumn = detectedColumns.find(col => col.id === columnId);
    if (detectedColumn) {
      detectedColumn.type = type;
    }
    
    // Actualizar en columnsByPage
    const currentCols = columnsByPage.get(activePage) || [];
    const pageColumn = currentCols.find(col => col.id === columnId);
    if (pageColumn) {
      pageColumn.type = type;
    }
    
    autoSave();
    generateColumnsTable();
    renderCountsPanels();
  };

  window.updateColumnDescription = function(columnId, description) {
    const detectedColumn = detectedColumns.find(col => col.id === columnId);
    if (detectedColumn) {
      detectedColumn.description = description;
    }
    
    const currentCols = columnsByPage.get(activePage) || [];
    const pageColumn = currentCols.find(col => col.id === columnId);
    if (pageColumn) {
      pageColumn.description = description;
    }
    
    autoSave();
  };

  window.updateColumnMaterial = function(columnId, material) {
    const detectedColumn = detectedColumns.find(col => col.id === columnId);
    if (detectedColumn) {
      detectedColumn.material = material;
    }
    
    const currentCols = columnsByPage.get(activePage) || [];
    const pageColumn = currentCols.find(col => col.id === columnId);
    if (pageColumn) {
      pageColumn.material = material;
    }
    
    autoSave();
  };

  window.updateColumnUnit = function(columnId, unit) {
    const detectedColumn = detectedColumns.find(col => col.id === columnId);
    if (detectedColumn) {
      detectedColumn.unit = unit;
    }
    
    const currentCols = columnsByPage.get(activePage) || [];
    const pageColumn = currentCols.find(col => col.id === columnId);
    if (pageColumn) {
      pageColumn.unit = unit;
    }
    
    autoSave();
  };

  // Función para resaltar columna
  window.highlightColumn = function(columnId) {
    const column = detectedColumns.find(col => col.id === columnId);
    if (column && column.page === activePage) {
      // Enfocar columna usando el sistema existente
      focusColumn(activePage, columnId);
      status(`Column ${columnId} highlighted`);
    }
  };

  // Función para editar detalles de columna
  window.editColumnDetails = function(columnId) {
    const column = detectedColumns.find(col => col.id === columnId);
    if (column) {
      const notes = prompt(`Edit notes for ${columnId}:`, column.notes || '');
      if (notes !== null) {
        column.notes = notes;
        autoSave();
        status(`Notes updated for ${columnId}`);
      }
    }
  };

  // Función para eliminar columna
  window.deleteColumn = function(columnId) {
    if (confirm(`Delete column ${columnId}?`)) {
      // Eliminar de detectedColumns
      const detectedIndex = detectedColumns.findIndex(col => col.id === columnId);
      if (detectedIndex > -1) {
        detectedColumns.splice(detectedIndex, 1);
      }
      
      // Eliminar de columnsByPage
      const currentCols = columnsByPage.get(activePage) || [];
      const pageIndex = currentCols.findIndex(col => col.id === columnId);
      if (pageIndex > -1) {
        currentCols.splice(pageIndex, 1);
        columnsByPage.set(activePage, currentCols);
      }
      
      selectedColumns.delete(columnId);
      autoSave();
      generateColumnsTable();
      renderCountsPanels();
      renderAnnotations(activePage);
      status(`Column ${columnId} deleted`);
    }
  };

  // Event listener para abrir modal de tabla de columnas
  const openColumnsTableBtn = $("[data-role='open-columns-table']");
  openColumnsTableBtn.addEventListener('click', () => {
    // LEER DIRECTAMENTE SIN SINCRONIZACIÓN COMPLEJA
    const columns = columnsByPage.get(activePage) || [];
    
    console.log(`🔍 Modal abierto - Leyendo directamente de columnsByPage:`, {
      activePage,
      columnsCount: columns.length,
      columns: columns.map(c => ({ id: c.id, type: c.type, x: c.x, y: c.y }))
    });
    
    openColumnsTableModal();
  });

  // Event listeners para el modal de tabla de columnas
  closeColumnsModal.addEventListener('click', closeColumnsTableModal);
  
  columnSearchInput.addEventListener('input', generateColumnsTable);
  filterTypeSelect.addEventListener('change', generateColumnsTable);
  
  selectAllColumns.addEventListener('change', (e) => {
    const checkboxes = columnsTableBody.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = e.target.checked;
      const columnId = checkbox.getAttribute('data-column-id');
      if (e.target.checked) {
        selectedColumns.add(columnId);
      } else {
        selectedColumns.delete(columnId);
      }
    });
    updateBulkActions();
    updateColumnStats();
  });

  addColumnBtn.addEventListener('click', () => {
    const newColumn = {
      id: `COL_${Date.now()}`,
      x: 100,
      y: 100,
      w: 50,
      h: 50,
      type: 'custom',
      confidence: 1.0,
      description: 'Manual column',
      material: '',
      unit: 'count',
      notes: '',
      color: '#6366f1'
    };
    
    // Agregar a ambos sistemas
    addColumnToSystems(newColumn);
    
    autoSave();
    generateColumnsTable();
    renderCountsPanels();
    renderAnnotations(activePage);
    status(`New column ${newColumn.id} added`);
  });

  // Event listener para botón de sincronización
  syncColumnsBtn.addEventListener('click', () => {
    window.syncAndRefreshTable();
  });

  exportColumnsBtn.addEventListener('click', () => {
    const columns = detectedColumns.filter(col => col.page === activePage);
    const csvContent = 'data:text/csv;charset=utf-8,' +
      'ID,Type,Description,Position X,Position Y,Width,Height,Confidence,Material,Unit,Notes\n' +
      columns.map(col => 
        `"${col.id}","${col.type}","${col.description || ''}",${col.x},${col.y},${col.width || ''},${col.height || ''},${Math.round((col.confidence || 0.85) * 100)}%,"${col.material || ''}","${col.unit || 'count'}","${col.notes || ''}"`
      ).join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `columns_page_${activePage}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    status('Columns exported to CSV');
  });

  bulkEditBtn.addEventListener('click', () => {
    if (selectedColumns.size === 0) return;
    
    const action = prompt(`Bulk edit ${selectedColumns.size} columns:\n1. Change type\n2. Set material\n3. Set unit\n\nEnter option (1-3):`);
    
    if (action === '1') {
      const newType = prompt('New type (structural/decorative/support/pillar/custom):');
      if (newType && ['structural', 'decorative', 'support', 'pillar', 'custom'].includes(newType)) {
        selectedColumns.forEach(columnId => {
          const column = detectedColumns.find(col => col.id === columnId);
          if (column) column.type = newType;
        });
        autoSave();
        generateColumnsTable();
        status(`${selectedColumns.size} columns updated to ${newType}`);
      }
    } else if (action === '2') {
      const material = prompt('Material:');
      if (material !== null) {
        selectedColumns.forEach(columnId => {
          const column = detectedColumns.find(col => col.id === columnId);
          if (column) column.material = material;
        });
        autoSave();
        generateColumnsTable();
        status(`Material set for ${selectedColumns.size} columns`);
      }
    } else if (action === '3') {
      const unit = prompt('Unit (count/m/cm/mm/ft/in):');
      if (unit && ['count', 'm', 'cm', 'mm', 'ft', 'in'].includes(unit)) {
        selectedColumns.forEach(columnId => {
          const column = detectedColumns.find(col => col.id === columnId);
          if (column) column.unit = unit;
        });
        autoSave();
        generateColumnsTable();
        status(`Unit set to ${unit} for ${selectedColumns.size} columns`);
      }
    }
  });

  deleteSelectedBtn.addEventListener('click', () => {
    if (selectedColumns.size === 0) return;
    
    if (confirm(`Delete ${selectedColumns.size} selected columns?`)) {
      selectedColumns.forEach(columnId => {
        const index = detectedColumns.findIndex(col => col.id === columnId);
        if (index > -1) {
          detectedColumns.splice(index, 1);
        }
      });
      selectedColumns.clear();
      autoSave();
      generateColumnsTable();
      refreshCanvas();
      status(`Selected columns deleted`);
    }
  });

  saveColumnsBtn.addEventListener('click', () => {
    // Sincronizar hacia columnsByPage antes de guardar
    syncToColumnsByPage();
    autoSave();
    status('Column changes saved ✅');
  });

  /* =========================
     PDF flujo mejorado con drag & drop
  ========================= */
  
  // Función para formatear tamaño de archivo
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Función para mostrar información del archivo
  function showFileInfo(file, numPages) {
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    filePages.textContent = `${numPages} páginas`;
    fileInfo.classList.remove('hidden');
    dropZone.classList.add('hidden');
  }

  // Función para ocultar información del archivo
  function hideFileInfo() {
    fileInfo.classList.add('hidden');
    dropZone.classList.remove('hidden');
    fileName.textContent = '';
    fileSize.textContent = '';
    filePages.textContent = '';
  }

  // Helper function para verificar PDF.js
  function checkPDFjs() {
    if (!pdfjsLib) {
      status("❌ PDF.js not loaded. Please refresh the page.");
      return false;
    }
    return true;
  }

  // Función para procesar archivo
  async function processFile(file) {
    if (!file || file.type !== 'application/pdf') {
      status("❌ Por favor selecciona un archivo PDF válido");
      return;
    }

    try {
      dropZone.classList.add('bp-processing');
      status("📁 Cargando archivo...");
      
      pdfArrayBuffer = await file.arrayBuffer();
      await openPDF();
      
      showFileInfo(file, pdfDoc.numPages);
      updateButtons();
      
      dropZone.classList.remove('bp-processing');
      status("✅ Archivo cargado correctamente");
    } catch (error) {
      console.error('Error al cargar PDF:', error);
      status("❌ Error al cargar el archivo PDF");
      dropZone.classList.remove('bp-processing');
    }
  }

  // Event listeners para drag & drop
  dropZone.addEventListener('click', () => {
    pdfInputHidden.click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  });

  // Event listener para input file hidden
  pdfInputHidden.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  });

  // Event listener para remover archivo
  removeFileBtn.addEventListener('click', () => {
    pdfArrayBuffer = null;
    pdfDoc = null;
    hideFileInfo();
    stage.innerHTML = "";
    thumbs.innerHTML = "";
    pageNodes.clear();
    columnsByPage.clear();
    selectedPages.clear();
    pageSelect.innerHTML = "";
    
    // Mostrar estado vacío nuevamente
    emptyState.classList.remove('hidden');
    
    updateButtons();
    status("—");
    pdfInputHidden.value = '';
  });

  // Mantener compatibilidad con el input original si existe
  if (pdfInput) {
    pdfInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await processFile(file);
      }
    });
  }
  btnDetect.addEventListener("click", async () => {
    if (!pdfDoc) return;
    await detectSquaresOn(activePage);
  });
  btnDetectROI.addEventListener("click", async () => {
    if (!pdfDoc) return;
    
    // Verificar si hay ROI definido
    const roi = roiByPage.get(activePage);
    if (!roi) {
      status("⚠️ Primero arrastra para seleccionar un área en el plano");
      return;
    }
    
    status(`🎯 Detectando columnas en área seleccionada (${Math.round(roi.w)}×${Math.round(roi.h)} px)`);
    await detectSquaresOn(activePage);
  });
  btnDatasetConfig.addEventListener("click", () => {
    showDatasetModal();
  });

  async function openPDF() {
    stage.innerHTML = "";
    thumbs.innerHTML = "";
    pageNodes.clear();
    columnsByPage.clear();
    selectedPages.clear();

    // Verificar PDF.js
    if (!checkPDFjs()) {
      return;
    }

    // Ocultar estado vacío y mostrar visor
    emptyState.classList.add('hidden');

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
    
    // Actualizar progreso
    const progress = Math.round((pageNum / pdfDoc.numPages) * 100);
    status(`Rendering page ${pageNum}/${pdfDoc.numPages} (${progress}%)`);
    
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

    // Solo dibujar columnas si ya se ejecutó detección
    if (hasDetectionRun) {
      const cols = columnsByPage.get(pageNum) || [];
      drawRects(n.octx, cols, { fill: "rgba(99,102,241,.22)", stroke: "rgba(99,102,241,.95)" });
      drawColumnLabels(n.octx, cols);
    }

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

    // Actualizar contador rápido
    const quickCount = $("[data-role='quick-count']");
    if (quickCount) {
      quickCount.textContent = `${cols.length} detected`;
    }

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

  // Zoom con rueda (natural) - respeta bloqueo de zoom
  viewerWrap.addEventListener(
    "wheel",
    (e) => {
      // Si el zoom está bloqueado, no permitir zoom
      if (zoomLocked) return;
      
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
  btnZoomIn.addEventListener("click", () => { 
    if (zoomLocked) return;
    fitMode = FIT.MANUAL; 
    applyScale(RENDER_SCALE + 0.15, { keepCenter: true }); 
  });
  btnZoomOut.addEventListener("click", () => { 
    if (zoomLocked) return;
    fitMode = FIT.MANUAL; 
    applyScale(RENDER_SCALE - 0.15, { keepCenter: true }); 
  });
  zoomSlider.addEventListener("input", (e) => {
    if (zoomLocked) {
      e.target.value = Math.round(RENDER_SCALE * 100);
      return;
    }
    fitMode = FIT.MANUAL;
    const pct = clamp(+e.target.value || 100, 50, 300);
    applyScale((pct / 100) * BASE_RENDER_SCALE, { keepCenter: true });
  });
  btnFitWidth.addEventListener("click", () => { 
    if (zoomLocked) return;
    fitMode = FIT.WIDTH; 
    applyFit(); 
  });
  btnFitPage.addEventListener("click", () => { 
    if (zoomLocked) return;
    fitMode = FIT.PAGE; 
    applyFit(); 
  });
  btnCenter.addEventListener("click", () => centerPageInView(true));
  btnResetZoom.addEventListener("click", () => { 
    if (zoomLocked) return;
    fitMode = FIT.MANUAL; 
    applyScale(BASE_RENDER_SCALE); 
  });
  
  // NUEVO: Event listeners para botones de bloqueo de zoom y conteo manual
  btnLockZoom.addEventListener("click", () => {
    zoomLocked = !zoomLocked;
    btnLockZoom.textContent = zoomLocked ? "🔒" : "🔓";
    btnLockZoom.classList.toggle("locked", zoomLocked);
    status(zoomLocked ? "🔒 Zoom bloqueado" : "🔓 Zoom desbloqueado");
  });
  
  btnManualCount.addEventListener("click", () => {
    manualCountMode = !manualCountMode;
    btnManualCount.classList.toggle("active-manual", manualCountMode);
    
    if (manualCountMode) {
      currentTool = "manual-count";
      viewer.classList.add("cursor-manual-count");
      status("👆 Modo conteo manual activo - Haz clic en las columnas");
    } else {
      currentTool = "hand";
      viewer.classList.remove("cursor-manual-count");
      status("Modo conteo manual desactivado");
    }
    updateToolSelection();
  });
  
  // NUEVO: Modo eliminación manual
  btnDeleteMode.addEventListener("click", () => {
    deleteMode = !deleteMode;
    manualCountMode = false; // Desactivar modo manual si está activo
    btnDeleteMode.classList.toggle("active-delete", deleteMode);
    btnManualCount.classList.remove("active-manual");
    
    if (deleteMode) {
      currentTool = "delete-mode";
      viewer.classList.add("cursor-delete");
      viewer.classList.remove("cursor-manual-count");
      status("🗑️ Modo eliminación activo - Haz clic en columnas para eliminarlas");
    } else {
      currentTool = "hand";
      viewer.classList.remove("cursor-delete");
      status("Modo eliminación desactivado");
    }
    updateToolSelection();
  });
  
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
  async function detectSquaresOn(pageNum) {
    if (!pdfDoc) return [];
    
    // Activar bandera de detección ejecutada
    hasDetectionRun = true;
    
    showProgressModal("Detectando Columnas");
    
    try {
      updateProgress(5, "Inicializando detección...");
      await sleep(100);
      
      const page = await pdfDoc.getPage(pageNum);
      const node = pageNodes.get(pageNum);
      if (!node) return [];
      
      // Usar directamente el algoritmo vectorial optimizado
      updateProgress(15, "Ejecutando algoritmo vectorial...");
      let results = await detectWithVectorialMethod(page, node, pageNum);
      // Si hay ROI definido, filtrar resultados para que solo estén dentro del área seleccionada
      const roi = roiByPage.get(pageNum);
      if (roi) {
        results = results.filter(r =>
          r.x >= roi.x && r.y >= roi.y &&
          (r.x + r.w) <= (roi.x + roi.w) &&
          (r.y + r.h) <= (roi.y + roi.h)
        );
      }
      
      updateProgress(95, "Guardando resultados...");
      await sleep(100);

      // Procesar y guardar resultados
      const finalColumns = results.map((rect, i) => ({
        id: `C-${i + 1}`, // Cambiar a C-1, C-2, etc.
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        type: rect.type || "structural",
        note: rect.note || `C-${i + 1}`,
        color: rect.color || strokeColor,
        highlight: false,
        confidence: rect.confidence || 1.0
      }));

      columnsByPage.set(pageNum, finalColumns);
      
      // CORREGIDO: Sincronizar inmediatamente con detectedColumns
      // Limpiar columnas existentes de esta página
      for (let i = detectedColumns.length - 1; i >= 0; i--) {
        if (detectedColumns[i].page === pageNum) {
          detectedColumns.splice(i, 1);
        }
      }
      
      // Agregar las nuevas columnas detectadas con el formato correcto
      finalColumns.forEach((col) => {
        detectedColumns.push({
          id: col.id,
          page: pageNum,
          type: col.type,
          x: col.x,
          y: col.y,
          width: col.w,
          height: col.h,
          confidence: col.confidence,
          description: `Column ${col.id}`,
          material: '',
          unit: 'count',
          notes: col.note,
          manual: false
        });
      });
      
      console.log(`✅ Detección completada: ${finalColumns.length} columnas agregadas a ambos sistemas`, {
        columnsByPage: finalColumns.length,
        detectedColumns: detectedColumns.filter(c => c.page === pageNum).length
      });
      
      scheduleAutoSave();
      
      // Renderizar
      if (node) {
        node.octx.clearRect(0, 0, node.overlay.width, node.overlay.height);
        drawRects(node.octx, finalColumns, { fill: "rgba(99,102,241,.22)", stroke: "rgba(99,102,241,.95)" });
        drawColumnLabels(node.octx, finalColumns);
        if (pageNum === activePage) renderAnnotations(pageNum);
      }
      
      const lbl = thumbs.querySelector(`[data-thumb-count="${pageNum}"]`);
      if (lbl) lbl.textContent = String(finalColumns.length);
      
      renderCountsPanels();
      renderColumnEditor();

      updateProgress(100, `¡${finalColumns.length} columnas detectadas!`);
      await sleep(500);

      // Mensaje mejorado para el algoritmo optimizado
      if (detectionConfig.model === 'vectorial') {
        status(`🧠 ${finalColumns.length} columnas detectadas con "Cuadradito con Cerebro" - ${Math.round(detectionConfig.confidence * 100)}% precisión`);
      } else {
        status(`✅ ${finalColumns.length} columnas (${detectionConfig.model}) - ${Math.round(detectionConfig.confidence * 100)}%`);
      }
      
      // Debug final: verificar estado de ambos sistemas
      console.log(`🎯 Detección finalizada:`, {
        pageNum,
        finalColumns: finalColumns.length,
        columnsByPageCount: (columnsByPage.get(pageNum) || []).length,
        detectedColumnsCount: detectedColumns.filter(c => c.page === pageNum).length,
        allDetectedColumns: detectedColumns.length
      });
      
      return finalColumns;
      
    } catch (error) {
      console.error("Error en detección:", error);
      status("❌ Error en la detección de columnas");
      return [];
    } finally {
      hideProgressModal();
    }
  }
  
  // Método vectorial optimizado - Algoritmo "cuadradito con cerebro" simplificado
  async function detectWithVectorialMethod(page, node, pageNum) {
    updateProgress(15, "Analizando estructura vectorial...");
    await sleep(100);
    
    const OPS = pdfjsLib.OPS;
    const vp = node.viewport;
    const opList = await page.getOperatorList();
    
    // Funciones utilitarias (igual que en index.html)
    function mul(a, b) {
      return [
        a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
      ];
    }
    function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
    function aabb(pts) {
      let xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const minx = Math.min(...xs), maxx = Math.max(...xs);
      const miny = Math.min(...ys), maxy = Math.max(...ys);
      return { x: minx, y: miny, w: maxx - minx, h: maxy - miny, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, area: (maxx - minx) * (maxy - miny) };
    }
    function angle(a, b, c) {
      const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const d = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
      return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
    }
    function iou(A, B) {
      const x1 = Math.max(A.x, B.x), y1 = Math.max(A.y, B.y);
      const x2 = Math.min(A.x + A.w, B.x + B.w), y2 = Math.min(A.y + A.h, B.y + B.h);
      const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const U = A.w * A.h + B.w * B.h - inter; return U > 0 ? inter / U : 0;
    }
    
    updateProgress(25, "Extrayendo vectores...");
    
    // Estado gráfico + buffers
    let ctm = [1, 0, 0, 1, 0, 0], stack = [];
    const quads = [];
    
    const pushQuad = (pts) => {
      const M = mul(vp.transform, ctm);
      const P = pts.map(p => apply(M, p[0], p[1]));
      quads.push(aabb(P));
    };
    
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i], args = opList.argsArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.rectangle) {
        for (let j = 0; j < args.length; j += 4) {
          const x = args[j], y = args[j + 1], w = args[j + 2], h = args[j + 3];
          pushQuad([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
        }
      }
      else if (fn === OPS.constructPath) {
        const pathOps = args[0], coords = args[1];
        let ci = 0, curr = [], polys = []; let last = null;
        const flush = () => { if (curr.length >= 3) polys.push(curr), curr = []; };
        for (const op of pathOps) {
          if (op === OPS.moveTo) { const x = coords[ci++], y = coords[ci++]; flush(); curr = [[x, y]]; last = [x, y]; }
          else if (op === OPS.lineTo) { const x = coords[ci++], y = coords[ci++]; curr.push([x, y]); last = [x, y]; }
          else if (op === OPS.closePath) { flush(); last = null; }
          else if (op === OPS.rectangle) {
            const x = coords[ci++], y = coords[ci++], w = coords[ci++], h = coords[ci++];
            polys.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
          } else {
            if (op === OPS.curveTo) ci += 6;
            else if (op === OPS.curveTo2) ci += 4;
            else if (op === OPS.curveTo3) ci += 4;
            last = null;
          }
        }
        
        const angTol = detectionConfig.angularTolerance || 12;
        const minSide = detectionConfig.minSideLength || 12;
        for (const poly of polys) {
          if (poly.length !== 4) continue;
          const P = poly.slice();
          if (P[0][0] !== P.at(-1)[0] || P[0][1] !== P.at(-1)[1]) P.push(P[0]);
          const A = angle(P[3], P[0], P[1]), B = angle(P[0], P[1], P[2]),
                C = angle(P[1], P[2], P[3]), D = angle(P[2], P[3], P[0]);
          const good = [A, B, C, D].every(a => Math.abs(90 - a) <= angTol);
          if (!good) continue;
          const w = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
          const h = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
          if (Math.min(w, h) < minSide) continue;
          pushQuad(poly);
        }
      }
    }
    
    updateProgress(45, "Aplicando filtros...");
    console.log(`Raw quads detectados: ${quads.length}`);
    
    // Aplicar cortes
    const cutX = node.canvas.width * (1 - ((detectionConfig.rightCutPercent || 12) / 100));
    const topCutY = node.canvas.height * ((detectionConfig.topCutPercent || 6) / 100);
    let boxes = quads.filter(b => b.cx < cutX && b.y > topCutY);
    console.log(`Después de cortes: ${boxes.length}`);
    
    // Merge overlaps
    const merged = [];
    for (const r of boxes.sort((a, b) => (a.x - b.x) || (a.y - b.y))) {
      let put = true;
      for (let i = 0; i < merged.length; i++) {
        if (iou(merged[i], r) > 0.45) {
          if (merged[i].area < r.area) merged[i] = r;
          put = false; break;
        }
      }
      if (put) merged.push(r);
    }
    console.log(`Después de merge: ${merged.length}`);
    
    updateProgress(60, "Filtrando cuadrados...");
    
    // Filtrar cuadrados
    const squareMin = detectionConfig.squareRatioMin || 0.70;
    const isSquare = r => (Math.min(r.w, r.h) / Math.max(r.w, r.h)) >= squareMin;
    const squares = merged.filter(isSquare);
    console.log(`Cuadrados encontrados: ${squares.length}`);
    
    updateProgress(80, "Aplicando lógica de columnas...");
    
    // Por ahora, considerar todos los cuadrados como columnas potenciales
    // (simplificado sin análisis de texto complejo)
    const results = squares.map((r, i) => ({
      x: r.x, y: r.y, w: r.w, h: r.h,
      type: "structural",
      confidence: 0.9,
      note: `C-${i + 1}`
    }));
    
    console.log(`Columnas detectadas: ${results.length}`);
    updateProgress(95, "Finalizando...");
    await sleep(100);
    
    return results;
  }
  
  // Método YOLO v8
  async function detectWithYOLOMethod(page, node, pageNum, useROI) {
    updateProgress(15, "Cargando modelo YOLO v8...");
    await loadYOLOModel();
    
    updateProgress(40, "Convirtiendo página a imagen...");
    const canvas = node.canvas;
    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    
    updateProgress(60, "Ejecutando detección YOLO...");
    const yoloResults = await detectWithYOLO(imageData, detectionConfig);
    
    updateProgress(80, "Procesando resultados YOLO...");
    
    // Convertir resultados YOLO a formato interno
    return yoloResults
      .filter(result => result.confidence >= detectionConfig.confidence)
      .map(result => {
        const [x, y, w, h] = result.bbox;
        return {
          x, y, w, h,
          type: result.class,
          confidence: result.confidence,
          note: `${result.class} (${Math.round(result.confidence * 100)}%)`
        };
      });
  }
  
  // Método híbrido (Vectorial + YOLO)
  async function detectWithHybridMethod(page, node, pageNum, useROI) {
    updateProgress(15, "Ejecutando detección híbrida...");
    
    // Ejecutar ambos métodos
    const vectorialResults = await detectWithVectorialMethod(page, node, pageNum, useROI);
    const yoloResults = await detectWithYOLOMethod(page, node, pageNum, useROI);
    
    updateProgress(75, "Fusionando resultados...");
    
    // Fusionar y validar resultados
    const combined = [...vectorialResults, ...yoloResults];
    const filtered = filterDuplicatesAdvanced(combined);
    
    return filtered;
  }
  
  function filterDuplicatesAdvanced(results) {
    // Algoritmo avanzado para eliminar duplicados con IoU y confianza
    const filtered = [];
    const sorted = results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    
    for (const current of sorted) {
      let isDuplicate = false;
      for (const existing of filtered) {
        const iou = calculateIoU(current, existing);
        if (iou > 0.5) { // Umbral de superposición
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        filtered.push(current);
      }
    }
    
    return filtered;
  }
  
  function calculateIoU(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const unionArea = (a.w * a.h) + (b.w * b.h) - intersection;
    
    return intersection / unionArea;
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
      scheduleAutoSave(); // Auto-guardar cuando se agregan anotaciones
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
      scheduleAutoSave(); // Auto-guardar cuando se borran anotaciones
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
      scheduleAutoSave(); // Auto-guardar cuando se borran anotaciones con lasso
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

      if (currentTool === "manual-count") {
        // Modo conteo manual: crear nueva columna en la posición del clic
        const cols = columnsByPage.get(pageNum) || [];
        const newColumn = {
          id: `C-${cols.length + 1}`, // Usar el mismo formato C-1, C-2, etc.
          x: pos.x - 15, // Centrar en el punto del clic
          y: pos.y - 15,
          w: 30,
          h: 30,
          type: "manual",
          note: `C-${cols.length + 1}`, // Etiqueta corta
          color: "#10b981", // Verde para identificar como manual
          highlight: false,
          confidence: 1.0,
          manual: true // Marcar como conteo manual
        };
        
        cols.push(newColumn);
        columnsByPage.set(pageNum, cols);
        
        // Renderizar y actualizar
        const node = pageNodes.get(pageNum);
        if (node) {
          node.octx.clearRect(0, 0, node.overlay.width, node.overlay.height);
          drawRects(node.octx, cols, { fill: "rgba(99,102,241,.22)", stroke: "rgba(99,102,241,.95)" });
          drawColumnLabels(node.octx, cols);
        }
        
        renderCountsPanels();
        renderColumnEditor();
        scheduleAutoSave();
        status(`✅ Columna manual ${newColumn.id} agregada`);
        
        // Auto-desactivar el modo después de usar (opcional)
        // setTimeout(() => {
        //   resetSpecialModes();
        //   status("Modo conteo manual sigue activo");
        // }, 1000);
        return;
      }
      
      if (currentTool === "delete-mode") {
        // Modo eliminación: buscar columna en la posición del clic y eliminarla
        const cols = columnsByPage.get(pageNum) || [];
        const tolerance = 25; // Tolerancia para el clic
        
        // Buscar columna clickeada
        const clickedIndex = cols.findIndex(col => {
          return pos.x >= col.x - tolerance && pos.x <= col.x + col.w + tolerance &&
                 pos.y >= col.y - tolerance && pos.y <= col.y + col.h + tolerance;
        });
        
        if (clickedIndex !== -1) {
          const deletedColumn = cols[clickedIndex];
          cols.splice(clickedIndex, 1);
          columnsByPage.set(pageNum, cols);
          
          // Re-numerar las columnas restantes
          cols.forEach((col, index) => {
            if (!col.manual) { // Solo re-numerar las automáticas
              col.id = `C-${index + 1}`;
              col.note = `C-${index + 1}`;
            }
          });
          
          // Renderizar y actualizar
          const node = pageNodes.get(pageNum);
          if (node) {
            node.octx.clearRect(0, 0, node.overlay.width, node.overlay.height);
            drawRects(node.octx, cols, { fill: "rgba(99,102,241,.22)", stroke: "rgba(99,102,241,.95)" });
            drawColumnLabels(node.octx, cols);
          }
          
          renderCountsPanels();
          renderColumnEditor();
          scheduleAutoSave();
          status(`🗑️ Columna ${deletedColumn.id} eliminada`);
          
          // Auto-desactivar el modo después de usar (opcional)
          // setTimeout(() => {
          //   resetSpecialModes();
          //   status("Modo eliminación sigue activo");
          // }, 1000);
        } else {
          status("⚠️ No hay columna en esa posición");
        }
        return;
      }

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
        // Guardar cualquier ROI, sin importar el tamaño
        roiByPage.set(pageNum, { x, y, w, h });
        renderOverlay(pageNum);
        updateThumbROI(pageNum);
        status("ROI definida 🟩");
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

    // Solo dibujar columnas si ya se ejecutó detección
    if (hasDetectionRun) {
      const cols = columnsByPage.get(pageNum) || [];
      drawRects(octx, cols, { fill: "rgba(99,102,241,.22)", stroke: "rgba(99,102,241,.95)" });
      drawColumnLabels(octx, cols);
    }

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
    ctx.lineWidth = 2;
    for (const r of rects) { 
      // Usar colores diferentes para columnas manuales
      if (r.manual) {
        ctx.strokeStyle = "rgba(16,185,129,.95)"; // Verde para manuales
        ctx.fillStyle = "rgba(16,185,129,.22)";
      } else {
        ctx.strokeStyle = stroke;
        ctx.fillStyle = fill;
      }
      ctx.beginPath(); 
      ctx.rect(r.x + 0.5, r.y + 0.5, r.w, r.h); 
      ctx.fill(); 
      ctx.stroke(); 
    }
    ctx.restore();
  }

  function drawColumnLabels(ctx, rects) {
    if (!rects || !rects.length) return;
    ctx.save();
    ctx.font = "bold 11px ui-sans-serif"; // Tamaño fijo pequeño
    ctx.textBaseline = "top";
    for (const r of rects) {
      const label = String(r.id || "");
      if (!label) continue;
      const pad = 3; // Padding fijo pequeño
      const txt = label;
      const tw = ctx.measureText(txt).width;
      
      // Color de fondo diferente para columnas manuales
      if (r.manual) {
        ctx.fillStyle = "rgba(16,185,129,.95)"; // Verde para manuales
        ctx.strokeStyle = "rgba(6,95,70,.9)";
      } else {
        ctx.fillStyle = "rgba(15,23,42,.95)";
        ctx.strokeStyle = "rgba(100,116,139,.7)";
      }
      
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Rectángulo pequeño y fijo
      ctx.rect(r.x + 4, r.y + 4, tw + pad * 2, 16);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffffff"; // Texto blanco para mejor contraste
      ctx.fillText(txt, r.x + 4 + pad, r.y + 4 + 2);
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
    scheduleAutoSave(); // Auto-guardar en undo
  });
  btnRedo.addEventListener("click", () => {
    const s = annotationsByPage.get(activePage);
    if (!s || !s.redo.length) return;
    s.undo.push(JSON.parse(JSON.stringify(s.items)));
    s.items = s.redo.pop() || [];
    renderAnnotations(activePage);
    renderCountsPanels();
    scheduleAutoSave(); // Auto-guardar en redo
  });
  btnClear.addEventListener("click", () => {
    const s = annotationsByPage.get(activePage);
    if (!s) return;
    if (!confirm("Clear all annotations on this page?")) return;
    s.undo.push(JSON.parse(JSON.stringify(s.items)));
    s.redo.length = 0;
    s.items = [];
    renderAnnotations(activePage);
    renderCountsPanels();
    scheduleAutoSave(); // Auto-guardar en clear
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
    if (!pdfDoc) { 
      status("❌ No hay PDF cargado para exportar"); 
      return; 
    }
    
    if (!jsPDFReady) { 
      status("⚠️ jsPDF no está disponible - Reintentando carga..."); 
      try {
        await ensureScript(JSPDF_URL);
        jsPDFReady = !!window.jspdf;
        if (!jsPDFReady) {
          status("❌ No se pudo cargar jsPDF");
          return;
        }
        status("✅ jsPDF cargado correctamente");
      } catch (error) {
        console.error("Error cargando jsPDF:", error);
        status("❌ Error al cargar jsPDF");
        return;
      }
    }
    
    try {
      status("📄 Exportando PDF con columnas detectadas...");
      
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
        
        status(`📄 Procesando página ${i + 1}/${pagesToExport.length}...`);
      }

      // Nombre del archivo mejorado
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const totalColumns = Array.from(columnsByPage.values()).reduce((sum, cols) => sum + cols.length, 0);
      const name = `${currentProject || "blueprint-analyzer"}-${totalColumns}cols-${timestamp}.pdf`;
      
      doc.save(name);
      status(`✅ PDF exportado: ${name} (${pagesToExport.length} páginas, ${totalColumns} columnas)`);
    } catch (e) {
      console.error("Error en exportación PDF:", e);
      status(`❌ Error al exportar PDF: ${e.message}`);
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
    // No mostrar nada hasta que se ejecute detección
    if (!hasDetectionRun) {
      colEditorBox.innerHTML = `<div class="text-slate-400 text-sm px-1 py-2">Presiona "Detectar" para encontrar columnas.</div>`;
      return;
    }
    
    const cols = columnsByPage.get(activePage) || [];
    if (!cols.length) {
      colEditorBox.innerHTML = `<div class="text-slate-400 text-sm px-1 py-2">No hay columnas detectadas en esta página.</div>`;
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

