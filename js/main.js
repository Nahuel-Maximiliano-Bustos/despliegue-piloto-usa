import "./store/appStore.js";

/*
  STEELEYE - Sistema con Autenticaci�n
  Loader de componentes + router + sistema de seguridad
  Estructura esperada por convenci�n:
    /js/components/<nombre>/<nombre>.js
  Fallback aceptado:
    /js/components/<nombre>.js

  Extras:
  - Sistema de autenticaci�n integrado
  - Control de permisos por componente
  - Aliases para mapear nombres a rutas personalizadas
*/

const COMPONENT_ATTR = "component";
const PROPS_ATTR = "props";
const BASE_URL = new URL("./components/", import.meta.url).href; // robusto a rutas

// Mapeo de aliases a rutas de componentes
const COMPONENT_ALIASES = {
    "manualprinted": "manualprinted/manualprinted-container",
    "cost-budget": "costestimation-budgetcontrol/cost-budget",
    "asidebar": "asidebar/asidebar",
    "dashboard": "dashboard/dashboard",
    "project-management": "project-management/project-management",
    "blueprint-analyzer": "blueprint-analyzer/blueprint-analyzer",
    "material-labor": "material-labor/material-labor",
    "reports": "reports/reports",
    "settings": "settings/settings",
    "suppliers": "suppliers/suppliers"
};

// Bus simple (opcional)
export const ComponentBus = new EventTarget();
window.ComponentBus = ComponentBus;

// Sistema de autenticaci�n global
let authSystem = null;

// Inicializar sistema de autenticaci�n
async function initAuthSystem() {
    if (!window.AuthSystem) {
        console.warn('AuthSystem no disponible, continuando sin autenticaci�n');
        return false;
    }
    
    try {
        authSystem = new window.AuthSystem();
        await new Promise(resolve => setTimeout(resolve, 100)); // Esperar inicializaci�n
        
        console.log('?? AuthSystem inicializado correctamente');
        
        // Hacer disponible globalmente
        window.authSystem = authSystem;
        
        return true;
    } catch (error) {
        console.error('Error al inicializar AuthSystem:', error);
        return false;
    }
}

/* ---------- Utils ---------- */
function coerce(v) {
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "null") return null;
    if (v === "undefined") return undefined;
    if (v === "") return "";
    if (!Number.isNaN(Number(v))) return Number(v);
    try { return JSON.parse(v); } catch { return v; }
}

function ensureArray(val) {
    if (Array.isArray(val)) return val;
    if (val == null) return [];
    if (typeof val === "object") return Object.values(val);
    return [val];
}

function safelyStringify(val) {
    try { return JSON.stringify(val, null, 2); } catch { return "" + val; }
}

function loadModuleScript(name) {
    const alias = COMPONENT_ALIASES[name];
    const scriptName = alias || `${name}/${name}`;

    const primary = new URL(`${scriptName}.js`, BASE_URL);
    const fallback = new URL(`${name}.js`, BASE_URL);

    return import(primary.href)
        .then(mod => ({ module: mod, url: primary.href }))
        .catch(err => {
            console.warn(`Fall� cargar ${primary.href}. Intentando fallback...`, err);
            return import(fallback.href)
                .then(mod => ({ module: mod, url: fallback.href }));
        });
}

/* ---------- Loader core ---------- */
async function mountComponent(el) {
    if (!el) return;

    // Verificar autenticaci�n antes de montar cualquier componente
    if (authSystem && !authSystem.isAuthenticated()) {
        console.warn('Intento de acceso sin autenticaci�n bloqueado');
        return;
    }

    const name = el.dataset[COMPONENT_ATTR]?.trim().toLowerCase();
    if (!name) return;
    if (el.__component?.name === name && el.__component?.mounted) return;

    // Verificar permisos espec�ficos del componente si es necesario
    if (authSystem && name === 'settings' && !authSystem.hasPermission('admin')) {
        el.innerHTML = '<div class="p-4 bg-red-100 text-red-700 rounded">Acceso denegado: Permisos insuficientes</div>';
        return;
    }

    // Limpiar instancia previa: si el componente anterior expone beforeUnmount() lo esperamos
    async function maybeCallBeforeUnmount(prev) {
        if (!prev) return;
        try {
            const client = prev.getClient && prev.getClient();
            if (client && typeof client.beforeUnmount === 'function') {
                // Permitir que el componente haga operaciones asincrónicas (guardar estado, etc.)
                await client.beforeUnmount();
            }
        } catch (err) {
            console.warn('beforeUnmount failed', err);
        }
    }

    try {
        await maybeCallBeforeUnmount(el.__component);
    } catch (e) { console.warn('Error waiting beforeUnmount', e); }

    try { el.__component?.destroy?.(); } catch (e) { console.warn("No se pudo destruir instancia previa", e); }
    el.__component = null;

    // Props desde data-attributes y/o JSON
    let jsonProps = {};
    const raw = el.dataset[PROPS_ATTR];
    if (raw) {
        try {
            jsonProps = JSON.parse(raw);
        } catch (error) {
            console.warn(`Props JSON inv�lidos para ${name}:`, raw, error);
        }
    }

    const otherProps = {};
    for (const [key, value] of Object.entries(el.dataset)) {
        if (key === COMPONENT_ATTR || key === PROPS_ATTR) continue;
        otherProps[key] = coerce(value);
    }

    const props = { ...otherProps, ...jsonProps };
    el.setAttribute("aria-busy", "true");

    try {
        const { module, url } = await loadModuleScript(name);
        const create = module?.createComponent || module?.default;

        if (!create) {
            throw new Error(`El m�dulo ${url} no exporta createComponent ni default`);
        }

        const instance = (await create(el, props)) || {};

        el.__component = {
            name,
            mounted: true,
            destroy: instance.destroy || instance.unmount || (() => {}),
            update: instance.update || instance.setProps || (() => {}),
            getClient: () => instance
        };

        console.log(`? Componente "${name}" montado desde ${url}`);
    } catch (error) {
        console.error(`Error montando componente "${name}"`, error);
        el.innerHTML = `
            <div class="p-4 bg-red-50 text-red-700 rounded">
              Error cargando componente <b>${name}</b>.<br/>
              <pre class="text-xs mt-2 bg-red-100 p-2 rounded">${safelyStringify(error.message || error)}</pre>
            </div>`;
    } finally {
        el.removeAttribute("aria-busy");
    }
}

/* ---------- Observer ---------- */
const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.dataset?.[COMPONENT_ATTR]) mountComponent(node);
            node.querySelectorAll?.(`[data-${COMPONENT_ATTR}]`).forEach((el) => mountComponent(el));
        });
        mutation.removedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.dataset?.[COMPONENT_ATTR]) {
                try {
                    // attempt beforeUnmount if available
                    const prev = node.__component;
                    const client = prev?.getClient && prev.getClient();
                    if (client && typeof client.beforeUnmount === 'function') {
                        try { client.beforeUnmount(); } catch (e) { console.warn('beforeUnmount on removed node failed', e); }
                    }
                } catch (e) { /* ignore */ }
                try { node.__component?.destroy?.(); } catch { }
            }
        });
    }
});

/* ---------- Init ---------- */
function startComponentSystem() {
    if (window.__componentSystemStarted) return;
    window.__componentSystemStarted = true;

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [`data-${COMPONENT_ATTR}`]
    });

    for (const el of document.querySelectorAll(`[data-${COMPONENT_ATTR}]`)) {
        mountComponent(el);
    }
}

window.startComponentSystem = startComponentSystem;

/* ---------- Router simple ---------- */
function renderRoute() {
    const contentElement = document.getElementById('app-content');
    if (!contentElement) {
        console.warn('Element #app-content not found for routing');
        return;
    }
    
    const currentComponent = contentElement.dataset.component || 'dashboard';
    console.log(`?? Renderizando componente: ${currentComponent}`);
    mountComponent(contentElement);
}

function showApplication() {
    const mainApp = document.getElementById('main-app');
    if (mainApp) {
        mainApp.classList.remove('hidden');
    }
    renderRoute();
}

function hideApplication() {
    const mainApp = document.getElementById('main-app');
    if (mainApp) {
        mainApp.classList.add('hidden');
    }
}

/* ---------- Navegaci�n ---------- */
function setupNavigation() {
    ComponentBus.addEventListener('navigate', (event) => {
        const { component, props } = event.detail || {};
        const contentElement = document.getElementById('app-content');
        if (!contentElement || !component) return;

        // Before switching, attempt to flush any pending saves from the mounted component
        try {
            const prev = contentElement.__component;
            const client = prev?.getClient && prev.getClient();
            if (client) {
                if (typeof client._maybeSave === 'function') client._maybeSave();
                else if (typeof client._saveLocal === 'function') client._saveLocal();
                if (typeof client._maybeEmitFamilies === 'function') client._maybeEmitFamilies();
                else if (typeof client._emitFamiliesUpdate === 'function') client._emitFamiliesUpdate();
            }
        } catch (err) { console.warn('flush before navigate failed', err); }

        contentElement.dataset.component = component;
        if (props) {
            contentElement.dataset[PROPS_ATTR] = JSON.stringify(props);
        }
        renderRoute();
    });

    document.addEventListener('ui:navigate', (event) => {
        const { href } = event.detail || {};
        if (!href) return;

        const target = href.replace('#', '');
        const contentElement = document.getElementById('app-content');
        if (contentElement) {
            contentElement.dataset.component = target || 'dashboard';
            renderRoute();
        }
    });
}

/* ---------- DOM Ready ---------- */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('?? Inicializando sistema de componentes');
    try {
        const authReady = await initAuthSystem();
        if (!authReady) {
            console.log('?? Continuando sin sistema de autenticaci�n');
        }

        setupNavigation();
        startComponentSystem();

        const sidebarContainer = document.getElementById('sidebar-container');
        if (sidebarContainer) {
            await mountComponent(sidebarContainer);
        }

        renderRoute();
        console.log('? Sistema de componentes inicializado');
    } catch (error) {
        console.error('Error durante la inicializaci�n:', error);
        startComponentSystem();
        renderRoute();
    }
});

// Global flush on page unload to persist any in-memory state
window.addEventListener('beforeunload', (e) => {
    try {
        const contentElement = document.getElementById('app-content');
        const comp = contentElement? contentElement.__component : null;
        const client = comp?.getClient && comp.getClient();
        if (client) {
            try { if (typeof client._maybeSave === 'function') client._maybeSave(); else if (typeof client._saveLocal === 'function') client._saveLocal(); } catch (er) {}
            try { if (typeof client._maybeEmitFamilies === 'function') client._maybeEmitFamilies(); else if (typeof client._emitFamiliesUpdate === 'function') client._emitFamiliesUpdate(); } catch (er) {}
        }
    } catch (err) { /* ignore */ }
});

const originalPushState = history.pushState;
history.pushState = function (...args) {
    if (authSystem && !authSystem.isAuthenticated()) {
        console.warn('Navegaci�n bloqueada: usuario no autenticado');
        return;
    }
    return originalPushState.apply(this, args);
};

export { mountComponent, renderRoute, showApplication, hideApplication };
