// Script de prueba para verificar el sistema de autenticación
// Este archivo se puede eliminar después de las pruebas

console.log('🧪 Iniciando pruebas del sistema de autenticación...');

// Esperar a que el sistema esté completamente inicializado
setTimeout(() => {
    console.log('📊 Estado del sistema:');
    console.log('- AuthSystem disponible:', !!window.authSystem);
    console.log('- Usuario actual:', window.getCurrentUser());
    console.log('- Está autenticado:', window.authSystem?.isAuthenticated());
    
    if (window.authSystem?.isAuthenticated()) {
        const user = window.getCurrentUser();
        console.log('✅ Sistema funcionando correctamente');
        console.log('👤 Usuario logueado:', user.name, '(' + user.email + ')');
        console.log('🔑 Permisos:', user.permissions);
        console.log('🏢 Rol:', user.role);
    } else {
        console.log('🔒 Usuario no autenticado - sistema de login activo');
    }
    
    // Probar funciones globales
    console.log('🔧 Funciones globales disponibles:');
    console.log('- getCurrentUser:', typeof window.getCurrentUser);
    console.log('- hasPermission:', typeof window.hasPermission);
    console.log('- showUserInfo:', typeof window.showUserInfo);
    
}, 2000);

// Escuchar eventos de logout
window.addEventListener('userLoggedOut', (e) => {
    console.log('🔓 Evento de logout detectado:', e.detail);
});

console.log('🧪 Pruebas configuradas. Ver resultados en 2 segundos...');