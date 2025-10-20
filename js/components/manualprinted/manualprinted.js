/*!
 * CADLite - Componente JS puro
 * Autor: ChatGPT para Gonzalo
 * Licencia: MIT
 */
(function () {

  // Cache PDF documents in-memory so we can restore them after remounts without refetching.
  const PDF_CACHE = new Map();

  class CADLite {
    constructor(container, options = {}) {
      if (!container) throw new Error('CADLite: container requerido.');
      this.container = container;
      this.opts = Object.assign({
        title: 'Plano Anotador CAD-lite++',
        pdfjsCdn: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js',
        pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js',
        jsPdfCdn: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
      }, options);

      // Estado principal
      this.state = { snap: false, unitName: 'u', unitPerPx: 1, showGrid: true, showRulers: true };
      this.scales = [];
  this._bgData = null; // dataURL of background (image or rendered PDF page)
  this._bgKey = null; // key used to associate shapes with this background
      this.LS_KEY = 'cadlite_state_pages_v1';
      this.shapesByPage = {};        // { key -> shapes[] }
      this.shapes = [];              // alias shapes current page
      this.undoMap = {};             // { key -> stack[] }
      this.redoMap = {};             // { key -> stack[] }
      this.selectedId = null;

      // Interacción
      this.tool = 'select';
      this.isDown = false;
      this.startWorld = [0, 0];
      this.activeShape = null;
      this.polyWorking = null;
      this.panLast = [0, 0];
      this.shiftHeld = false;
      this.panningBySpace = false;
      this.measureTemp = null;
      this.mouseScreen = null;

      // Documento
      this.currentDocType = 'none'; // 'pdf' | 'image' | 'none'
      this.pdfDoc = null; this.pdfCurrent = 1; this.pdfTotal = 0; this.renderScale = 1.5;
      this.pdfFingerprint = null;
      this.bgImg = null;

      // Canvas/vistas
      this.W = 0; this.H = 0; this.view = { x: 0, y: 0, scale: 1 };

      // Tablas
      this.TABLE_EXPANDED = false; this.TABLE_LIMIT = 5;

      // Icon cache
      this.ICON_CACHE = new Map();

      // Montaje
      this._mount();
    }

    /* ================== Helpers DOM/Math ================== */
    $(sel) { return this.container.querySelector(sel); }
    $all(sel) { return Array.from(this.container.querySelectorAll(sel)); }
    uuid() { return Math.random().toString(36).slice(2, 9); }
  // simple deterministic hash for strings (djb2 variant) -> base36
  _hashStr(s) { try { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i); return (h >>> 0).toString(36); } catch (e) { return Math.random().toString(36).slice(2, 9); } }
    // Simple debounce util (instance bound)
    _debounce(fn, wait = 250) {
      let timer = null;
      return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { try { fn.apply(this, args); } catch (e) { console.error('debounced fn error', e); } }, wait);
      };
    }
    clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
    round(n, p = 2) { return Math.round(n * 10 ** p) / 10 ** p; }
    snapIf(v) { return this.state.snap ? Math.round(v / 10) * 10 : v; }

    // Render HTML for an icon. Prefers window.renderLucideIcon(name,size) if available.
    _iconHtml(name, size = 16) {
      try {
        if (window && typeof window.renderLucideIcon === 'function') {
          const out = window.renderLucideIcon(name, size);
          if (out) return out;
        }
      } catch (e) { /* ignore */ }
      return this._inlineSvgFor(name, size);
    }

    _inlineSvgFor(name, size = 16) {
      const s = Math.max(12, size);
      const stroke = 'currentColor';
      const common = `width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns=\"http://www.w3.org/2000/svg\"`;
      const icons = {
        cursor: `<svg ${common}><path d="M3 3l7 14 2-6 4 5 5-16-18 3z" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
        move: `<svg ${common}><path d="M12 2v20M2 12h20" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
        square: `<svg ${common}><rect x="4" y="4" width="16" height="16" stroke="${stroke}" stroke-width="1.6" rx="1"/></svg>`,
        circle: `<svg ${common}><circle cx="12" cy="12" r="8" stroke="${stroke}" stroke-width="1.6"/></svg>`,
        polyline: `<svg ${common}><path d="M3 12l4-4 4 4 4-4 4 4" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        type: `<svg ${common}><path d="M4 6h16M6 18h12M9 6v12" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        ruler: `<svg ${common}><path d="M3 21L21 3" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/><path d="M7 17l3-3M11 13l3-3M15 9l3-3" stroke="${stroke}" stroke-width="1.2" stroke-linecap="round"/></svg>`,
        'corner-down-right': `<svg ${common}><path d="M15 10v6a3 3 0 0 1-3 3H6" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 3v6h-6" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        image: `<svg ${common}><rect x="3" y="3" width="18" height="14" rx="2" stroke="${stroke}" stroke-width="1.6"/><circle cx="8.5" cy="8.5" r="1.5" fill="${stroke}"/></svg>`,
        grid: `<svg ${common}><path d="M3 3h18v18H3z" stroke="${stroke}" stroke-width="1.2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="${stroke}" stroke-width="1"/></svg>`,
        sliders: `<svg ${common}><path d="M4 6h6M14 6h6M4 12h10M20 12h0M4 18h6M14 18h6" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
        'zoom-in': `<svg ${common}><circle cx="11" cy="11" r="7" stroke="${stroke}" stroke-width="1.6"/><path d="M21 21l-4.35-4.35" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/><path d="M11 8v6M8 11h6" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
        'zoom-out': `<svg ${common}><circle cx="11" cy="11" r="7" stroke="${stroke}" stroke-width="1.6"/><path d="M21 21l-4.35-4.35" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/><path d="M8 11h6" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
        maximize: `<svg ${common}><rect x="3" y="3" width="18" height="18" rx="2" stroke="${stroke}" stroke-width="1.6"/></svg>`,
        'corner-up-left': `<svg ${common}><path d="M9 14L4 9l5-5" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20h-7v-7" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        'corner-up-right': `<svg ${common}><path d="M15 14l5-5-5-5" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20h7v-7" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        'trash-2': `<svg ${common}><polyline points="3 6 5 6 21 6" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
        table: `<svg ${common}><rect x="3" y="3" width="18" height="18" stroke="${stroke}" stroke-width="1.2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="${stroke}" stroke-width="1"/></svg>`
      };
      return icons[name] || `<svg ${common}><rect x="4" y="4" width="16" height="16" stroke="${stroke}" stroke-width="1.6"/></svg>`;
    }

    async _ensureAppStore(){
      // wait a short while for AppStore to be available (other scripts may load it)
      if(window.AppStore) return;
      for(let i=0;i<6;i++){ if(window.AppStore) return; await new Promise(r=>setTimeout(r,150)); }
      if(!window.AppStore) console.warn('AppStore not found - manualprinted will fallback to localStorage');
    }

    // Wrapper helpers that prefer debounced versions when available
    _maybeSave() {
      try {
        if (this._debouncedSaveLocal) return this._debouncedSaveLocal();
        return this._saveLocal();
      } catch (e) { console.warn('maybeSave failed', e); }
    }

    _maybeEmitFamilies() {
      try {
        if (this._debouncedEmitFamiliesUpdate) return this._debouncedEmitFamiliesUpdate();
        return this._emitFamiliesUpdate();
      } catch (e) { console.warn('maybeEmitFamilies failed', e); }
    }

    // --- Plano Anotador (manualprinted.js)
    // --- Envío de datos
    // Compute families JSON grouped by icon and color for current page
    _computeFamilies(){
      try{
        const key = this.pageKey();
        const arr = (this.shapesByPage && this.shapesByPage[key]) ? this.shapesByPage[key] : (Array.isArray(this.shapes) ? this.shapes : []);
        // load any persisted familiesData so we can include user-provided annotations
        let persisted = {};
        try { persisted = JSON.parse(localStorage.getItem('familiesData') || '{}') || {}; } catch(e) { persisted = {}; }
        const map = {};
        for(const s of arr){
          if(!s || s.type !== 'icon') continue;
          const icon = (s.icon || s.name || '').replace(/^custom:/,'') || 'icon';
          const color = (s.color || '').toString().trim() || this._css('--accent','#4db1ff') || '#4db1ff';
          const k = `${icon}|${color}`;
          if(!map[k]) map[k] = { icon, color, count: 0, annotation: '' };
          map[k].count += 1;
          // include any saved annotation or unit data for this family
          try {
            if (persisted && persisted[k]){
              if (typeof persisted[k].annotation === 'string') map[k].annotation = persisted[k].annotation;
              if (persisted[k].unitCost != null) map[k].unitCost = persisted[k].unitCost;
            }
          } catch(e){}
        }
        return map;
      }catch(e){ console.error('computeFamilies error', e); return {}; }
    }

    // Persist families JSON to localStorage and broadcast updateMaterials event
    _emitFamiliesUpdate(){
      try{
        const families = this._computeFamilies();
        // Persist only the keys present (this will include annotations already merged by _computeFamilies)
        localStorage.setItem('familiesData', JSON.stringify(families));
        window.dispatchEvent(new CustomEvent('updateMaterials', { detail: families }));
      }catch(e){ console.error('emitFamiliesUpdate failed', e); }
    }

    // Clear persisted families and broadcast clearMaterials event
    _clearFamiliesData(){
      try{ localStorage.removeItem('familiesData'); window.dispatchEvent(new CustomEvent('clearMaterials')); }
      catch(e){ console.warn('clearFamiliesData failed', e); }
    }

    pageKey() {
      if (this.currentDocType === 'pdf') return `pdf_${this.pdfCurrent}`;
      if (this.currentDocType === 'image' && this._bgKey) return this._bgKey;
      return 'global';
    }
    ensurePageArrays() {
      const key = this.pageKey();
      if (!this.shapesByPage[key]) this.shapesByPage[key] = [];
      if (!this.undoMap[key]) this.undoMap[key] = [];
      if (!this.redoMap[key]) this.redoMap[key] = [];
      this.shapes = this.shapesByPage[key];
    }

    /* ================== Carga de recursos externos ================== */
    async _loadScript(src) {
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.crossOrigin = 'anonymous';
        s.onload = () => res();
        s.onerror = () => rej(new Error('No se pudo cargar ' + src));
        document.head.appendChild(s);
      });
    }

    async _ensurePdfJs() {
      if (window['pdfjs-dist/build/pdf']) return;
      await this._loadScript(this.opts.pdfjsCdn);
      const pdfjsLib = window['pdfjs-dist/build/pdf'];
      pdfjsLib.GlobalWorkerOptions.workerSrc = this.opts.pdfjsWorker;
    }

    async _ensureJsPdf() {
      if (window.jspdf) return;
      await this._loadScript(this.opts.jsPdfCdn);
    }

    /* ================== Montaje UI ================== */
    _mount() {
      this.container.innerHTML = `
        <style>
          /* Root como columna: ribbon / main / status. Así cad-main puede crecer correctamente sin usar 100vh */
          :host, .cadlite-root { display:flex; flex-direction:column; height:100%; box-sizing:border-box; }
          .cad-ribbon{display:flex;gap:10px;align-items:stretch;padding:8px;background:var(--panel);border-bottom:1px solid var(--border);flex-wrap:wrap;color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial}
          .cad-group{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:8px}
          .cad-group h4{margin:0 0 6px 0;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
          .cad-toolbar{display:flex;gap:6px;flex-wrap:wrap}
          .cad-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 10px;border-radius:6px;background:var(--btn);border:1px solid var(--border);cursor:pointer;font-size:13px;user-select:none;color:var(--text)}
          .cad-btn:hover{background:var(--btn-h)} .cad-btn.active{outline:2px solid var(--accent)}
          .cad-ic{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;font-size:14px}
          .cad-ic i{display:inline-block;width:1em;height:1em;line-height:1;color:currentColor}
          .cad-label{display:inline-block}
          .cad-btn.danger{background:var(--danger);border-color:rgba(0,0,0,0.25)} .cad-btn.danger:hover{opacity:0.95}
          .cad-inp{background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px 8px}
          .cad-file{display:none}
          /* Evitar usar viewport height absoluto para que el componente respete su contenedor padre */
          .cad-main{display:flex;flex-direction:row;gap:0;flex:1;min-height:300px;background:var(--surface);box-sizing:border-box;overflow:hidden}
          /* Stage ocupa el espacio disponible dentro de cad-main y se asegura overflow oculto para el canvas */
          .cad-stage{flex:1;min-width:0;min-height:0;position:relative;overflow:hidden}
          .cad-props{width:340px;flex:0 0 340px}
          /* .cad-stage ya tiene position:relative arriba */
          .cad-stage{background:var(--surface)}
          .cad-canvas{position:absolute;inset:0;display:block}
          .cad-rulert, .cad-rulerl{position:absolute;background:#0e141b;border-color:#223046;border-style:solid;pointer-events:none;z-index:2}
          .cad-rulert{left:20px;right:0;top:0;height:20px;border-width:0 0 1px 1px}
          .cad-rulerl{left:0;top:20px;bottom:0;width:20px;border-width:1px 1px 0 0}
          .cad-rcorner{position:absolute;left:0;top:0;width:20px;height:20px;background:#0e141b;border-right:1px solid #223046;border-bottom:1px solid #223046;z-index:3;pointer-events:none}
          .cad-scale{position:absolute;left:28px;bottom:8px;font-size:12px;color:#dbe7f0;background:#0009;padding:3px 6px;border-radius:4px;z-index:3;pointer-events:none}
          .cad-props{background:var(--panel-2);border-left:1px solid var(--border);padding:10px;overflow:auto;color:var(--text)}
          .cad-props h3{margin:6px 0 10px;font-size:15px;color:#cfe3f5}
          .cad-grid{display:grid;grid-template-columns:120px 1fr;gap:6px;font-size:13px}
          .cad-muted{color:var(--muted)}
          .cad-status{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;background:var(--panel);border-top:1px solid var(--border);font-size:12px;color:var(--text)}
          .cad-right{display:flex;gap:10px;align-items:center}
          .cad-link{color:var(--accent);text-decoration:none}
          .cad-modalbg{position:fixed;inset:0;background:var(--modal);display:none;align-items:center;justify-content:center;z-index:9999}
          .cad-modal{background:var(--panel-2);border:1px solid var(--border);border-radius:8px;min-width:72vw;max-width:92vw;max-height:82vh;overflow:auto;color:var(--text)}
          .cad-modal header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #283344}
          .cad-modal header h3{margin:0;font-size:16px}
          .cad-modal .content{padding:10px 14px}
          .cad-table{width:100%;border-collapse:collapse;font-size:13px}
          .cad-table th, .cad-table td{border-bottom:1px solid var(--border);padding:8px;text-align:left}
          .cad-table tr:hover{background:var(--panel)}
          .cad-tag{display:inline-block;padding:2px 6px;border:1px solid #2c394b;border-radius:999px}
          .cad-small{font-size:12px;color:var(--muted)}
        </style>
        <div class="cadlite-root">
          <div class="cad-ribbon">
            <div class="cad-group">
              <h4>${this.opts.title}</h4>
              <div class="cad-toolbar">
                <label class="cad-btn" title="Image"><span>Image</span><input class="cad-file" id="fileInput" type="file" accept="image/*"></label>
                <label class="cad-btn" title="PDF"><span>PDF</span><input class="cad-file" id="pdfInput" type="file" accept="application/pdf"></label>
                <button id="btnPrevPage" class="cad-btn" title="Prev page">◀</button>
                <span id="pdfPageIndicator" style="align-self:center;color:#9bb3c7;font-size:13px;margin:0 6px">—</span>
                <button id="btnNextPage" class="cad-btn" title="Next page">▶</button>

                <button id="btnExport" class="cad-btn" title="Export JSON">Export JSON</button>
                <label class="cad-btn" title="Import JSON">Import<input class="cad-file" id="jsonInput" type="file" accept="application/json"></label>

                <button id="btnSnapshot" class="cad-btn" title="PNG 1:1">PNG</button>
                <button id="btnSnapshotHi" class="cad-btn" title="PNG Hi-res">PNG Hi-res</button>
                <button id="btnExportPdfPage" class="cad-btn" title="PDF Page">PDF Page</button>
                <button id="btnExportPdfDoc" class="cad-btn" title="PDF Document">PDF Document</button>

                <button id="btnClear" class="cad-btn danger" title="Clear">Clear</button>
                <button id="btnClearBg" class="cad-btn" title="Remove background">Remove background</button>
              </div>
            </div>

            <div class="cad-group">
                <h4>Tools</h4>
                <div class="cad-toolbar" id="tools">
                  <button data-tool="select" class="cad-btn active"><span class="cad-ic"><i class="fas fa-mouse-pointer"></i></span><span class="cad-label">Select</span></button>
                  <button data-tool="pan" class="cad-btn"><span class="cad-ic"><i class="fas fa-hand-paper"></i></span><span class="cad-label">Pan</span></button>
                  <button data-tool="rect" class="cad-btn"><span class="cad-ic"><i class="fas fa-square"></i></span><span class="cad-label">Rectangle</span></button>
                  <button data-tool="circle" class="cad-btn"><span class="cad-ic"><i class="fas fa-circle"></i></span><span class="cad-label">Circle</span></button>
                  <button data-tool="poly" class="cad-btn"><span class="cad-ic"><i class="fas fa-draw-polygon"></i></span><span class="cad-label">Polyline</span></button>
                  <button data-tool="text" class="cad-btn"><span class="cad-ic"><i class="fas fa-font"></i></span><span class="cad-label">Text</span></button>
                  <button data-tool="ruler" class="cad-btn"><span class="cad-ic"><i class="fas fa-ruler-horizontal"></i></span><span class="cad-label">Ruler</span></button>
                  <button data-tool="angle" class="cad-btn"><span class="cad-ic"><i class="fas fa-drafting-compass"></i></span><span class="cad-label">Angle</span></button>
                  <button data-tool="icon" class="cad-btn"><span class="cad-ic"><i class="fas fa-stamp"></i></span><span class="cad-label">Icon</span></button>
                </div>
              </div>

            <div class="cad-group">
              <h4>Icons</h4>
              <div class="cad-toolbar">
                <label class="cad-btn">
                  <select id="iconSelect" class="cad-inp">
                    <optgroup label="Estructura">
                      <option value="custom:column-rect">column-rect</option>
                      <option value="custom:column-round">column-round</option>
                      <option value="custom:beam-h">beam-h</option>
                      <option value="custom:beam-rect">beam-rect</option>
                      <option value="custom:slab">slab</option>
                      <option value="custom:footing">footing</option>
                      <option value="custom:shear-wall">shear-wall</option>
                      <option value="custom:rebar">rebar</option>
                      <option value="custom:anchor">anchor</option>
                      <option value="custom:joint">joint</option>
                      <option value="custom:grid-node">grid-node</option>
                      <option value="custom:section-cut">section-cut</option>
                      <option value="custom:elevation-mark">elevation-mark</option>
                      <option value="custom:door">door</option>
                      <option value="custom:window">window</option>
                    </optgroup>
                  </select>
                </label>
                <label class="cad-btn">
                  <span>Size</span>
                  <input id="iconSize" class="cad-inp" type="number" value="28" min="12" max="120" step="2" style="width:72px">
                </label>
              </div>
            </div>

            <div class="cad-group">
                <h4>Views</h4>
                <div class="cad-toolbar">
                  <button id="btnGrid" class="cad-btn"><span class="cad-ic"><i class="fas fa-border-all"></i></span><span class="cad-label">Grid</span></button>
                  <button id="btnRulers" class="cad-btn"><span class="cad-ic"><i class="fas fa-ruler"></i></span><span class="cad-label">Rulers</span></button>
                  <button id="btnScales" class="cad-btn"><span class="cad-ic"><i class="fas fa-balance-scale"></i></span><span class="cad-label">Scales</span></button>
                  <button id="btnZoomIn" class="cad-btn"><span class="cad-ic"><i class="fas fa-search-plus"></i></span><span class="cad-label">Zoom In</span></button>
                  <button id="btnZoomOut" class="cad-btn"><span class="cad-ic"><i class="fas fa-search-minus"></i></span><span class="cad-label">Zoom Out</span></button>
                  <button id="btnResetView" class="cad-btn"><span class="cad-ic"><i class="fas fa-maximize"></i></span><span class="cad-label">Fit</span></button>
                </div>
              </div>

            <div class="cad-group">
              <h4>Edit</h4>
              <div class="cad-toolbar">
                <button id="btnUndo" class="cad-btn"><span class="cad-ic">${this._iconHtml('corner-up-left',14)}</span><span class="cad-label">Undo</span></button>
                <button id="btnRedo" class="cad-btn"><span class="cad-ic">${this._iconHtml('corner-up-right',14)}</span><span class="cad-label">Redo</span></button>
                <button id="btnDelete" class="cad-btn danger"><span class="cad-ic">${this._iconHtml('trash-2',14)}</span><span class="cad-label">Delete</span></button>
                <button id="btnTable" class="cad-btn"><span class="cad-ic">${this._iconHtml('table',14)}</span><span class="cad-label">Families</span></button>
              </div>
            </div>

            <div class="cad-group">
              <h4>Style</h4>
              <div class="cad-toolbar">
                <label class="cad-btn"><span>Color</span> <input id="color" class="cad-inp" type="color" value="#4db1ff"></label>
                <label class="cad-btn"><span>Stroke/Size</span>
                  <input id="stroke" class="cad-inp" type="number" value="2" min="1" max="20" step="1" style="width:64px">
                </label>
              </div>
            </div>
          </div>

          <div class="cad-main">
              <div class="cad-stage">
              <div class="cad-rcorner" id="rulerCorner"></div>
              <canvas class="cad-rulert" id="rulerTop"></canvas>
              <canvas class="cad-rulerl" id="rulerLeft"></canvas>
              <div class="cad-scale" id="scaleBar">Scale bar</div>
              <canvas class="cad-canvas" id="canvas"></canvas>
            </div>
            <aside class="cad-props">
              <h3>Properties</h3>
              <div class="cad-grid">
                <div class="cad-muted">ID</div><div id="p-id">—</div>
                <div class="cad-muted">Type</div><div id="p-type">—</div>
                <div class="cad-muted">Label (optional)</div><div><input id="p-name" class="cad-inp" type="text" placeholder="Label"></div>
                <div class="cad-muted">Show label</div><div><input id="p-showlabel" type="checkbox"></div>
                <div class="cad-muted">Color</div><div><input id="p-color" class="cad-inp" type="color" value="#4db1ff"></div>
                <div class="cad-muted">Thickness/Size</div><div><input id="p-stroke" class="cad-inp" type="number" min="1" max="20" value="2" style="width:80px"> px</div>
                <div class="cad-muted">Notes</div><div><textarea id="p-notes" rows="3" class="cad-inp" style="width:100%"></textarea></div>
                <div class="cad-muted">Scale</div><div><span id="scaleLabel" class="cad-small">1 px = 1.00 u</span></div>
              </div>
              <p class="cad-small" style="margin-top:8px">Double click ends polyline. Shift = perfect square/circle. Angle: vertex→arm1→arm2.</p>
            </aside>
          </div>

          <div class="cad-status">
            <div>Tool: <span id="statusTool">Select</span> · Zoom: <span id="statusZoom">100%</span> · Units: <span id="unitLabel">u</span></div>
            <div class="cad-right">
              <span>Cursor: <span id="statusXY">x:0, y:0</span></span>
              <a id="helpLink" class="cad-link" href="#">Shortcuts</a>
            </div>
          </div>

          <!-- Modal Familias -->
          <div class="cad-modalbg" id="modalBg" aria-hidden="true">
            <div class="cad-modal" role="dialog" aria-modal="true">
              <header>
                <h3>Families (icon + color)</h3>
                <div>
                  <span id="tableCount" class="cad-small" style="margin-right:8px">—</span>
                  <button class="cad-btn" id="btnToggleRows"><span id="toggleRowsText">Show more</span></button>
                  <button class="cad-btn" id="btnCopyJSON">Copy JSON</button>
                  <button class="cad-btn danger" id="btnCloseModal">Close</button>
                </div>
              </header>
              <div class="content">
                <table class="cad-table" id="table">
                  <thead><tr><th>#</th><th>Icon</th><th>Color</th><th>Annotation</th><th>Count</th><th>Go</th><th>Delete group</th></tr></thead>
                  <tbody></tbody>
                </table>
                <h4 style="margin:14px 0 6px">Summary</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                  <div>
                    <table class="cad-table" id="summaryByIcon"><thead><tr><th>Icon</th><th>Count</th></tr></thead><tbody></tbody></table>
                  </div>
                  <div>
                    <table class="cad-table" id="summaryByIconColor"><thead><tr><th>Icon + Color</th><th>Count</th></tr></thead><tbody></tbody></table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Modal Escalas -->
          <div class="cad-modalbg" id="scalesModalBg" aria-hidden="true">
            <div class="cad-modal" role="dialog" aria-modal="true">
              <header>
                <h3>Scale manager</h3>
                <div>
                  <button class="cad-btn" id="btnAddScale">Add</button>
                  <button class="cad-btn danger" id="btnCloseScales">Close</button>
                </div>
              </header>
              <div class="content">
                <table class="cad-table" id="scalesTable">
                  <thead><tr><th>Nombre</th><th>1 px = (unidades)</th><th>Unidad</th><th>Acciones</th></tr></thead>
                  <tbody></tbody>
                </table>
                <p class="cad-small" style="margin-top:8px">Tip: calibrate with two points (U) and then “Save as scale”.</p>
              </div>
            </div>
          </div>
        </div>
      `;

      // Cache de nodos importantes
      this.canvas = this.$('#canvas');
      this.ctx = this.canvas.getContext('2d', { alpha: true });
  // make canvas focusable so it can receive keyboard events
  try{ this.canvas.tabIndex = 0; }catch(e){}
  // focus canvas initially so keyboard navigation works
  try{ if (this.canvas && typeof this.canvas.focus === 'function') this.canvas.focus(); }catch(e){}
  // When the document or app navigation returns to this view, ensure the canvas regains focus
  try{
    this._visHandler = () => {
      try{
        if (document.visibilityState === 'visible'){
          const r = this.container.getBoundingClientRect();
          const style = window.getComputedStyle(this.container);
          if (r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'){
            // try focusing embedded PDF iframe first (if present), otherwise focus canvas
            try{
              const iframe = this.container.querySelector('iframe');
              if (iframe && typeof iframe.focus === 'function') { iframe.focus(); return; }
            }catch(e){}
            if (this.canvas && typeof this.canvas.focus === 'function') this.canvas.focus();
          }
        }
      }catch(e){}
    };
    document.addEventListener('visibilitychange', this._visHandler);

    this._uiNavigateHandler = (e) => {
      try{
        const r = this.container.getBoundingClientRect();
        const style = window.getComputedStyle(this.container);
        if (r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'){
          try{
            const iframe = this.container.querySelector('iframe');
            if (iframe && typeof iframe.focus === 'function') { iframe.focus(); return; }
          }catch(e){}
          if (this.canvas && typeof this.canvas.focus === 'function') this.canvas.focus();
        }
      }catch(e){}
    };
    window.addEventListener('ui:navigate', this._uiNavigateHandler);
  }catch(e){}

  // Diagnostic: optional global preventDefault logger (enable by setting localStorage.debug_key_blocker = '1')
  try{
    if (!window.__preventDefaultWrapped) {
      const orig = Event.prototype.preventDefault;
      Event.prototype.preventDefault = function(){
        try{
          if (localStorage && localStorage.getItem && localStorage.getItem('debug_key_blocker') === '1'){
            try{
              const ev = this;
              if (ev && ev.type === 'keydown'){
                const stack = new Error().stack || '';
                console.warn('[DEBUG preventDefault] key=', ev.key, 'target=', ev.target, 'activeElement=', document.activeElement, '\nstack:', stack.split('\n').slice(0,6).join('\n'));
              }
            }catch(e){}
          }
        }catch(e){}
        return orig.apply(this, arguments);
      };
      window.__preventDefaultWrapped = true;
    }
  }catch(e){}

  // Add lightweight diagnostic info in our local keydown handler to show target/focus when arrows/page are pressed
  try{
    const _origKeydown = window._manualprinted_dbg_keydown;
    if (!window._manualprinted_dbg_keydown) {
      window._manualprinted_dbg_keydown = (e) => {
        try{
          if (['arrowright','arrowleft','pagedown','pageup'].includes(e.key.toLowerCase())){
            if (localStorage && localStorage.getItem && localStorage.getItem('debug_key_blocker') === '1'){
              console.debug('[manualprinted keydown] key=', e.key, 'target=', e.target, 'activeElement=', document.activeElement, 'defaultPrevented=', e.defaultPrevented);
            }
          }
        }catch(err){}
      };
      window.addEventListener('keydown', window._manualprinted_dbg_keydown, true);
    }
  }catch(e){}
      this.rulerTop = this.$('#rulerTop'); this.rtx = this.rulerTop.getContext('2d');
      this.rulerLeft = this.$('#rulerLeft'); this.rly = this.rulerLeft.getContext('2d');
      this.scaleBar = this.$('#scaleBar');

      // Bind events
      this._bindUI();
      this._boot();
    }

    async _boot() {
      await this._ensurePdfJs();
      await this._ensureJsPdf();
      await this._ensureAppStore();
      // crear wrappers debounced para reducir escrituras frecuentes
      try {
        // debounced wrappers should call the actual implementations to avoid recursion
        this._debouncedSaveLocal = this._debounce(() => this._saveLocal(), 300);
        this._debouncedEmitFamiliesUpdate = this._debounce(() => this._emitFamiliesUpdate(), 300);
      } catch (e) { /* fallbacks si algo falla */ }
      this._loadLocal();
      this.ensurePageArrays();
      this.$('#btnGrid').classList.toggle('active', this.state.showGrid);
      this.$('#btnRulers').classList.toggle('active', this.state.showRulers);
      this.$('#scaleLabel').textContent = `1 px = ${this.round(this.state.unitPerPx, 4)} ${this.state.unitName}`;
      window.addEventListener('resize', () => this._resizeCanvas());
      this._resizeCanvas();
      this.$('#statusZoom').textContent = '100%';
      this._updateCursor(false);
      this._render();
  // Ensure we persist on full page unload as a safety net
  try { window.addEventListener('beforeunload', () => { try { this._saveLocal(); } catch(e){} }); } catch(e) {}
      // subscribe to AppStore shape changes so other components can update this view
      try{
        if(window.AppStore && typeof window.AppStore.subscribe === 'function'){
          this._appStoreUnsub = window.AppStore.subscribe('shapes:changed', (payload)=>{
            try{
              console.debug('[CADLite] AppStore shapes:changed payload=', payload);
              if(!payload || payload.pageKey !== this.pageKey()) return;
              if(this._suppressStore) return; // avoid reacting to our own writes
              this.shapesByPage[payload.pageKey] = payload.shapes || [];
              this.ensurePageArrays(); this._select(null); this._render();
            }catch(e){console.error('AppStore handler error',e)}
          });
        }
      }catch(e){/* ignore */}
    }

    /* ================== Persistencia ================== */
    _saveLocal() {
      // persist to AppStore when available, otherwise fallback to localStorage
      try {
        try { console.debug('[CADLite] _saveLocal: saving shapesByPage keys=', Object.keys(this.shapesByPage || {})); } catch(e){}
        const payload = {
          shapesByPage: this.shapesByPage,
          unitName: this.state.unitName,
          unitPerPx: this.state.unitPerPx,
          showGrid: this.state.showGrid,
          showRulers: this.state.showRulers,
          scales: this.scales,
          // persist background image (dataURL) so the plano stays when navigating
          bgData: this._bgData || null,
          // persist full PDF data (dataURL) if loaded from file so we can restore the whole document
          pdfData: this._pdfData || null,
          pdfFingerprint: this.pdfFingerprint || null,
          bgKey: this._bgKey || null,
          currentDocType: this.currentDocType || 'none',
          pdfCurrent: this.pdfCurrent || 1,
          pdfTotal: this.pdfTotal || 0
        };
        if (window.AppStore && typeof window.AppStore.setShapes === 'function'){
          // push per-page to store to minimize writes
          this._suppressStore = true;
          for(const k of Object.keys(this.shapesByPage)){
            try { console.debug('[CADLite] _saveLocal: AppStore.setShapes key=', k, 'count=', (this.shapesByPage[k] || []).length); } catch(e){}
            window.AppStore.setShapes(k, this.shapesByPage[k] || []);
          }
          // meta
          window.AppStore.setMeta('cad.meta', { unitName: this.state.unitName, unitPerPx: this.state.unitPerPx, showGrid: this.state.showGrid, showRulers: this.state.showRulers, scales: this.scales, bgData: this._bgData || null, pdfData: this._pdfData || null, pdfFingerprint: this.pdfFingerprint || null, bgKey: this._bgKey || null, currentDocType: this.currentDocType || 'none', pdfCurrent: this.pdfCurrent || 1, pdfTotal: this.pdfTotal || 0 });
          this._suppressStore = false;
        } else {
          try { console.debug('[CADLite] _saveLocal: localStorage set key=', this.LS_KEY); } catch(e){}
          localStorage.setItem(this.LS_KEY, JSON.stringify(payload));
        }
        this._syncBlueprintSummary();
      } catch (e) { console.warn('saveLocal failed', e); }
    }
    _buildBlueprintSummary() {
      const pages = [];
      const totalsByIcon = {};
      const totalsByIconColor = {};
      let totalShapes = 0;
      let totalIcons = 0;
      for (const [pageKey, shapes = []] of Object.entries(this.shapesByPage || {})) {
        const icons = shapes.filter(s => s?.type === 'icon');
        const iconTotals = {};
        const iconColorTotals = {};
        totalShapes += shapes.length;
        totalIcons += icons.length;
        for (const shape of icons) {
          const icon = (shape.icon || '').replace(/^custom:/, '') || (shape.name || 'icon');
          const color = shape.color || '#4db1ff';
          iconTotals[icon] = (iconTotals[icon] || 0) + 1;
          totalsByIcon[icon] = (totalsByIcon[icon] || 0) + 1;
          const colorKey = `${icon}|${color}`;
          iconColorTotals[colorKey] = (iconColorTotals[colorKey] || 0) + 1;
          totalsByIconColor[colorKey] = (totalsByIconColor[colorKey] || 0) + 1;
        }
        pages.push({
          pageKey,
          totalShapes: shapes.length,
          iconTotals,
          iconColorTotals
        });
      }
      return {
        pages,
        totals: {
          totalShapes,
          totalIcons,
          totalPages: pages.length
        },
        byIcon: totalsByIcon,
        byIconColor: totalsByIconColor,
        unitName: this.state.unitName,
        unitPerPx: this.state.unitPerPx,
        updatedAt: new Date().toISOString()
      };
    }
    _syncBlueprintSummary() {
      try {
        if (window.AppStore && typeof window.AppStore.setBlueprintSummary === 'function') {
          window.AppStore.setBlueprintSummary(this._buildBlueprintSummary());
        }
      } catch (err) {
        console.warn('Blueprint summary sync failed', err);
      }
    }
    _loadLocal() {
      try {
        // prefer AppStore
        if (window.AppStore && typeof window.AppStore.getShapes === 'function'){
          // Attempt to restore meta first so we can load shapes tied to that background/pdf page
          const meta = window.AppStore.getMeta && window.AppStore.getMeta('cad.meta');
          if (meta) {
            if (meta.unitName) this.state.unitName = meta.unitName;
            if (meta.unitPerPx) this.state.unitPerPx = meta.unitPerPx;
            if (typeof meta.showGrid === 'boolean') this.state.showGrid = meta.showGrid;
            if (typeof meta.showRulers === 'boolean') this.state.showRulers = meta.showRulers;
            if (Array.isArray(meta.scales)) this.scales = meta.scales;
            if (meta.pdfFingerprint) this.pdfFingerprint = meta.pdfFingerprint;

            // if AppStore has shapes saved for the exact bgKey, load them into shapesByPage
            try {
              if (meta.bgKey) {
                const remoteBg = window.AppStore.getShapes(meta.bgKey) || [];
                if (Array.isArray(remoteBg)) this.shapesByPage[meta.bgKey] = remoteBg;
              }
              // if meta indicates a pdf page, try to load shapes for that pdf page key
              if (meta.currentDocType === 'pdf' && meta.pdfCurrent) {
                const pdfKey = `pdf_${meta.pdfCurrent}`;
                const remotePdf = window.AppStore.getShapes(pdfKey) || [];
                if (Array.isArray(remotePdf)) this.shapesByPage[pdfKey] = remotePdf;
              }
            } catch (e) { /* ignore AppStore per-key read errors */ }

            // restore background if present in meta (image or rendered PDF page)
            if (meta.bgData) {
              const img = new Image();
              img.onload = async () => {
                this.bgImg = img;
                this._bgData = meta.bgData;
                this._bgKey = meta.bgKey || null;
                this.currentDocType = meta.currentDocType || 'image';
                const restoredPage = meta.pdfCurrent || this.pdfCurrent;
                this.pdfCurrent = restoredPage || this.pdfCurrent;
                this.pdfTotal = meta.pdfTotal || this.pdfTotal;
                this.pdfFingerprint = meta.pdfFingerprint || this.pdfFingerprint;

                let pdfReady = false;
                if (this.currentDocType === 'pdf') {
                  if (meta.pdfData) {
                    try {
                      this._pdfData = meta.pdfData;
                      await this._loadPDF(this._pdfData);
                      pdfReady = true;
                    } catch (err) {
                      console.warn('restore pdf from AppStore meta failed', err);
                    }
                  } else {
                    const fingerprint = meta.pdfFingerprint;
                    const cachedEntry = (fingerprint && PDF_CACHE.get(fingerprint)) || PDF_CACHE.get('__last__');
                    if (cachedEntry && cachedEntry.doc) {
                      this.pdfDoc = cachedEntry.doc;
                      this.pdfTotal = cachedEntry.total || (this.pdfDoc?.numPages || this.pdfTotal);
                      this._pdfData = cachedEntry.data || this._pdfData;
                      this.pdfFingerprint = cachedEntry.fingerprint || fingerprint || this.pdfFingerprint;
                      this.currentDocType = 'pdf';
                      pdfReady = true;
                    }
                  }

                  if (pdfReady) {
                    const targetPage = this.clamp(restoredPage || 1, 1, this.pdfTotal || 1);
                    this.pdfCurrent = targetPage;
                    try {
                      await this._renderPDFPage(this.pdfCurrent);
                    } catch (err) {
                      console.warn('restore pdf page failed', err);
                    }
                  }
                }

                try { this.$('#pdfPageIndicator').textContent = this.currentDocType === 'pdf' ? `PDF: ${this.pdfCurrent}/${this.pdfTotal}` : 'Image'; } catch(e){}
                // ensure arrays exist for the restored page key and render
                this.ensurePageArrays(); this._select(null); this._render();
              };
              img.src = meta.bgData;
            }
          }

          // finally, try to load shapes for the runtime pageKey (could be global if no bg/meta yet)
          try {
            const key = this.pageKey();
            const remote = window.AppStore.getShapes(key) || [];
            if (Array.isArray(remote) && remote.length) { this.shapesByPage[key] = remote; }
          } catch (e) { /* ignore */ }
          return;
        }
        const t = localStorage.getItem(this.LS_KEY); if (!t) return;
        const d = JSON.parse(t);
        if (d.shapesByPage && typeof d.shapesByPage === 'object') this.shapesByPage = d.shapesByPage;
        else if (Array.isArray(d.shapes)) this.shapesByPage = { global: d.shapes };
        if (d.unitName) this.state.unitName = d.unitName;
        if (d.unitPerPx) this.state.unitPerPx = d.unitPerPx;
        if (typeof d.showGrid === 'boolean') this.state.showGrid = d.showGrid;
        if (typeof d.showRulers === 'boolean') this.state.showRulers = d.showRulers;
        if (Array.isArray(d.scales)) this.scales = d.scales;
        if (d.pdfFingerprint) this.pdfFingerprint = d.pdfFingerprint;
        // restore background image if persisted
        if (d.bgData) {
          const img = new Image();
          img.onload = async () => {
            this.bgImg = img;
            this._bgData = d.bgData;
            this._bgKey = d.bgKey || null;
            this.currentDocType = d.currentDocType || 'image';
            const restoredPage = d.pdfCurrent || this.pdfCurrent;
            this.pdfCurrent = restoredPage || this.pdfCurrent;
            this.pdfTotal = d.pdfTotal || this.pdfTotal;
            this.pdfFingerprint = d.pdfFingerprint || this.pdfFingerprint;

            let pdfReady = false;
            if (this.currentDocType === 'pdf') {
              if (d.pdfData) {
                try {
                  this._pdfData = d.pdfData;
                  await this._loadPDF(this._pdfData);
                  pdfReady = true;
                } catch (err) {
                  console.warn('restore pdf from localStorage failed', err);
                }
              } else {
                const fingerprint = d.pdfFingerprint;
                const cachedEntry = (fingerprint && PDF_CACHE.get(fingerprint)) || PDF_CACHE.get('__last__');
                if (cachedEntry && cachedEntry.doc) {
                  this.pdfDoc = cachedEntry.doc;
                  this.pdfTotal = cachedEntry.total || (this.pdfDoc?.numPages || this.pdfTotal);
                  this._pdfData = cachedEntry.data || this._pdfData;
                  this.pdfFingerprint = cachedEntry.fingerprint || fingerprint || this.pdfFingerprint;
                  this.currentDocType = 'pdf';
                  pdfReady = true;
                }
              }

              if (pdfReady) {
                const targetPage = this.clamp(restoredPage || 1, 1, this.pdfTotal || 1);
                this.pdfCurrent = targetPage;
                try {
                  await this._renderPDFPage(this.pdfCurrent);
                } catch (err) {
                  console.warn('restore pdf page from cache failed', err);
                }
              }
            }

            try { this.$('#pdfPageIndicator').textContent = this.currentDocType === 'pdf' ? `PDF: ${this.pdfCurrent}/${this.pdfTotal}` : 'Image'; } catch(e){}
            this.ensurePageArrays(); this._select(null); this._render();
          };
          img.src = d.bgData;
        }
      } catch (e) { console.warn('loadLocal failed', e); }
      // final fallback: ensure current runtime page key has shapes array and is assigned to this.shapes
      try {
        const k = this.pageKey(); if (!this.shapesByPage[k]) this.shapesByPage[k] = [];
        this.shapes = this.shapesByPage[k];
      } catch(e){}
      try { this._syncBlueprintSummary(); } catch (err) { console.warn('Blueprint summary sync on load failed', err); }
    }
    // Public API: clear persisted background (image/pdf page)
    clearBackground() {
      try {
        const oldKey = this._bgKey;
        this.bgImg = null; this._bgData = null; this._bgKey = null; this.currentDocType = 'none'; this.pdfDoc = null; this.pdfCurrent = 1; this.pdfTotal = 0; this.pdfFingerprint = null;
        try { this.$('#pdfPageIndicator').textContent = '—'; } catch (e) {}
        // update persisted storage
        // remove persisted shapes associated to the old background key
        try {
          if (oldKey) {
            if (window.AppStore && typeof window.AppStore.setShapes === 'function') {
              window.AppStore.setShapes(oldKey, []);
            }
            if (localStorage && localStorage.getItem(this.LS_KEY)) {
              const raw = localStorage.getItem(this.LS_KEY); const d = JSON.parse(raw || '{}'); if (d && d.shapesByPage && d.shapesByPage[oldKey]) { delete d.shapesByPage[oldKey]; localStorage.setItem(this.LS_KEY, JSON.stringify(d)); }
            }
          }
        } catch(e){}
        this._maybeSave();
        this._render();
      } catch (e) { console.warn('clearBackground failed', e); }
    }
    _pushUndo() {
      const key = this.pageKey();
      this.undoMap[key].push(JSON.stringify(this.shapesByPage[key]));
      if (this.undoMap[key].length > 80) this.undoMap[key].shift();
      this.redoMap[key].length = 0;
      this._saveLocal();
    }
    _undo() {
      const key = this.pageKey(); if (!this.undoMap[key]?.length) return;
      this.redoMap[key].push(JSON.stringify(this.shapesByPage[key]));
      this.shapesByPage[key] = JSON.parse(this.undoMap[key].pop());
      this.ensurePageArrays();
      this._select(null); this._render(); this._saveLocal();
    }
    _redo() {
      const key = this.pageKey(); if (!this.redoMap[key]?.length) return;
      this.undoMap[key].push(JSON.stringify(this.shapesByPage[key]));
      this.shapesByPage[key] = JSON.parse(this.redoMap[key].pop());
      this.ensurePageArrays();
      this._select(null); this._render(); this._saveLocal();
    }

    /* ================== Canvas & Transform ================== */
    _resizeCanvas() {
      const stage = this.canvas.parentElement.getBoundingClientRect();
      this.W = this.canvas.width = Math.max(100, Math.floor(stage.width));
      this.H = this.canvas.height = Math.max(100, Math.floor(stage.height));
      this.rulerTop.width = Math.max(1, this.W - 20); this.rulerTop.height = 20;
      this.rulerLeft.width = 20; this.rulerLeft.height = Math.max(1, this.H - 20);
      this._render();
    }
    _screenToWorld([sx, sy]) { return [sx / this.view.scale + this.view.x, sy / this.view.scale + this.view.y]; }
    _worldToScreen([wx, wy]) { return [(wx - this.view.x) * this.view.scale, (wy - this.view.y) * this.view.scale]; }
    _applyTransform() { this.ctx.setTransform(this.view.scale, 0, 0, this.view.scale, -this.view.x * this.view.scale, -this.view.y * this.view.scale); }

    /* ================== Geometría/medidas ================== */
    _bbox(s) {
      if (!s) return { x: 0, y: 0, w: 0, h: 0 };
      if (s.type === 'rect') { const x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h); return { x, y, w: Math.abs(s.w), h: Math.abs(s.h) }; }
      if (s.type === 'circle') { return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 }; }
      if (s.type === 'poly') { if (!s.points?.length) return { x: 0, y: 0, w: 0, h: 0 }; const xs = s.points.map(p => p.x), ys = s.points.map(p => p.y); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
      if (s.type === 'text') { return { x: s.x, y: s.y - 12, w: 80, h: 20 }; }
      if (s.type === 'icon') { const size = (s.size || 28); return { x: s.x - size / 2, y: s.y - size / 2, w: size, h: size }; }
      if (s.type === 'measure') {
        if (s.kind === 'distance') { const x = Math.min(s.p1.x, s.p2.x), y = Math.min(s.p1.y, s.p2.y); return { x, y, w: Math.abs(s.p1.x - s.p2.x), h: Math.abs(s.p1.y - s.p2.y) }; }
        if (s.kind === 'angle') { const xs = [s.v.x, s.a.x, s.b.x], ys = [s.v.y, s.a.y, s.b.y]; return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
      }
      return { x: 0, y: 0, w: 0, h: 0 };
    }
    _len(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    _formatMeasure(s) {
      const upx = this.state.unitPerPx, u = this.state.unitName || 'u';
      if (s.type === 'measure' && s.kind === 'distance') { const L = this._len(s.p1, s.p2) * upx; return `${this.round(L, 2)} ${u}`; }
      if (s.type === 'measure' && s.kind === 'angle') {
        const v1 = { x: s.a.x - s.v.x, y: s.a.y - s.v.y }, v2 = { x: s.b.x - s.v.x, y: s.b.y - s.v.y };
        const dot = v1.x * v2.x + v1.y * v2.y, m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
        const ang = Math.acos(this.clamp(dot / (m1 * m2), -1, 1)) * 180 / Math.PI; return `${this.round(ang, 2)}°`;
      }
      return '—';
    }

    /* ================== Render principal ================== */
    _render() {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.W, this.H);
      if (this.bgImg) { ctx.save(); this._applyTransform(); ctx.drawImage(this.bgImg, 0, 0); ctx.restore(); }

      if (this.state.showGrid) {
        ctx.save(); this._applyTransform(); ctx.lineWidth = 1 / this.view.scale; ctx.strokeStyle = '#2a3341'; ctx.beginPath();
        const step = 40, startX = Math.floor(this.view.x / step) * step - step * 5, startY = Math.floor(this.view.y / step) * step - step * 5;
        const endX = this.view.x + this.W / this.view.scale + step * 5, endY = this.view.y + this.H / this.view.scale + step * 5;
        for (let x = startX; x < endX; x += step) { ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
        for (let y = startY; y < endY; y += step) { ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
        ctx.stroke(); ctx.restore();
      }

      ctx.save(); this._applyTransform();
      for (const s of this.shapes) {
        ctx.lineWidth = (s.stroke || 2) / this.view.scale; ctx.strokeStyle = s.color || '#4db1ff'; ctx.fillStyle = s.color || '#4db1ff';
        ctx.beginPath();
        if (s.type === 'rect') ctx.strokeRect(s.x, s.y, s.w, s.h);
        else if (s.type === 'circle') { ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); ctx.stroke(); }
        else if (s.type === 'poly' && s.points?.length) { ctx.moveTo(s.points[0].x, s.points[0].y); for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y); ctx.stroke(); }
        else if (s.type === 'text') { ctx.save(); ctx.font = `${(14 + (s.stroke || 2) * 1.2) / this.view.scale}px sans-serif`; ctx.fillText(s.text || s.name || '', s.x, s.y); ctx.restore(); }
        else if (s.type === 'icon') { this._drawIconCanvas(s); }
        else if (s.type === 'measure') { this._drawMeasure(s); }

        if (s.id === this.selectedId) { ctx.save(); ctx.setLineDash([6 / this.view.scale, 6 / this.view.scale]); ctx.strokeStyle = '#ffd166'; const b = this._bbox(s); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore(); }

        if (s.showLabel && s.name) {
          ctx.save();
          const b = this._bbox(s), label = s.name;
          const [sx, sy] = this._worldToScreen([b.x, b.y - 10 / this.view.scale]);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.font = '12px system-ui,sans-serif';
          const wtxt = ctx.measureText(label).width + 8;
          ctx.fillStyle = '#000c'; ctx.fillRect(sx + 20, sy - 14, wtxt, 16);
          ctx.fillStyle = '#fff'; ctx.fillText(label, sx + 24, sy);
          ctx.restore(); this._applyTransform();
        }
      }
      if (this.measureTemp) this._drawMeasure(this.measureTemp);
      ctx.restore();

      this._drawRulers(); this._drawScaleBar(); this._drawCrosshair();
      this.$('#unitLabel').textContent = this.state.unitName || 'u';
    }

    _drawMeasure(m) {
      const ctx = this.ctx;
      ctx.save();
      ctx.lineWidth = (m.stroke || 2) / this.view.scale;
      ctx.strokeStyle = m.color || '#ffd166';
      ctx.fillStyle = m.color || '#ffd166';
      ctx.setLineDash([8 / this.view.scale, 6 / this.view.scale]);
      if (m.kind === 'distance') {
        ctx.beginPath(); ctx.moveTo(m.p1.x, m.p1.y); ctx.lineTo(m.p2.x, m.p2.y); ctx.stroke();
        const mid = { x: (m.p1.x + m.p2.x) / 2, y: (m.p1.y + m.p2.y) / 2 };
        this._drawWorldLabel(mid.x, mid.y, this._formatMeasure(m));
      } else if (m.kind === 'angle') {
        ctx.beginPath(); ctx.moveTo(m.v.x, m.v.y); ctx.lineTo(m.a.x, m.a.y); ctx.moveTo(m.v.x, m.v.y); ctx.lineTo(m.b.x, m.b.y); ctx.stroke();
        const r = Math.min(60 / this.view.scale, Math.min(this._len(m.v, m.a), this._len(m.v, m.b)) / 2);
        const a1 = Math.atan2(m.a.y - m.v.y, m.a.x - m.v.x), a2 = Math.atan2(m.b.y - m.v.y, m.b.x - m.v.x);
        let start = a1, end = a2, d = ((end - start) + Math.PI * 2) % (Math.PI * 2);
        if (d > Math.PI) { const tmp = start; start = end; end = tmp; d = ((end - start) + Math.PI * 2) % (Math.PI * 2); }
        ctx.setLineDash([]); ctx.beginPath(); ctx.arc(m.v.x, m.v.y, r, start, end); ctx.stroke();
        this._drawWorldLabel(m.v.x + Math.cos((start + end) / 2) * (r + 8 / this.view.scale), m.v.y + Math.sin((start + end) / 2) * (r + 8 / this.view.scale), this._formatMeasure(m));
      }
      ctx.restore();
    }
    _drawWorldLabel(wx, wy, text) {
      const ctx = this.ctx;
      const [sx, sy] = this._worldToScreen([wx, wy]);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.font = '12px system-ui,sans-serif';
      const w = ctx.measureText(text).width + 8;
      ctx.fillStyle = '#000c'; ctx.fillRect(sx - w / 2, sy - 14, w, 16);
      ctx.fillStyle = '#fff'; ctx.fillText(text, sx - w / 2 + 4, sy);
      ctx.restore(); this._applyTransform();
    }

    _niceStep(px) {
      const pow = Math.pow(10, Math.floor(Math.log10(px)));
      const base = px / pow;
      if (base < 1.5) return 1 * pow;
      if (base < 3.5) return 2 * pow;
      if (base < 7.5) return 5 * pow;
      return 10 * pow;
    }
    _drawRulers() {
      const show = this.state.showRulers;
      this.rulerTop.style.display = show ? 'block' : 'none';
      this.rulerLeft.style.display = show ? 'block' : 'none';
      this.$('#rulerCorner').style.display = show ? 'block' : 'none';
      if (!show) return;
      const rtx = this.rtx, rly = this.rly;
      // Top
      rtx.clearRect(0, 0, this.rulerTop.width, this.rulerTop.height);
      rtx.fillStyle = '#0e141b'; rtx.fillRect(0, 0, this.rulerTop.width, this.rulerTop.height);
      rtx.strokeStyle = '#2a3a4c'; rtx.fillStyle = '#9bb3c7'; rtx.font = '10px system-ui';
      const upx = this.state.unitPerPx, targetPx = 80, unitsPerScreenPx = upx / this.view.scale, unitsPerTick = this._niceStep(targetPx * unitsPerScreenPx), tickScreen = unitsPerTick * (1 / unitsPerScreenPx);
      const x0 = -this.view.x * this.view.scale + 20; let start = x0 % tickScreen;
      for (let x = start; x < this.rulerTop.width; x += tickScreen) { const wx = ((x - x0) / this.view.scale) * upx; rtx.beginPath(); rtx.moveTo(x, 20); rtx.lineTo(x, 0); rtx.stroke(); rtx.fillText(`${this.round(wx, 2)}`, x + 2, 10); }
      // Left
      rly.clearRect(0, 0, this.rulerLeft.width, this.rulerLeft.height);
      rly.fillStyle = '#0e141b'; rly.fillRect(0, 0, this.rulerLeft.width, this.rulerLeft.height);
      rly.strokeStyle = '#2a3a4c'; rly.fillStyle = '#9bb3c7'; rly.font = '10px system-ui';
      const y0 = -this.view.y * this.view.scale + 20; start = y0 % tickScreen;
      for (let y = start; y < this.rulerLeft.height; y += tickScreen) {
        const wy = ((y - y0) / this.view.scale) * upx; rly.beginPath(); rly.moveTo(20, y); rly.lineTo(0, y); rly.stroke();
        rly.save(); rly.translate(2, y - 2); rly.rotate(-Math.PI / 2); rly.fillText(`${this.round(wy, 2)}`, 0, 0); rly.restore();
      }
    }
    _drawScaleBar() {
      const targetPx = 140, upx = this.state.unitPerPx, unitsPerScreenPx = upx / this.view.scale, niceUnits = this._niceStep(targetPx * unitsPerScreenPx);
      this.scaleBar.textContent = `— ${this.round(niceUnits, 2)} ${this.state.unitName} —`;
    }
    _drawCrosshair() {
      const drawing = ['rect', 'circle', 'poly', 'text', 'ruler', 'angle', 'icon'];
      if (!this.mouseScreen || !(drawing.includes(this.tool)) || this.panningBySpace) return;
      const ctx = this.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0);
      const [sx, sy] = this.mouseScreen, len = 8;
      ctx.lineWidth = 1; ctx.strokeStyle = '#ffffffcc'; ctx.beginPath();
      ctx.moveTo(sx, sy - len - 4); ctx.lineTo(sx, sy - 2);
      ctx.moveTo(sx, sy + 2); ctx.lineTo(sx, sy + len + 4);
      ctx.moveTo(sx - len - 4, sy); ctx.lineTo(sx - 2, sy);
      ctx.moveTo(sx + 2, sy); ctx.lineTo(sx + len + 4, sy);
      ctx.stroke(); ctx.fillStyle = '#ffffffcc'; ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }

    /* ================== Selección / HitTest ================== */
    _select(id) {
      this.selectedId = id;
      const s = this.shapes.find(x => x.id === id);
      this.$('#p-id').textContent = s ? s.id : '—';
      this.$('#p-type').textContent = s ? s.type : '—';
      this.$('#p-name').value = s ? (s.name || '') : '';
      this.$('#p-showlabel').checked = !!(s && s.showLabel);
      this.$('#p-color').value = s ? (s.color || '#4db1ff') : '#4db1ff';
      this.$('#p-stroke').value = s ? (s.type === 'icon' ? (s.size || 28) : (s.stroke || 2)) : 2;
      this.$('#p-notes').value = s ? (s.notes || '') : '';
    }
    _hitTest(world) {
      const f = this.shapes.slice().reverse().find(s => {
        const b = this._bbox(s);
        return world[0] >= b.x && world[0] <= b.x + b.w && world[1] >= b.y && world[1] <= b.y + b.h;
      });
      return f?.id || null;
    }

    /* ================== UI/Events ================== */
    _updateCursor(over = false) {
      if (this.tool === 'pan' || this.panningBySpace) { this.canvas.style.cursor = this.isDown ? 'grabbing' : 'grab'; }
      else if (this.tool === 'select') { this.canvas.style.cursor = over ? 'pointer' : 'default'; }
      else { this.canvas.style.cursor = 'crosshair'; }
    }
    _setTool(t) {
      this.tool = t;
      this.$all('#tools .cad-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  this.$('#statusTool').textContent = ({ select: 'Select', pan: 'Pan', rect: 'Rectangle', circle: 'Circle', poly: 'Polyline', text: 'Text', ruler: 'Ruler', angle: 'Angle', icon: 'Icon' })[t];
      this._updateCursor(false);
    }

    _bindUI() {
      const $ = this.$.bind(this);

      // Herramientas
      this.$all('#tools .cad-btn[data-tool]').forEach(b => {
        b.addEventListener('click', () => { this._setTool(b.dataset.tool); });
      });

      // Canvas mouse
      this.canvas.addEventListener('mousedown', (e) => {
        this.isDown = true;
        const world = this._screenToWorld([e.offsetX, e.offsetY]);
        this.startWorld = world; this.measureTemp = null;

        if (this.tool === 'select') {
          const id = this._hitTest(world); if (this.selectedId !== id) this._select(id);
          this.activeShape = this.shapes.find(s => s.id === this.selectedId) || null; this.panLast = [e.clientX, e.clientY];
          if (this.activeShape) this._pushUndo();
        } else if (this.tool === 'pan') {
          this.panLast = [e.clientX, e.clientY];
        } else if (this.tool === 'rect') {
          this._pushUndo(); const id = this.uuid();
          this.activeShape = { id, type: 'rect', name: 'Rectangle', x: world[0], y: world[1], w: 0, h: 0, color: $('#color').value, stroke: +$('#stroke').value, created: Date.now(), showLabel: false };
          this.shapes.push(this.activeShape); this._select(id);
        } else if (this.tool === 'circle') {
          this._pushUndo(); const id = this.uuid();
          this.activeShape = { id, type: 'circle', name: 'Circle', cx: world[0], cy: world[1], r: 0, color: $('#color').value, stroke: +$('#stroke').value, created: Date.now(), showLabel: false };
          this.shapes.push(this.activeShape); this._select(id);
        } else if (this.tool === 'poly') {
          if (!this.polyWorking) {
            this._pushUndo(); const id = this.uuid();
            this.polyWorking = this.activeShape = { id, type: 'poly', name: 'Polyline', points: [{ x: world[0], y: world[1] }], color: $('#color').value, stroke: +$('#stroke').value, created: Date.now(), showLabel: false };
            this.shapes.push(this.activeShape); this._select(id);
          } else { this.polyWorking.points.push({ x: world[0], y: world[1] }); }
        } else if (this.tool === 'text') {
          const text = prompt('Text to insert:', 'Label');
          if (text !== null) {
            this._pushUndo(); const id = this.uuid();
            const s = { id, type: 'text', name: 'Text', text, x: world[0], y: world[1], color: $('#color').value, stroke: +$('#stroke').value, created: Date.now(), showLabel: false };
            this.shapes.push(s); this._select(id);
          }
        } else if (this.tool === 'ruler') {
          this.measureTemp = { id: 'tmp', type: 'measure', kind: 'distance', p1: { x: world[0], y: world[1] }, p2: { x: world[0], y: world[1] }, color: '#ffd166', stroke: 2 };
        } else if (this.tool === 'angle') {
          if (!this.measureTemp) { this.measureTemp = { id: 'tmp', type: 'measure', kind: 'angle', v: { x: world[0], y: world[1] }, a: { x: world[0], y: world[1] }, b: { x: world[0], y: world[1] }, step: 1, color: '#ffd166', stroke: 2 }; }
          else if (this.measureTemp.step === 1) { this.measureTemp.a = { x: world[0], y: world[1] }; this.measureTemp.step = 2; }
          else if (this.measureTemp.step === 2) {
            this.measureTemp.b = { x: world[0], y: world[1] }; this._pushUndo(); const id = this.uuid();
            const s = { id, type: 'measure', kind: 'angle', v: this.measureTemp.v, a: this.measureTemp.a, b: this.measureTemp.b, color: '#ffd166', stroke: 2, created: Date.now() };
            this.shapes.push(s); this.measureTemp = null; this._select(id);
          }
        } else if (this.tool === 'icon') {
          this._pushUndo();
          const id = this.uuid(); const iconName = $('#iconSelect').value; const size = +$('#iconSize').value || 28;
          const s = { id, type: 'icon', name: iconName.slice(7), icon: iconName, x: world[0], y: world[1], size, color: $('#color').value, created: Date.now(), showLabel: false };
          this.shapes.push(s); this._select(id);
          // notify materials consumer (debounced when available)
          try{ this._maybeEmitFamilies(); }catch(e){ }
        }

        this._updateCursor(); this._render();
      });

      this.canvas.addEventListener('mousemove', (e) => {
        this.mouseScreen = [e.offsetX, e.offsetY];
        const world = this._screenToWorld([e.offsetX, e.offsetY]);
        this.$('#statusXY').textContent = `x:${this.round(world[0])}, y:${this.round(world[1])}`;
        let over = false;

        if (!this.isDown) {
          if (this.tool === 'select') { const id = this._hitTest(world); over = !!id; }
          if (this.tool === 'ruler' && this.measureTemp) { this.measureTemp.p2 = { x: world[0], y: world[1] }; }
          if (this.tool === 'angle' && this.measureTemp) { if (this.measureTemp.step === 1) this.measureTemp.a = { x: world[0], y: world[1] }; else if (this.measureTemp.step === 2) this.measureTemp.b = { x: world[0], y: world[1] }; }
          this._updateCursor(over); this._render(); return;
        }

        if (this.tool === 'select' && this.activeShape) {
          const dx = (e.clientX - this.panLast[0]) / this.view.scale, dy = (e.clientY - this.panLast[1]) / this.view.scale; this.panLast = [e.clientX, e.clientY];
          const s = this.activeShape;
          if (s.type === 'rect') { s.x += dx; s.y += dy; }
          if (s.type === 'circle') { s.cx += dx; s.cy += dy; }
          if (s.type === 'poly') { s.points.forEach(p => { p.x += dx; p.y += dy; }); }
          if (s.type === 'text') { s.x += dx; s.y += dy; }
          if (s.type === 'icon') { s.x += dx; s.y += dy; }
          if (s.type === 'measure') {
            if (s.kind === 'distance') { s.p1.x += dx; s.p1.y += dy; s.p2.x += dx; s.p2.y += dy; }
            if (s.kind === 'angle') { s.v.x += dx; s.v.y += dy; s.a.x += dx; s.a.y += dy; s.b.x += dx; s.b.y += dy; }
          }
        } else if (this.tool === 'pan' || this.panningBySpace) {
          const dx = (e.clientX - this.panLast[0]) / this.view.scale, dy = (e.clientY - this.panLast[1]) / this.view.scale; this.view.x -= dx; this.view.y -= dy; this.panLast = [e.clientX, e.clientY];
        } else if (this.tool === 'rect' && this.activeShape) {
          const w = this._screenToWorld([e.offsetX, e.offsetY]); let rw = w[0] - this.startWorld[0], rh = w[1] - this.startWorld[1];
          if (this.state.snap) { rw = this.snapIf(rw); rh = this.snapIf(rh); } if (this.shiftHeld) { const m = Math.max(Math.abs(rw), Math.abs(rh)); rw = Math.sign(rw) * m; rh = Math.sign(rh) * m; }
          this.activeShape.w = rw; this.activeShape.h = rh;
        } else if (this.tool === 'circle' && this.activeShape) {
          const w = this._screenToWorld([e.offsetX, e.offsetY]); let r = Math.hypot(w[0] - this.startWorld[0], w[1] - this.startWorld[1]); if (this.state.snap) r = this.snapIf(r);
          this.activeShape.r = r;
        } else if (this.tool === 'ruler' && this.measureTemp) { this.measureTemp.p2 = { x: world[0], y: world[1] }; }
        else if (this.tool === 'angle' && this.measureTemp) { if (this.measureTemp.step === 1) this.measureTemp.a = { x: world[0], y: world[1] }; else if (this.measureTemp.step === 2) this.measureTemp.b = { x: world[0], y: world[1] }; }

        this._render();
      });

      this.canvas.addEventListener('mouseleave', () => { this.mouseScreen = null; this._render(); });
      this.canvas.addEventListener('mouseup', () => {
        this.isDown = false;
        if (this.tool === 'ruler' && this.measureTemp) {
          this._pushUndo(); const id = this.uuid();
          const s = { id, type: 'measure', kind: 'distance', p1: { ...this.measureTemp.p1 }, p2: { ...this.measureTemp.p2 }, color: '#ffd166', stroke: 2, created: Date.now() };
          this.shapes.push(s); this.measureTemp = null; this._select(id);
        }
  this.activeShape = null; this._updateCursor(); this._maybeSave(); this._render();
      });
  this.canvas.addEventListener('dblclick', () => { if (this.tool === 'poly' && this.polyWorking) { this.polyWorking = null; this.activeShape = null; this._render(); this._maybeSave(); } });
      this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); const delta = e.deltaY > 0 ? 0.9 : 1.1; const mouse = [e.offsetX, e.offsetY]; const before = this._screenToWorld(mouse); this.view.scale = this.clamp(this.view.scale * delta, 0.2, 8); const after = this._screenToWorld(mouse); this.view.x += before[0] - after[0]; this.view.y += before[1] - after[1]; this.$('#statusZoom').textContent = `${Math.round(this.view.scale * 100)}%`; this._render(); }, { passive: false });

      // Propiedades
  this.$('#p-name').addEventListener('input', e => { const s = this.shapes.find(x => x.id === this.selectedId); if (s) { s.name = e.target.value; this._maybeSave(); this._render(); } });
  this.$('#p-showlabel').addEventListener('change', e => { const s = this.shapes.find(x => x.id === this.selectedId); if (s) { s.showLabel = e.target.checked; this._maybeSave(); this._render(); } });
  this.$('#p-color').addEventListener('input', e => { const s = this.shapes.find(x => x.id === this.selectedId); if (s) { s.color = e.target.value; this._render(); this._maybeSave(); } });
  this.$('#p-stroke').addEventListener('input', e => { const s = this.shapes.find(x => x.id === this.selectedId); if (s) { if (s.type === 'icon') { s.size = +e.target.value; } else { s.stroke = +e.target.value; } this._render(); this._maybeSave(); } });
  this.$('#p-notes').addEventListener('input', e => { const s = this.shapes.find(x => x.id === this.selectedId); if (s) { s.notes = e.target.value; this._maybeSave(); } });

      // Archivo: imagen
      this.$('#fileInput').addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        // read file as dataURL so we can persist it
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            this.currentDocType = 'image'; this.pdfDoc = null; this.pdfTotal = 0;
            this.$('#pdfPageIndicator').textContent = 'Image';
            this.bgImg = img; this._bgData = reader.result; // persistable dataURL
            // associate shapes with this specific background
            try { this._bgKey = 'img_' + this._hashStr(this._bgData); } catch (e) { this._bgKey = 'img_' + this.uuid(); }
            this._fitTo(img.width, img.height);
            this.ensurePageArrays(); this._select(null); this._render(); this._maybeSave();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
      });

      // Export PNG 1:1
      this.$('#btnSnapshot').addEventListener('click', () => {
        const url = this.canvas.toDataURL('image/png'); const a = document.createElement('a'); a.href = url; a.download = 'snapshot.png'; a.click();
      });
      // Export PNG hi-res
      this.$('#btnSnapshotHi').addEventListener('click', () => {
        const s = parseFloat(prompt('Scale (e.g. 2 = 2× resolution):', '2')) || 2;
        this._exportPngHiRes(s, false, `snapshot@${s}x.png`);
      });

      // Export PDF
      this.$('#btnExportPdfPage').addEventListener('click', async () => { await this._exportPdfCurrentPage(); });
      this.$('#btnExportPdfDoc').addEventListener('click', async () => { await this._exportPdfDocument(); });

      // Export/Import JSON
      this.$('#btnExport').addEventListener('click', () => {
        const data = { createdAt: new Date().toISOString(), unitName: this.state.unitName, unitPerPx: this.state.unitPerPx, shapesByPage: this.shapesByPage, showGrid: this.state.showGrid, showRulers: this.state.showRulers, scales: this.scales, bgData: this._bgData || null, currentDocType: this.currentDocType || 'none', pdfCurrent: this.pdfCurrent || 1, pdfTotal: this.pdfTotal || 0 };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'annotations.json'; a.click();
      });
      this.$('#jsonInput').addEventListener('change', (e) => {
        const f = e.target.files[0]; if (!f) return; const r = new FileReader();
        r.onload = () => {
          try {
            const d = JSON.parse(r.result);
            if (d.shapesByPage) this.shapesByPage = d.shapesByPage;
            else if (Array.isArray(d.shapes)) this.shapesByPage = { global: d.shapes };
            if (d.unitName) this.state.unitName = d.unitName;
            if (d.unitPerPx) this.state.unitPerPx = d.unitPerPx;
            if (typeof d.showGrid === 'boolean') this.state.showGrid = d.showGrid;
            if (typeof d.showRulers === 'boolean') this.state.showRulers = d.showRulers;
            if (Array.isArray(d.scales)) this.scales = d.scales;
            // restore persisted background if present in imported JSON
            if (d.bgData) {
              const img = new Image(); img.onload = () => { this.bgImg = img; this._bgData = d.bgData; this.currentDocType = d.currentDocType || 'image'; this.pdfCurrent = d.pdfCurrent || this.pdfCurrent; this.pdfTotal = d.pdfTotal || this.pdfTotal; this._fitTo(img.width, img.height); this.ensurePageArrays(); this._render(); };
              img.src = d.bgData;
            }
            this.$('#scaleLabel').textContent = `1 px = ${this.round(this.state.unitPerPx, 4)} ${this.state.unitName}`;
            this.ensurePageArrays(); this._render(); this._select(null); this._maybeSave(); try{ this._maybeEmitFamilies(); }catch(e){}
          } catch { alert('Invalid JSON'); }
        }; r.readAsText(f);
      });

      // Limpiar
  this.$('#btnClear').addEventListener('click', () => {
    if (!confirm('Delete ALL annotations on the current page?')) return;
  this._pushUndo(); this.shapes.length = 0; this._select(null); this._render(); this._maybeSave();
  try{ this._clearFamiliesData(); }catch(e){}
  });

      // Quitar plano (background)
      this.$('#btnClearBg').addEventListener('click', () => {
        if (!confirm('Remove the background (image/PDF) and its persistence?')) return;
        this.clearBackground();
      });

      // Zoom botones
      this.$('#btnZoomIn').onclick = () => this._zoomAt(1.2, [this.W / 2, this.H / 2]);
      this.$('#btnZoomOut').onclick = () => this._zoomAt(0.8, [this.W / 2, this.H / 2]);
      this.$('#btnResetView').onclick = () => { if (this.bgImg) this._fitTo(this.bgImg.width, this.bgImg.height); else { this.view.scale = 1; this.view.x = this.view.y = 0; this.$('#statusZoom').textContent = '100%'; } this._render(); };

      // Modal familias
      this.$('#btnToggleRows').onclick = () => { this.TABLE_EXPANDED = !this.TABLE_EXPANDED; this._fillFamiliesTable(); };
      this.$('#btnTable').onclick = () => { this.TABLE_EXPANDED = false; this._fillFamiliesTable(); this._fillSummaries(); this.$('#modalBg').style.display = 'flex'; };
      this.$('#btnCloseModal').onclick = () => this.$('#modalBg').style.display = 'none';
      this.$('#modalBg').addEventListener('click', (e) => { if (e.target === this.$('#modalBg')) this.$('#modalBg').style.display = 'none'; });
  this.$('#btnCopyJSON').onclick = () => { navigator.clipboard.writeText(JSON.stringify({ createdAt: new Date().toISOString(), unitName: this.state.unitName, unitPerPx: this.state.unitPerPx, shapesByPage: this.shapesByPage }, null, 2)); alert('JSON copied ✅'); };

      // Grid/Reglas
  this.$('#btnGrid').onclick = () => { this.state.showGrid = !this.state.showGrid; this.$('#btnGrid').classList.toggle('active', this.state.showGrid); this._maybeSave(); this._render(); };
  this.$('#btnRulers').onclick = () => { this.state.showRulers = !this.state.showRulers; this.$('#btnRulers').classList.toggle('active', this.state.showRulers); this._maybeSave(); this._render(); };

      // Escalas
      this.$('#btnScales').onclick = () => { this._openScalesModal(); };
      this.$('#btnCloseScales').onclick = () => this.$('#scalesModalBg').style.display = 'none';
      this.$('#scalesModalBg').addEventListener('click', (e) => { if (e.target === this.$('#scalesModalBg')) this.$('#scalesModalBg').style.display = 'none'; });
      this.$('#btnAddScale').onclick = () => this._addOrEditScale();

      // PDF
      this.$('#pdfInput').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        await this._ensurePdfJs();
        try{
          // read as dataURL so we can persist the PDF content and restore it later
          const reader = new FileReader();
          reader.onload = async () => {
            try{
              const dataUrl = reader.result;
              if (typeof dataUrl === 'string') this._pdfData = dataUrl;
              await this._loadPDF(dataUrl);
            }catch(err){ console.warn('load pdf from dataurl failed', err); }
          };
          reader.readAsDataURL(f);
        }catch(err){
          // fallback to object URL if FileReader fails
          await this._loadPDF(URL.createObjectURL(f));
        }
      });
      this.$('#btnNextPage').addEventListener('click', async () => {
        if (!this.pdfDoc) return;
        if (this.pdfCurrent < this.pdfTotal) {
          // save current page shapes before moving to next page
          try { this._saveLocal(); } catch(e){}
          this.pdfCurrent++;
          this.ensurePageArrays(); await this._renderPDFPage(this.pdfCurrent); this._select(null); this._render();
        }
      });
      this.$('#btnPrevPage').addEventListener('click', async () => {
        if (!this.pdfDoc) return;
        if (this.pdfCurrent > 1) {
          // save current page shapes before moving to previous page
          try { this._saveLocal(); } catch(e){}
          this.pdfCurrent--;
          this.ensurePageArrays(); await this._renderPDFPage(this.pdfCurrent); this._select(null); this._render();
        }
      });

      // Atajos
  this.$('#helpLink').onclick = (e) => {
    e.preventDefault(); alert(`V Select · H/Space Pan · R Rectangle · C Circle · P Polyline (dblclick) · T Text
I Icon · M Ruler · A Angle · G Grid · Shift+R Rulers · E Scales · U Calibrate
Tab Families · Del Delete · Ctrl+Z/Y Undo/Redo · Wheel: zoom`);
  };

      window.addEventListener('keydown', (e) => {
        // Handle shortcuts when focus/target is inside this component's container
        // or when the component is visible on screen (covers returning to the view)
        try{
          const active = document.activeElement;
          const contains = (this.container.contains(active) || this.container.contains(e.target));
          const visible = (function(self){ try{ const r = self.container.getBoundingClientRect(); const style = window.getComputedStyle(self.container); return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; }catch(err){ return false; } })(this);
          if (!(contains || visible)) return;
        }catch(err){ /* ignore and bail */ return; }
        const k = e.key.toLowerCase(); this.shiftHeld = e.shiftKey;
        if (e.key === ' ') { this.panningBySpace = true; this._updateCursor(); }
        if (k === 'v') this._setTool('select'); else if (k === 'h') this._setTool('pan'); else if (k === 'r' && !e.shiftKey) this._setTool('rect'); else if (k === 'c') this._setTool('circle');
        else if (k === 'p') this._setTool('poly'); else if (k === 't') this._setTool('text'); else if (k === 'i') this._setTool('icon'); else if (k === 'm') this._setTool('ruler'); else if (k === 'a') this._setTool('angle');
        else if (k === 'g') { this.state.showGrid = !this.state.showGrid; this.$('#btnGrid').classList.toggle('active', this.state.showGrid); this._saveLocal(); this._render(); }
        else if (k === 'r' && e.shiftKey) { this.state.showRulers = !this.state.showRulers; this.$('#btnRulers').classList.toggle('active', this.state.showRulers); this._saveLocal(); this._render(); }
        else if (k === 'e') { this._openScalesModal(); }
        else if (k === 'u') { this._calibrateScale(); }
        else if (k === 'delete') this.$('#btnDelete').click();
        else if (k === 'tab') { e.preventDefault(); this.$('#btnTable').click(); }
        else if (e.ctrlKey && k === 'z') { e.preventDefault(); this._undo(); }
        else if (e.ctrlKey && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); this._redo(); }
        else if (k === 'escape') { if (this.polyWorking) { this.polyWorking = null; this.activeShape = null; this._render(); } this.measureTemp = null; }
        // Page navigation: support Arrow keys and PageUp/PageDown explicitly
        else if (k === 'arrowright' || k === 'pagedown') { e.preventDefault(); try{ this.$('#btnNextPage')?.click(); }catch(_){} }
        else if (k === 'arrowleft'  || k === 'pageup')   { e.preventDefault(); try{ this.$('#btnPrevPage')?.click(); }catch(_){} }
      });
      window.addEventListener('keyup', (e) => {
        try{
          const active = document.activeElement;
          const contains = (this.container.contains(active) || this.container.contains(e.target));
          const visible = (function(self){ try{ const r = self.container.getBoundingClientRect(); const style = window.getComputedStyle(self.container); return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; }catch(err){ return false; } })(this);
          if (!(contains || visible)) return;
        }catch(err){ return; }
        this.shiftHeld = e.shiftKey; if (e.key === ' ') { this.panningBySpace = false; this._updateCursor(); }
      });
      // Botón Eliminar: elimina la forma seleccionada (Supr)
      this.$('#btnDelete').onclick = () => {
        try {
          console.debug('btnDelete clicked - selectedId =', this.selectedId);
          let idToDelete = this.selectedId;
          // fallback: leer ID desde el panel de propiedades si no está en memoria
          if (!idToDelete) {
            const pid = (this.$('#p-id')?.textContent || '').trim();
            if (pid && pid !== '—') idToDelete = pid;
          }
          if (!idToDelete) { console.warn('No hay elemento seleccionado para eliminar'); return; }

          this._pushUndo();
          const before = this.shapes.length;
          this.shapes = this.shapes.filter(s => s.id !== idToDelete);
          const after = this.shapes.length;
          console.debug(`Deleted shapes: before=${before} after=${after} id=${idToDelete}`);
          this.shapesByPage[this.pageKey()] = this.shapes;
          this._select(null);
          this._render();
          this._saveLocal();
          try{ this._emitFamiliesUpdate(); }catch(e){}
          // Actualizar tablas/resúmenes si existen
          try { this._fillFamiliesTable(); this._fillSummaries(); } catch (e) { }
        } catch (err) {
          console.error('Error en btnDelete handler:', err);
          alert('Error al eliminar: ' + (err && err.message));
        }
      };
    }

    _zoomAt(factor, pt) {
      const before = this._screenToWorld(pt);
      this.view.scale = this.clamp(this.view.scale * factor, 0.2, 8);
      const after = this._screenToWorld(pt);
      this.view.x += before[0] - after[0]; this.view.y += before[1] - after[1];
      this.$('#statusZoom').textContent = `${Math.round(this.view.scale * 100)}%`;
      this._render();
    }
    _fitTo(w, h) { this.view.scale = Math.min(this.W / w, this.H / h); this.view.x = 0; this.view.y = 0; this.$('#statusZoom').textContent = `${Math.round(this.view.scale * 100)}%`; }

    /* ================== Familias ================== */
    _familiesFromIcons() {
      const icons = this.shapes.filter(s => s.type === 'icon');
      const map = new Map();
      for (const s of icons) {
        const icon = (s.icon || '').replace(/^custom:/, '') || (s.name || 'icon');
        const color = s.color || '#4db1ff';
        const key = `${icon}|${color}`;
        if (!map.has(key)) map.set(key, { icon, color, items: [] });
        map.get(key).items.push(s);
      }
      return map;
    }
    _unionBBox(items) {
      if (!items.length) return { x: 0, y: 0, w: 0, h: 0 };
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const s of items) { const b = this._bbox(s); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); }
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    _fillFamiliesTable() {
      const tbody = this.$('#table tbody'); tbody.innerHTML = '';
      const famMap = this._familiesFromIcons();
      const fams = [...famMap.values()].sort((a, b) => b.items.length - a.items.length);
      const shown = (this.TABLE_EXPANDED ? fams : fams.slice(0, Math.min(this.TABLE_LIMIT, fams.length)));
      shown.forEach((f, idx) => {
        const tr = document.createElement('tr');
        // attempt to read any saved annotation
        let persisted = {};
        try { persisted = JSON.parse(localStorage.getItem('familiesData') || '{}') || {}; } catch(e) { persisted = {}; }
        const key = `${f.icon}|${f.color}`;
        const ann = (persisted && persisted[key] && typeof persisted[key].annotation === 'string') ? persisted[key].annotation : '';
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td><span class="cad-tag">${f.icon}</span></td>
          <td><span class="cad-tag" style="border-color:${f.color};color:${f.color}">${f.color}</span></td>
          <td><input class="cad-inp" data-annotation="${key}" value="${ann.replace(/"/g,'&quot;')}" style="width:100%" placeholder="Anotación / nomenclatura"></td>
          <td>${f.items.length}</td>
          <td><button class="cad-btn" data-goto="${f.icon}|${f.color}">Go</button></td>
          <td><button class="cad-btn danger" data-del="${f.icon}|${f.color}">Delete</button></td>`;
        tbody.appendChild(tr);
      });

      // Listen to annotation edits
      this.$all('#table input[data-annotation]').forEach(inp => {
        inp.addEventListener('change', (e) => {
          try{
            const k = e.target.getAttribute('data-annotation');
            const v = String(e.target.value || '').trim();
            const raw = JSON.parse(localStorage.getItem('familiesData') || '{}') || {};
            raw[k] = raw[k] || {};
            raw[k].annotation = v;
            localStorage.setItem('familiesData', JSON.stringify(raw));
            // emit update so consumers pick up the annotation change
            window.dispatchEvent(new CustomEvent('updateMaterials', { detail: raw }));
          }catch(err){ console.warn('annotation save failed', err); }
        });
      });

      this.$all('#table [data-goto]').forEach(b => b.onclick = () => {
        const [icon, color] = b.getAttribute('data-goto').split('|');
        const fam = famMap.get(`${icon}|${color}`); if (!fam) return;
        const bb = this._unionBBox(fam.items), pad = 120;
        const scaleX = (this.W) / (bb.w + pad), scaleY = (this.H) / (bb.h + pad);
        this.view.scale = this.clamp(Math.min(scaleX, scaleY), 0.2, 4);
        this.view.x = bb.x - ((this.W) / this.view.scale - bb.w) / 2; this.view.y = bb.y - ((this.H) / this.view.scale - bb.h) / 2;
        this.$('#statusZoom').textContent = `${Math.round(this.view.scale * 100)}%`;
        this.$('#modalBg').style.display = 'none'; this._render();
      });
      this.$all('#table [data-del]').forEach(b => b.onclick = () => {
        const [icon, color] = b.getAttribute('data-del').split('|');
        if (!confirm(`¿Eliminar TODOS los "${icon}" de color ${color} en esta página?`)) return;
        this._pushUndo();
        this.shapes = this.shapes.filter(s => !(s.type === 'icon' && (s.icon || '').replace(/^custom:/, '') === icon && (s.color || '#4db1ff') === color));
        this.shapesByPage[this.pageKey()] = this.shapes;
        this._select(null); this._render(); this._saveLocal(); this._fillFamiliesTable(); this._fillSummaries();
        try{ this._emitFamiliesUpdate(); }catch(e){}
      });

      this.$('#tableCount').textContent = `Mostrando ${shown.length} de ${fams.length} familias`;
      this.$('#toggleRowsText').textContent = this.TABLE_EXPANDED ? 'Ver menos' : 'Ver más';
    }
    _fillSummaries() {
      const famMap = this._familiesFromIcons(); const byIcon = new Map(); const byIconColor = new Map();
      for (const { icon, color, items } of famMap.values()) { byIcon.set(icon, (byIcon.get(icon) || 0) + items.length); const key = `${icon} | ${color}`; byIconColor.set(key, (byIconColor.get(key) || 0) + items.length); }
      const s1 = this.$('#summaryByIcon tbody'); s1.innerHTML = '';[...byIcon.entries()].sort((a, b) => b[1] - a[1]).forEach(([icon, count]) => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${icon}</td><td>${count}</td>`; s1.appendChild(tr); });
      const s2 = this.$('#summaryByIconColor tbody'); s2.innerHTML = '';[...byIconColor.entries()].sort((a, b) => b[1] - a[1]).forEach(([key, count]) => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${key}</td><td>${count}</td>`; s2.appendChild(tr); });
      try { this._syncBlueprintSummary(); } catch (err) { console.warn('Blueprint summary sync failed', err); }
    }

    /* ================== Escalas ================== */
    _ensureDefaultScales() {
      if (this.scales.length) return;
      const unit = this.state.unitName || 'u';
      this.scales = [
        { id: this.uuid(), name: '1 px = 1 mm', unitPerPx: 1, unitName: 'mm' },
        { id: this.uuid(), name: '1 px = 5 mm', unitPerPx: 5, unitName: 'mm' },
        { id: this.uuid(), name: '1 px = 1 cm', unitPerPx: 10, unitName: 'mm' },
        { id: this.uuid(), name: '1 px = 10 cm', unitPerPx: 100, unitName: 'mm' },
        { id: this.uuid(), name: '1 px = 0.5 m', unitPerPx: 500, unitName: 'mm' },
        { id: this.uuid(), name: `1 px = 1 ${unit}`, unitPerPx: 1, unitName: unit },
      ];
    }
    _openScalesModal() {
      this._ensureDefaultScales();
      const tbody = this.$('#scalesTable tbody'); tbody.innerHTML = '';
      this.scales.forEach(sc => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${sc.name}</td><td>${sc.unitPerPx}</td><td>${sc.unitName}</td>
          <td><button class="cad-btn" data-apply="${sc.id}">Aplicar</button>
              <button class="cad-btn" data-edit="${sc.id}">Editar</button>
              <button class="cad-btn danger" data-del="${sc.id}">Eliminar</button></td>`;
        tbody.appendChild(tr);
      });
      this.$all('#scalesTable [data-apply]').forEach(b => b.onclick = () => { const sc = this.scales.find(s => s.id === b.dataset.apply); if (!sc) return; this.state.unitPerPx = +sc.unitPerPx; this.state.unitName = sc.unitName || 'u'; this.$('#scaleLabel').textContent = `1 px = ${this.round(this.state.unitPerPx, 4)} ${this.state.unitName}`; this._saveLocal(); this._render(); });
      this.$all('#scalesTable [data-edit]').forEach(b => b.onclick = () => { const sc = this.scales.find(s => s.id === b.dataset.edit); this._addOrEditScale(sc); });
      this.$all('#scalesTable [data-del]').forEach(b => b.onclick = () => { const id = b.dataset.del; this.scales = this.scales.filter(x => x.id !== id); this._saveLocal(); this._openScalesModal(); });
      this.$('#scalesModalBg').style.display = 'flex';
    }
    _addOrEditScale(sc = null) {
      const name = prompt('Scale name (e.g. "1 px = 1 cm")', sc?.name || 'Custom')?.trim(); if (!name) return;
      const unitPerPx = parseFloat(prompt('Unidades por pixel (ej: 10 si 1 px = 10 mm)', sc?.unitPerPx ?? this.state.unitPerPx));
      if (!isFinite(unitPerPx) || unitPerPx <= 0) return alert('Valor inválido');
      const unitName = prompt('Unidad (mm, cm, m, u, etc.)', sc?.unitName || this.state.unitName || 'u')?.trim() || 'u';
      if (sc) { sc.name = name; sc.unitPerPx = unitPerPx; sc.unitName = unitName; } else { this.scales.push({ id: this.uuid(), name, unitPerPx, unitName }); }
      this._saveLocal(); this._openScalesModal();
    }
    _calibrateScale() {
      alert('Calibración: clic en dos puntos del plano y decí la distancia real.');
      this._setTool('select'); let clicks = 0, p1 = null;
      const handler = (e) => {
        const w = this._screenToWorld([e.offsetX, e.offsetY]);
        if (clicks === 0) { p1 = { x: w[0], y: w[1] }; clicks = 1; }
        else {
          const p2 = { x: w[0], y: w[1] }, distPx = this._len(p1, p2);
          const val = prompt('Distancia real (número):', '1.00'); if (val !== null) {
            const unit = prompt('Unidad (mm, cm, m, etc.):', this.state.unitName || 'u') || 'u'; const real = parseFloat(val);
            if (real > 0 && distPx > 0) { this.state.unitPerPx = real / distPx; this.state.unitName = unit; this.$('#scaleLabel').textContent = `1 px = ${this.round(this.state.unitPerPx, 4)} ${this.state.unitName}`; this._saveLocal(); this._render(); }
          }
          this.canvas.removeEventListener('click', handler);
        }
      };
      this.canvas.addEventListener('click', handler);
    }

    /* ================== PDF ================== */
    async _loadPDF(url) {
      const pdfjsLib = window['pdfjs-dist/build/pdf'];
      const loadingTask = pdfjsLib.getDocument(url);
      this.pdfDoc = await loadingTask.promise;
      this.pdfFingerprint = (this.pdfDoc && this.pdfDoc.fingerprint) || this.pdfFingerprint || null;
      this.currentDocType = 'pdf'; this.pdfTotal = this.pdfDoc.numPages; this.pdfCurrent = 1;

      // Cache document so a subsequent remount can reuse it without re-reading the source.
      try {
        const entry = {
          doc: this.pdfDoc,
          total: this.pdfTotal,
          data: this._pdfData || (typeof url === 'string' && url.startsWith('data:') ? url : null),
          fingerprint: this.pdfFingerprint || null
        };
        PDF_CACHE.set('__last__', entry);
        if (entry.fingerprint) PDF_CACHE.set(entry.fingerprint, entry);
      } catch (err) {
        console.warn('pdf cache update failed', err);
      }

      this.$('#pdfPageIndicator').textContent = `PDF: ${this.pdfCurrent}/${this.pdfTotal}`;
      await this._renderPDFPage(this.pdfCurrent);
      this.ensurePageArrays(); this._select(null); this._render();
    }
    async _renderPDFPage(n) {
      if (!this.pdfDoc) return;
      const page = await this.pdfDoc.getPage(n); const vp = page.getViewport({ scale: this.renderScale });
      const off = document.createElement('canvas'); off.width = vp.width; off.height = vp.height;
      await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
  // convert rendered canvas to image and persist the dataURL so the page stays when navigating
  const dataUrl = off.toDataURL();
      const img = new Image();
      await new Promise(res => { img.onload = res; img.src = dataUrl; });
      this.bgImg = img; this._bgData = dataUrl; this._fitTo(img.width, img.height);
      this.$('#pdfPageIndicator').textContent = `PDF: ${this.pdfCurrent}/${this.pdfTotal}`;
      // persist current PDF page as background so it remains when navigating away and back
      this.currentDocType = 'pdf';
  // associate shapes with this specific rendered PDF page
  try { this._bgKey = 'pdfpage_' + this.pdfCurrent + '_' + this._hashStr(dataUrl); } catch (e) { this._bgKey = 'pdfpage_' + this.pdfCurrent + '_' + this.uuid(); }
  this._maybeSave();
    }

    /* ================== ICONOS (SVG custom) ================== */
    _customSVG(name, size, color) {
      const s = size, c = color;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`;
      switch (name) {
        case 'column-rect': return svg + `<rect x="7" y="3" width="10" height="18" rx="1"/><path d="M7 8h10M7 16h10"/></svg>`;
        case 'column-round': return svg + `<circle cx="12" cy="12" r="7"/><path d="M5 12h14"/></svg>`;
        case 'beam-h': return svg + `<path d="M3 7h18M3 17h18M9 7v10M15 7v10"/></svg>`;
        case 'beam-rect': return svg + `<rect x="3" y="9" width="18" height="6" rx="1"/></svg>`;
        case 'slab': return svg + `<rect x="3" y="6" width="18" height="12"/><path d="M3 10h18M3 14h18" opacity="0.6"/></svg>`;
        case 'footing': return svg + `<rect x="6" y="14" width="12" height="5"/><path d="M4 14h16M8 10h8M10 6h4"/></svg>`;
        case 'shear-wall': return svg + `<rect x="6" y="4" width="12" height="16"/><path d="M6 8h12M6 12h12M6 16h12"/></svg>`;
        case 'rebar': return svg + `<path d="M4 6l16 12M6 4l12 16"/><path d="M8 10l6 4M10 8l4 6" opacity="0.6"/></svg>`;
        case 'anchor': return svg + `<path d="M12 3v14"/><path d="M6 13a6 6 0 0 0 12 0"/><circle cx="12" cy="3" r="1"/></svg>`;
        case 'joint': return svg + `<circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/></svg>`;
        case 'grid-node': return svg + `<path d="M3 12h18M12 3v18"/><circle cx="12" cy="12" r="2"/></svg>`;
        case 'section-cut': return svg + `<path d="M3 6l18 12"/><path d="M7 5l-2 4M19 19l-2-4"/><circle cx="5  " cy="9" r="1"/><circle cx="17" cy="15" r="1"/></svg>`;
        case 'elevation-mark': return svg + `<circle cx="12" cy="12" r="5"/><path d="M12 7v10M9 9l3-2 3 2"/></svg>`;
        case 'door': return svg + `<rect x="4" y="4" width="4" height="16"/><path d="M8 12h10"/><path d="M18 12a6 6 0 0 0-6-6"/></svg>`;
        case 'window': return svg + `<rect x="3" y="5" width="18" height="14"/><path d="M12 5v14M3 12h18"/></svg>`;
        default: return svg + `<circle cx="12" cy="12" r="6"/></svg>`;
      }
    }
    _getIconImage(iconName, size, color) {
      const key = `${iconName}|${size}|${color}`; if (this.ICON_CACHE.has(key)) return this.ICON_CACHE.get(key);
      const name = iconName.replace(/^custom:/, ''); const svg = this._customSVG(name, size, color);
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      this.ICON_CACHE.set(key, img); return img;
    }
    _drawIconCanvas(s) {
      const img = this._getIconImage(s.icon || s.name || 'column-rect', s.size || 28, s.color || '#4db1ff');
      const size = s.size || 28; this.ctx.save(); this.ctx.drawImage(img, s.x - size / 2, s.y - size / 2, size, size); this.ctx.restore();
    }

    /* ================== Export (PNG hi-res / PDF) ================== */
    _renderOffscreen(scale = 2, fitToBg = false, shapesOverride = null, bgOverride = null) {
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.floor(this.W * scale));
      off.height = Math.max(1, Math.floor(this.H * scale));
      const c = off.getContext('2d');

      const bg = bgOverride || this.bgImg;
      const tv = { x: this.view.x, y: this.view.y, scale: this.view.scale };
      if (fitToBg && bg) { tv.x = 0; tv.y = 0; tv.scale = Math.min(off.width / bg.width, off.height / bg.height); }
      const setTransform = () => c.setTransform(tv.scale * scale, 0, 0, tv.scale * scale, -tv.x * tv.scale * scale, -tv.y * tv.scale * scale);

      if (bg) { setTransform(); c.drawImage(bg, 0, 0); }

      if (this.state.showGrid) {
        setTransform();
        c.lineWidth = 1 / (tv.scale);
        c.strokeStyle = '#2a3341'; c.beginPath();
        const step = 40, startX = Math.floor(tv.x / step) * step - step * 5, startY = Math.floor(tv.y / step) * step - step * 5;
        const endX = tv.x + this.W / tv.scale + step * 5, endY = tv.y + this.H / tv.scale + step * 5;
        for (let x = startX; x < endX; x += step) { c.moveTo(x, startY); c.lineTo(x, endY); }
        for (let y = startY; y < endY; y += step) { c.moveTo(startX, y); c.lineTo(endX, y); }
        c.stroke();
      }

      const arr = shapesOverride || this.shapes;
      setTransform();
      for (const s of arr) {
        c.lineWidth = (s.stroke || 2) / tv.scale;
        c.strokeStyle = s.color || '#4db1ff';
        c.fillStyle = s.color || '#4db1ff';
        c.beginPath();
        if (s.type === 'rect') c.strokeRect(s.x, s.y, s.w, s.h);
        else if (s.type === 'circle') { c.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); c.stroke(); }
        else if (s.type === 'poly' && s.points?.length) { c.moveTo(s.points[0].x, s.points[0].y); for (let i = 1; i < s.points.length; i++) c.lineTo(s.points[i].x, s.points[i].y); c.stroke(); }
        else if (s.type === 'text') { c.save(); c.font = `${(14 + (s.stroke || 2) * 1.2) / tv.scale}px sans-serif`; c.fillText(s.text || s.name || '', s.x, s.y); c.restore(); }
        else if (s.type === 'icon') { const img = this._getIconImage(s.icon || s.name || 'column-rect', s.size || 28, s.color || '#4db1ff'); const sz = s.size || 28; c.save(); c.drawImage(img, s.x - sz / 2, s.y - sz / 2, sz, sz); c.restore(); }
        else if (s.type === 'measure') {
          c.save();
          c.lineWidth = (s.stroke || 2) / tv.scale; c.strokeStyle = s.color || '#ffd166'; c.setLineDash([8 / tv.scale, 6 / tv.scale]);
          if (s.kind === 'distance') {
            c.beginPath(); c.moveTo(s.p1.x, s.p1.y); c.lineTo(s.p2.x, s.p2.y); c.stroke();
            const mid = { x: (s.p1.x + s.p2.x) / 2, y: (s.p1.y + s.p2.y) / 2 };
            const sx = (mid.x - tv.x) * tv.scale * scale, sy = (mid.y - tv.y) * tv.scale * scale;
            c.setTransform(1, 0, 0, 1, 0, 0); c.font = '12px system-ui,sans-serif';
            const text = this._formatMeasure(s), w = c.measureText(text).width + 8;
            c.fillStyle = '#000c'; c.fillRect(sx - w / 2, sy - 14, w, 16);
            c.fillStyle = '#fff'; c.fillText(text, sx - w / 2 + 4, sy);
            setTransform();
          } else if (s.kind === 'angle') {
            c.beginPath(); c.moveTo(s.v.x, s.v.y); c.lineTo(s.a.x, s.a.y); c.moveTo(s.v.x, s.v.y); c.lineTo(s.b.x, s.b.y); c.stroke();
            const r = Math.min(60 / tv.scale, Math.min(this._len(s.v, s.a), this._len(s.v, s.b)) / 2);
            const a1 = Math.atan2(s.a.y - s.v.y, s.a.x - s.v.x), a2 = Math.atan2(s.b.y - s.v.y, s.b.x - s.v.x);
            let start = a1, end = a2, d = ((end - start) + Math.PI * 2) % (Math.PI * 2);
            if (d > Math.PI) { const tmp = start; start = end; end = tmp; d = ((end - start) + Math.PI * 2) % (Math.PI * 2); }
            c.setLineDash([]); c.beginPath(); c.arc(s.v.x, s.v.y, r, start, end); c.stroke();
            const label = this._formatMeasure(s);
            const px = s.v.x + Math.cos((start + end) / 2) * (r + 8 / tv.scale);
            const py = s.v.y + Math.sin((start + end) / 2) * (r + 8 / tv.scale);
            const sx = (px - tv.x) * tv.scale * scale, sy = (py - tv.y) * tv.scale * scale;
            c.setTransform(1, 0, 0, 1, 0, 0); c.font = '12px system-ui,sans-serif';
            const w = c.measureText(label).width + 8; c.fillStyle = '#000c'; c.fillRect(sx - w / 2, sy - 14, w, 16);
            c.fillStyle = '#fff'; c.fillText(label, sx - w / 2 + 4, sy);
            setTransform();
          }
          c.restore();
        }
        if (s.showLabel && s.name) {
          const b = this._bbox(s);
          const sx = (b.x - tv.x) * tv.scale * scale + 20;
          const sy = (b.y - tv.y) * tv.scale * scale - 10;
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.font = '12px system-ui,sans-serif';
          const label = s.name, wtxt = c.measureText(label).width + 8;
          c.fillStyle = '#000c'; c.fillRect(sx, sy - 14, wtxt, 16);
          c.fillStyle = '#fff'; c.fillText(label, sx + 4, sy);
          setTransform();
        }
      }
      return off;
    }
    _exportPngHiRes(scale = 2, fitToBg = false, filename = 'captura@2x.png') {
      const off = this._renderOffscreen(scale, fitToBg);
      off.toBlob((blob) => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      }, 'image/png');
    }
    async _exportPdfCurrentPage() {
      await this._ensureJsPdf();
      const { jsPDF } = window.jspdf;
      const off = this._renderOffscreen(2, false);
      const doc = new jsPDF({ orientation: off.width >= off.height ? 'l' : 'p', unit: 'px', format: [off.width, off.height] });
      doc.addImage(off.toDataURL('image/png'), 'PNG', 0, 0, off.width, off.height);
      doc.save('anotacion_pagina.pdf');
    }
    async _exportPdfDocument() {
      await this._ensureJsPdf();
      const { jsPDF } = window.jspdf;
      if (this.currentDocType !== 'pdf' || !this.pdfDoc) { alert('Abrí un PDF para exportar el documento completo.'); return; }
      const doc = new jsPDF({ orientation: 'p', unit: 'px', format: 'a4' });
      let first = true;
      for (let n = 1; n <= this.pdfTotal; n++) {
        const page = await this.pdfDoc.getPage(n);
        const vp = page.getViewport({ scale: this.renderScale });
        const can = document.createElement('canvas'); can.width = vp.width; can.height = vp.height;
        await page.render({ canvasContext: can.getContext('2d'), viewport: vp }).promise;
        const img = new Image(); await new Promise(res => { img.onload = res; img.src = can.toDataURL(); });

        const key = `pdf_${n}`;
        const arr = this.shapesByPage[key] || [];
        const off = this._renderOffscreen(2, true, arr, img);

        if (first) { doc.deletePage(1); first = false; }
        doc.addPage([off.width, off.height], off.width >= off.height ? 'l' : 'p');
        doc.setPage(doc.getNumberOfPages());
        doc.addImage(off.toDataURL('image/png'), 'PNG', 0, 0, off.width, off.height);
      }
      doc.save('anotacion_documento.pdf');
    }
  }

  window.CADLite = CADLite;
})();
