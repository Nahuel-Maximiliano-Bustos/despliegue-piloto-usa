/*
  Blueprint Analyzer - Sistema con Autenticación
  Loader de componentes + router + sistema de seguridad
  Estructura esperada por convención:
    /js/components/<nombre>/<nombre>.js
  Fallback aceptado:
    /js/components/<nombre>.js

  Extras:
  - Sistema de autenticación integrado
  - Control de permisos por componente
  - Aliases para mapear nombres a rutas personalizadas
*/

const COMPONENT_ATTR = "component";
const PROPS_ATTR = "props";
const BASE_URL = new URL("./components/", import.meta.url); // robusto a rutas

// Bus simple (opcional)
export const ComponentBus = new EventTarget();
window.ComponentBus = ComponentBus;

// Sistema de autenticación global
let authSystem = null;

// Inicializar sistema de autenticación
async function initAuthSystem() {
    if (!window.AuthSystem) {
        console.warn('AuthSystem no disponible, continuando sin autenticación');
        return false;
    }
    
    try {
        authSystem = new window.AuthSystem();
        await new Promise(resolve => setTimeout(resolve, 100)); // Esperar inicialización
        
        console.log('✅ AuthSystem inicializado correctamente');
        
        // Hacer disponible globalmente
        window.authSystem = authSystem;
        
        return true;
    } catch (error) {
        console.error('Error al inicializar AuthSystem:', error);
        return false;
    }
}

/* ---------- Aliases opcionales ---------- */
/*  Clave: nombre pasado a createComponent()
    Valor: ruta relativa dentro de /components SIN .js
    Ej: "cost-budget": "costestimation-budgetcontrol/cost-budget"
*/
const COMPONENT_ALIASES = {
    "cost-budget": "costestimation-budgetcontrol/cost-budget",
    // "settings": "settings/settings", // no hace falta, ya respeta la convención
};

/* ---------- Loader core ---------- */
async function mountComponent(el) {
    // Verificar autenticación antes de montar cualquier componente
    if (authSystem && !authSystem.isAuthenticated()) {
        console.warn('Intento de acceso sin autenticación bloqueado');
        return;
    }

    const name = el.dataset[COMPONENT_ATTR]?.trim().toLowerCase();
    if (!name) return;
    if (el.__component?.name === name && el.__component?.mounted) return;

    // Verificar permisos específicos del componente si es necesario
    if (authSystem && name === 'settings' && !authSystem.hasPermission('admin')) {
        el.innerHTML = '<div class="p-4 bg-red-100 text-red-700 rounded">Acceso denegado: Permisos insuficientes</div>';
        return;
    }

    try { el.__component?.destroy?.(); } catch { }
    el.__component = null;

    // Props desde data-attributes y/o JSON
    let jsonProps = {};
    const raw = el.dataset[PROPS_ATTR];
    console.log(`🔧 Raw props for ${name}:`, raw); // Debug
    if (raw) { try { jsonProps = JSON.parse(raw); console.log(`🔧 Parsed JSON props for ${name}:`, jsonProps); } catch (e) { console.error(`🔧 Error parsing JSON props for ${name}:`, e); } }
    const other = {};
    for (const [k, v] of Object.entries(el.dataset)) {
        if (k === COMPONENT_ATTR || k === PROPS_ATTR) continue;
        other[k] = coerce(v);
    }
    let props = { ...other, ...jsonProps };
    console.log(`🔧 Final props for ${name}:`, props); // Debug

    el.setAttribute("aria-busy", "true");
    try {
        // Import con fallback (carpeta/archivo → archivo plano) + aliases
        const alias = COMPONENT_ALIASES[name];
        const scriptName = alias || name;
        
        let url1 = new URL(`${scriptName}/${scriptName}.js`, BASE_URL);
        let url2 = new URL(`${scriptName}.js`, BASE_URL);
        
        let module;
        try {
            module = await import(url1);
        } catch {
            module = await import(url2);
        }

        // Special handling for asidebar component to inject navigation data
        if (name === 'asidebar') {
            const currentUser = window.authSystem ? window.authSystem.getCurrentUser() : null;
            const sidebarProps = {
                brand: "Blueprint Analyzer v5.0",
                profile: currentUser ? {
                    name: currentUser.name,
                    email: currentUser.email,
                    initials: currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase()
                } : {
                    name: 'User',
                    email: 'user@blueprint.com',
                    initials: 'U'
                },
                items: [
                    {
                        section: "Overview",
                        items: [
                            { label: "Dashboard", href: "#dashboard", icon: "dashboard" },
                            { label: "Project Management", href: "#project-management", icon: "folder" }
                        ]
                    },
                    {
                        section: "Analysis", 
                        items: [
                            { label: "Blueprint Analyzer", href: "#blueprint-analyzer", icon: "search" },
                            { label: "Material & Labor", href: "#material-labor", icon: "hammer" }
                        ]
                    },
                    {
                        section: "Financial",
                        items: [
                            { label: "Cost Estimation & Budget Control", href: "#cost-budget", icon: "dollar" }
                        ]
                    },
                    {
                        section: "Reporting",
                        items: [
                            { label: "Reports", href: "#reports", icon: "chart" },
                            { label: "Suppliers", href: "#suppliers", icon: "truck" }
                        ]
                    }
                ],
                ...props // Merge with any existing props
            };
            console.log(`🚀 Injecting sidebar props:`, sidebarProps);
            props = sidebarProps;
        }

        // Buscar función mount (tu estructura) o createComponent (fallback)
        let mountFn = module.default || module.mount || module.createComponent;
        
        if (!mountFn) {
            throw new Error(`No se encontró función mount() o createComponent() en el módulo '${name}'`);
        }

        // Si es tu función mount(el, props), ejecutarla directamente
        if (typeof mountFn === 'function') {
            const result = await mountFn(el, props);
            
            // Guardar referencia para cleanup
            el.__component = { 
                name, 
                mounted: true, 
                destroy: result?.destroy || result?.unmount,
                instance: result
            };
        } else {
            throw new Error(`mount() no es una función en el módulo '${name}'`);
        }

        console.log(`✅ Componente '${name}' montado correctamente`);

    } catch (error) {
        console.error(`❌ Error cargando componente '${name}':`, error);
        el.innerHTML = `
            <div class="error-component p-4 bg-red-50 border border-red-200 rounded">
                <h3 class="text-red-800 font-semibold">Error de Componente</h3>
                <p class="text-red-600 text-sm mt-1">No se pudo cargar '${name}': ${error.message}</p>
                <button onclick="this.parentElement.parentElement.setAttribute('data-component', '${name}'); location.reload()" 
                        class="mt-2 px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">
                    Reintentar
                </button>
            </div>
        `;
    } finally {
        el.removeAttribute("aria-busy");
    }
}

/* ---------- Utils ---------- */
function coerce(val) {
    if (val === "true") return true;
    if (val === "false") return false;
    if (val === "null") return null;
    if (val === "undefined") return undefined;
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    if (/^\d*\.\d+$/.test(val)) return parseFloat(val);
    return val;
}

/* ---------- Observer ---------- */
const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) { // Element
                // El elemento agregado mismo
                if (node.dataset?.[COMPONENT_ATTR]) {
                    mountComponent(node);
                }
                // Sus hijos
                for (const child of node.querySelectorAll(`[data-${COMPONENT_ATTR}]`)) {
                    mountComponent(child);
                }
            }
        }
        
        // Cambios en atributos existentes
        if (mutation.type === "attributes" && 
            mutation.attributeName === `data-${COMPONENT_ATTR}`) {
            mountComponent(mutation.target);
        }
    }
});

/* ---------- Init ---------- */
function startComponentSystem() {
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [`data-${COMPONENT_ATTR}`]
    });

    // Componentes iniciales
    for (const el of document.querySelectorAll(`[data-${COMPONENT_ATTR}]`)) {
        mountComponent(el);
    }
}

/* ---------- Router simple ---------- */
function renderRoute() {
    const contentElement = document.getElementById('app-content');
    if (!contentElement) {
        console.warn('Element #app-content not found for routing');
        return;
    }
    
    // Get current component from data-component attribute
    const currentComponent = contentElement.dataset.component || 'dashboard';
    console.log(`🔄 Rendering component: ${currentComponent}`);
    
    // Mount the component
    mountComponent(contentElement);
}

// Función para mostrar/ocultar aplicación (compatibilidad)
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

// Initialize system when page loads
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🔐 Starting component system...');
    
    try {
        // Inicializar autenticación si está disponible
        const authInitialized = await initAuthSystem();
        
        if (authInitialized) {
            console.log('✅ Authentication system initialized');
        } else {
            console.log('⚠️ Continuing without authentication system');
        }
        
        // Configurar navegación
        ComponentBus.addEventListener('navigate', (e) => {
            const { component } = e.detail;
            console.log(`🧭 Navegando a: ${component}`);
            setTimeout(() => renderRoute(), 100);
        });

        // Configurar navegación del sidebar
        document.addEventListener('ui:navigate', (e) => {
            const { href } = e.detail;
            console.log(`🧭 Sidebar navigation to: ${href}`);
            
            // Extraer el componente del href (#component-name)
            const component = href.replace('#', '');
            
            // Actualizar el contenido principal
            const contentElement = document.getElementById('app-content');
            if (contentElement && component) {
                contentElement.dataset.component = component;
                mountComponent(contentElement);
            }
        });
        
        // Inicializar el sistema de componentes
        startComponentSystem();
        
        // Inicializar el sidebar
        const sidebarContainer = document.getElementById('sidebar-container');
        if (sidebarContainer) {
            await mountComponent(sidebarContainer);
        }
        
        // Inicializar el routing
        renderRoute();
        
        console.log('🚀 Component system initialized');
        
    } catch (error) {
        console.error('❌ Error during initialization:', error);
        // In case of error, continue without authentication
        startComponentSystem();
        renderRoute();
    }
});

// Interceptar navegación para verificar autenticación
const originalPushState = history.pushState;
history.pushState = function(...args) {
    if (authSystem && !authSystem.isAuthenticated()) {
        console.warn('Navegación bloqueada: usuario no autenticado');
        return;
    }
    return originalPushState.apply(this, args);
};

// Exportar funciones principales
export { mountComponent, renderRoute, showApplication, hideApplication };