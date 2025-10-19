// Importar la clase CADLite
import './manualprinted.js';

// Función de montaje compatible con el sistema
export default async function mount(container, props = {}) {
    let cadLite = null;
    // handlers en scope superior para permitir removals desde destroy()
    let onWinResize = null;
    let onSidebarToggle = null;
    let adjustSize = null;
    try {
    // Limpiar el contenedor padre antes de montar (evita mounts duplicados/solapamientos)
    while (container.firstChild) container.removeChild(container.firstChild);
    // Asegurar que el contenedor padre tenga un contexto de bloque y relative para contener elementos absolutos
    try { container.style.position = container.style.position || 'relative'; container.style.display = container.style.display || 'block'; } catch (e) { }

    // Crear el contenedor para CADLite — debe llenar el área disponible del padre
    const cadContainer = document.createElement('div');
    cadContainer.className = 'cad-container';
    cadContainer.style.display = 'flex';
    cadContainer.style.flexDirection = 'column';
    cadContainer.style.width = '100%';
    cadContainer.style.height = '100%';
    cadContainer.style.minHeight = '420px';
    cadContainer.style.boxSizing = 'border-box';
    cadContainer.style.position = 'relative';
    cadContainer.style.overflow = 'hidden';
    // No forzar bordes: dejar que el UI padre controle el layout
    container.appendChild(cadContainer);

        // --- Debug helper: botón pequeño que muestra bounding rects en la consola ---
        try {
            const dbg = document.createElement('button');
            dbg.textContent = 'DBG';
            dbg.title = 'Mostrar bounding rects (debug)';
            dbg.style.position = 'absolute'; dbg.style.right = '8px'; dbg.style.top = '8px'; dbg.style.zIndex = '99999'; dbg.style.padding = '4px 6px'; dbg.style.fontSize = '11px'; dbg.style.borderRadius = '6px'; dbg.style.border = 'none'; dbg.style.background = '#111'; dbg.style.color = '#fff'; dbg.style.opacity = '0.6';
            dbg.addEventListener('click', (e) => {
                e.stopPropagation();
                const parentRect = container.getBoundingClientRect();
                const contRect = cadContainer.getBoundingClientRect();
                console.log('DEBUG bounding rects -> parent:', parentRect, 'cadContainer:', contRect);
                alert(`parent: ${Math.round(parentRect.x)},${Math.round(parentRect.y)} ${Math.round(parentRect.width)}x${Math.round(parentRect.height)}\ncadContainer: ${Math.round(contRect.x)},${Math.round(contRect.y)} ${Math.round(contRect.width)}x${Math.round(contRect.height)}`);
            });
            cadContainer.appendChild(dbg);
        } catch (e) { }

        // Inicializar CADLite
        cadLite = new window.CADLite(cadContainer, {
            // Opciones por defecto
            gridSize: 20,
            snapToGrid: true,
            background: '#f5f5f5'
        });


            // Helper: ajustar tamaño del cadContainer para que ocupe exactamente el rect visible del contenedor padre
            adjustSize = () => {
                try {
                    // Calcular ancho disponible restando el ancho del sidebar (si existe)
                    const aside = document.querySelector('[data-aside]');
                    const asideRect = aside ? aside.getBoundingClientRect() : { width: 0, left: 0 };

                    // Obtener la posición superior de main-content para alinear verticalmente
                    const mainEl = document.getElementById('main-content');
                    const mainRect = mainEl ? mainEl.getBoundingClientRect() : container.getBoundingClientRect();

                    const left = Math.max(0, Math.floor(asideRect.width));
                    const top = Math.max(0, Math.floor(mainRect.top));
                    const width = Math.max(100, Math.floor(window.innerWidth - left));
                    const height = Math.max(100, Math.floor(window.innerHeight - top));

                    // Posicionar fixed para garantizar que el área del componente no quede bajo el sidebar
                    cadContainer.style.position = 'fixed';
                    cadContainer.style.left = left + 'px';
                    cadContainer.style.top = top + 'px';
                    cadContainer.style.width = width + 'px';
                    cadContainer.style.height = height + 'px';
                    cadContainer.style.boxSizing = 'border-box';

                    // Forzar re-render en el canvas
                    if (cadLite && typeof cadLite._resizeCanvas === 'function') {
                        try { cadLite._resizeCanvas(); } catch (e) { /* no crítico */ }
                    }
                } catch (e) { console.warn('adjustSize error', e); }
            };

            // Escuchar cambios relevantes: ventana redimensionada y toggle del sidebar (la app emite 'ui:sidebar:toggle')
            onWinResize = () => adjustSize();
            onSidebarToggle = (e) => { setTimeout(adjustSize, 220); /* esperar la transición */ };
            window.addEventListener('resize', onWinResize);
            window.addEventListener('ui:sidebar:toggle', onSidebarToggle);

            // Inicializar tamaño al montar
            setTimeout(adjustSize, 50);

        } catch (error) {
        console.error('Error al inicializar CADLite:', error);
        throw error;
    }
    
    // Función de destrucción
    function destroy() {
        if (cadLite) {
            // Intentar guardar estado antes de desmontar
            try {
                if (typeof cadLite._saveLocal === 'function') cadLite._saveLocal();
            } catch (e) { console.warn('Error saving CAD state before destroy', e); }
            try {
                if (typeof cadLite._emitFamiliesUpdate === 'function') cadLite._emitFamiliesUpdate();
            } catch (e) { /* no crítico */ }

            // Limpiar el contenedor
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }
            // quitar listeners añadidos
            try { if (onWinResize) window.removeEventListener('resize', onWinResize); } catch (e) {}
            try { if (onSidebarToggle) window.removeEventListener('ui:sidebar:toggle', onSidebarToggle); } catch (e) {}
            cadLite = null;
        }
    }
    
    // beforeUnmount: convención pública opcional que puede devolver Promise para operaciones async (guardar, limpiar, etc.)
    async function beforeUnmount() {
        try {
            if (cadLite) {
                if (typeof cadLite._saveLocal === 'function') await cadLite._saveLocal();
                if (typeof cadLite._emitFamiliesUpdate === 'function') await cadLite._emitFamiliesUpdate();
            }
        } catch (e) { console.warn('beforeUnmount error', e); }
    }

    // Retornar objeto con método de destrucción y beforeUnmount
    return {
        destroy,
        beforeUnmount
    };
}