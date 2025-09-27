// Script de prueba manual del login
console.log('🧪 Iniciando prueba manual del login');

// Función para probar el login
window.testLogin = function() {
    console.log('🔍 Probando login...');
    
    // Verificar que los elementos existan
    const form = document.getElementById('login-form');
    const email = document.getElementById('email');
    const password = document.getElementById('password');
    const button = document.getElementById('login-button');
    
    console.log('📋 Elementos encontrados:');
    console.log('- Form:', form ? 'EXISTS' : 'NOT FOUND');
    console.log('- Email input:', email ? 'EXISTS' : 'NOT FOUND');
    console.log('- Password input:', password ? 'EXISTS' : 'NOT FOUND');
    console.log('- Login button:', button ? 'EXISTS' : 'NOT FOUND');
    
    if (email && password) {
        // Llenar campos con datos de prueba
        email.value = 'admin@blueprint.com';
        password.value = 'Bp2025!Admin#';
        console.log('✅ Campos llenados con datos de prueba');
        
        // Simular envío del formulario
        if (form) {
            const event = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(event);
            console.log('📤 Evento submit disparado');
        }
    } else {
        console.error('❌ No se pudieron encontrar los campos del formulario');
    }
};

// Función para verificar el estado del sistema
window.checkSystem = function() {
    console.log('🔍 Verificando estado del sistema:');
    console.log('- AuthSystem clase disponible:', typeof window.AuthSystem);
    console.log('- LoginUI clase disponible:', typeof window.LoginUI);
    console.log('- authSystem instancia:', typeof window.authSystem);
    console.log('- loginUI instancia:', typeof window.loginUI);
    
    if (window.authSystem) {
        console.log('- Usuario autenticado:', window.authSystem.isAuthenticated());
        console.log('- Usuario actual:', window.authSystem.getCurrentUser());
    }
    
    // Verificar DOM
    console.log('- Login overlay:', document.getElementById('login-overlay') ? 'EXISTS' : 'NOT FOUND');
    console.log('- Main app:', document.querySelector('.main-app-container') ? 'EXISTS' : 'NOT FOUND');
};

// Ejecutar verificación inicial
setTimeout(() => {
    checkSystem();
    console.log('🛠️ Funciones disponibles:');
    console.log('- testLogin() - Probar login automático');
    console.log('- checkSystem() - Verificar estado');
}, 3000);

console.log('📝 Instrucciones:');
console.log('1. Espera 3 segundos para la verificación inicial');
console.log('2. Ejecuta testLogin() para probar el login');
console.log('3. O usa las credenciales manualmente en el formulario');