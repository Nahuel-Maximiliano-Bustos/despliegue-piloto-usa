// Script de depuración para verificar el flujo de autenticación
console.log('🔍 Debug Script - Verificando flujo de autenticación');

// Verificar que las clases están disponibles
setTimeout(() => {
    console.log('📋 Estado de las clases:');
    console.log('- AuthSystem:', typeof window.AuthSystem);
    console.log('- LoginUI:', typeof window.LoginUI);
    console.log('- SecurityMiddleware:', typeof window.SecurityMiddleware);
    
    // Verificar si hay una instancia de authSystem
    console.log('- authSystem:', typeof window.authSystem);
    
    // Verificar contenido del DOM
    console.log('📄 Contenido del DOM:');
    console.log('- Body children:', document.body.children.length);
    console.log('- Login overlay:', document.getElementById('login-overlay') ? 'EXISTS' : 'NOT FOUND');
    console.log('- Main app:', document.querySelector('.main-app-container') ? 'EXISTS' : 'NOT FOUND');
    
    // Verificar localStorage
    console.log('💾 localStorage:');
    console.log('- Session:', localStorage.getItem('blueprint_session') ? 'EXISTS' : 'NOT FOUND');
    
}, 2000);

// Agregar listeners para eventos de autenticación
window.addEventListener('userLoggedIn', (e) => {
    console.log('✅ Evento userLoggedIn detectado:', e.detail);
});

window.addEventListener('userLoggedOut', (e) => {
    console.log('🚪 Evento userLoggedOut detectado:', e.detail);
});

// Función para limpiar completamente el estado
window.debugClearAuth = function() {
    console.log('🧹 Limpiando estado de autenticación...');
    localStorage.removeItem('blueprint_session');
    location.reload();
};

// Función para mostrar estado actual
window.debugAuthState = function() {
    console.log('📊 Estado actual de autenticación:');
    console.log('- Autenticado:', window.authSystem ? window.authSystem.isAuthenticated() : 'N/A');
    console.log('- Usuario actual:', window.authSystem ? window.authSystem.getCurrentUser() : 'N/A');
    console.log('- Session data:', localStorage.getItem('blueprint_session'));
};

console.log('🛠️ Funciones de debug disponibles:');
console.log('- debugClearAuth() - Limpiar autenticación');
console.log('- debugAuthState() - Ver estado actual');