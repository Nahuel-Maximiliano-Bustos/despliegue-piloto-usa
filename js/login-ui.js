// Componente de Login - Blueprint Analyzer
// Interfaz de usuario para autenticación

class LoginUI {
  constructor(authSystem = null) {
    this.auth = authSystem || (window.authSystem ? window.authSystem : null);
    this.loginContainer = null;
    this.mainApp = null;
    
    if (!this.auth) {
      console.error('❌ LoginUI: No se proporcionó authSystem');
      throw new Error('LoginUI requiere una instancia de AuthSystem');
    }
    
    this.init();
  }

  init() {
    this.createLoginInterface();
    
    // SIEMPRE mostrar el login inicialmente
    this.showLogin();
    
    // Solo después del evento de login mostrar la app
    window.addEventListener('userLoggedIn', () => {
      this.showMainApp();
    });

    // Listener para eventos de logout
    window.addEventListener('userLoggedOut', () => {
      this.hideMainApp();
      this.showLogin();
    });
  }

  createLoginInterface() {
    // Crear overlay de login simple y elegante
    const loginHTML = `
      <div id="login-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        z-index: 9999;
      ">
        <div style="
          background: white;
          border-radius: 20px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          width: 100%;
          max-width: 400px;
          margin: 20px;
          overflow: hidden;
        ">
          <!-- Header -->
          <div style="
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            padding: 40px 30px;
            text-align: center;
            color: white;
          ">
            <div style="
              width: 60px;
              height: 60px;
              background: rgba(255, 255, 255, 0.2);
              border-radius: 15px;
              display: flex;
              align-items: center;
              justify-content: center;
              margin: 0 auto 20px;
              backdrop-filter: blur(10px);
            ">
              <svg width="30" height="30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </div>
            <h1 style="
              font-size: 24px;
              font-weight: bold;
              margin: 0 0 8px 0;
              letter-spacing: -0.5px;
            ">BLUEPRINT ANALYZER</h1>
            <p style="
              margin: 0;
              opacity: 0.9;
              font-size: 14px;
            ">Sistema de Análisis de Planos</p>
          </div>

          <!-- Formulario -->
          <div style="padding: 30px;">
            <form id="login-form">
              <div style="margin-bottom: 20px;">
                <label for="email" style="
                  display: block;
                  font-size: 14px;
                  font-weight: 600;
                  color: #374151;
                  margin-bottom: 8px;
                ">Email</label>
                <input 
                  type="email" 
                  id="email" 
                  name="email" 
                  required 
                  style="
                    width: 100%;
                    padding: 12px 16px;
                    border: 2px solid #e5e7eb;
                    border-radius: 10px;
                    font-size: 16px;
                    background: #ffffff;
                    transition: all 0.2s;
                    box-sizing: border-box;
                    color: #1f2937;
                    font-weight: 500;
                  "
                  placeholder="usuario@blueprint.com"
                  onfocus="this.style.borderColor='#4f46e5'; this.style.background='#ffffff'; this.style.boxShadow='0 0 0 3px rgba(79, 70, 229, 0.1)'"
                  onblur="this.style.borderColor=this.value?'#10b981':'#e5e7eb'; this.style.background='#ffffff'; this.style.boxShadow='none'"
                  oninput="this.style.borderColor=this.value?'#10b981':'#e5e7eb'"
                >
              </div>

              <div style="margin-bottom: 20px;">
                <label for="password" style="
                  display: block;
                  font-size: 14px;
                  font-weight: 600;
                  color: #374151;
                  margin-bottom: 8px;
                ">Contraseña</label>
                <input 
                  type="password" 
                  id="password" 
                  name="password" 
                  required 
                  style="
                    width: 100%;
                    padding: 12px 16px;
                    border: 2px solid #e5e7eb;
                    border-radius: 10px;
                    font-size: 16px;
                    background: #ffffff;
                    transition: all 0.2s;
                    box-sizing: border-box;
                    color: #1f2937;
                    font-weight: 500;
                  "
                  placeholder="••••••••"
                  onfocus="this.style.borderColor='#4f46e5'; this.style.background='#ffffff'; this.style.boxShadow='0 0 0 3px rgba(79, 70, 229, 0.1)'"
                  onblur="this.style.borderColor=this.value?'#10b981':'#e5e7eb'; this.style.background='#ffffff'; this.style.boxShadow='none'"
                  oninput="this.style.borderColor=this.value?'#10b981':'#e5e7eb'"
                >
              </div>

              <!-- Mensaje de estado -->
              <div id="login-message" style="
                display: none;
                padding: 12px;
                border-radius: 8px;
                margin-bottom: 20px;
                font-size: 14px;
                font-weight: 500;
              "></div>

              <button 
                type="submit" 
                id="login-button"
                style="
                  width: 100%;
                  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
                  color: white;
                  border: none;
                  padding: 14px;
                  border-radius: 10px;
                  font-size: 16px;
                  font-weight: 600;
                  cursor: pointer;
                  transition: all 0.2s;
                  margin-bottom: 20px;
                "
                onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 10px 25px rgba(79, 70, 229, 0.3)'"
                onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'"
              >
                <span class="login-text">🔐 INICIAR SESIÓN</span>
                <span class="login-spinner" style="display: none;">
                  ⏳ Verificando...
                </span>
              </button>
            </form>

            <!-- Footer -->
            <div style="
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e5e7eb;
              color: #6b7280;
              font-size: 12px;
            ">
              © 2025 Blueprint Analyzer - Sistema Seguro
            </div>
          </div>
        </div>
      </div>
    `;

    // Insertar en el DOM
    document.body.insertAdjacentHTML('afterbegin', loginHTML);
    this.loginContainer = document.getElementById('login-overlay');
    
    // Configurar event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    const form = document.getElementById('login-form');
    
    if (!form) {
      console.error('🚨 Formulario de login no encontrado');
      return;
    }

    // Handle form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleLogin();
    });

    // Enter key handlers
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    
    if (emailInput) {
      emailInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          passwordInput?.focus();
        }
      });
    }

    if (passwordInput) {
      passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.handleLogin();
        }
      });
    }

    console.log('✅ Event listeners configurados correctamente');
  }

  async handleLogin() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const messageDiv = document.getElementById('login-message');
    const button = document.getElementById('login-button');
    const loginText = button.querySelector('.login-text');
    const loginSpinner = button.querySelector('.login-spinner');

    // Reset message
    if (messageDiv) {
      messageDiv.style.display = 'none';
    }

    // Validate inputs
    if (!email || !password) {
      this.showMessage('Por favor, complete todos los campos', 'error');
      return;
    }

    // Show loading state
    button.disabled = true;
    if (loginText) {
      loginText.style.display = 'none';
    }
    if (loginSpinner) {
      loginSpinner.style.display = 'inline';
    } else {
      // Fallback si no existen los elementos
      button.innerHTML = '⏳ Verificando...';
    }

    try {
      // Verificar que auth system esté disponible
      if (!this.auth) {
        throw new Error('Sistema de autenticación no disponible');
      }

      // Simulate network delay for better UX
      await new Promise(resolve => setTimeout(resolve, 1000));

      const result = await this.auth.login(email, password);

      if (result.success) {
        this.showMessage('¡Inicio de sesión exitoso! Bienvenido ' + result.user.name, 'success');
        
        // Wait a moment then show main app
        setTimeout(() => {
          this.showMainApp();
        }, 1500);
      } else {
        this.showMessage(result.message, 'error');
      }
    } catch (error) {
      this.showMessage('Error del sistema. Intente nuevamente.', 'error');
      console.error('Login error:', error);
    } finally {
      // Reset button state
      button.disabled = false;
      if (loginText) {
        loginText.style.display = 'inline';
      }
      if (loginSpinner) {
        loginSpinner.style.display = 'none';
      } else {
        // Fallback para restaurar texto original
        button.innerHTML = '🔐 INICIAR SESIÓN';
      }
    }
  }

  showMessage(message, type) {
    const messageDiv = document.getElementById('login-message');
    messageDiv.style.display = 'block';
    
    if (type === 'error') {
      messageDiv.style.background = '#fef2f2';
      messageDiv.style.color = '#dc2626';
      messageDiv.style.border = '1px solid #fecaca';
      messageDiv.innerHTML = `❌ ${message}`;
    } else if (type === 'success') {
      messageDiv.style.background = '#f0fdf4';
      messageDiv.style.color = '#16a34a';
      messageDiv.style.border = '1px solid #bbf7d0';
      messageDiv.innerHTML = `✅ ${message}`;
    } else if (type === 'warning') {
      messageDiv.style.background = '#fffbeb';
      messageDiv.style.color = '#d97706';
      messageDiv.style.border = '1px solid #fed7aa';
      messageDiv.innerHTML = `⚠️ ${message}`;
    }
  }

  showLogin() {
    if (this.loginContainer) {
      this.loginContainer.classList.remove('hidden');
    }
    
    if (this.mainApp) {
      this.mainApp.style.display = 'none';
    }
  }

  hideMainApp() {
    const appContainer = document.querySelector('.main-app-container');
    if (appContainer) {
      appContainer.remove();
    }
  }

  showMainApp() {
    if (this.loginContainer) {
      this.loginContainer.style.display = 'none';
    }

    // Crear estructura de la aplicación principal si no existe
    this.createMainApplicationStructure();

    // Mostrar mensaje de bienvenida
    this.showWelcomeMessage();

    // Add user info and logout button to header con delay para asegurar que el DOM esté listo
    setTimeout(() => {
      this.addUserControls();
    }, 1000);
  }

  createMainApplicationStructure() {
    // Verificar si la aplicación ya existe
    if (document.querySelector('.main-app-container')) {
      return;
    }

    // Crear estructura principal de la aplicación
    const appHTML = `
      <div class="main-app-container bg-slate-900 min-h-screen">
        <!-- Header principal -->
        <header class="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </div>
            <h1 class="text-xl font-bold text-white">Blueprint Analyzer</h1>
          </div>
          <div id="user-controls-container" class="flex items-center gap-4">
            <!-- Los controles de usuario se agregarán aquí -->
          </div>
        </header>

        <!-- Contenido principal con sidebar -->
        <div class="flex h-screen">
          <!-- Sidebar de navegación -->
          <nav class="w-64 bg-slate-800 border-r border-slate-700 p-4">
            <div class="space-y-2">
              <a href="#dashboard" class="flex items-center gap-3 p-3 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z"></path>
                </svg>
                Dashboard
              </a>
              <a href="#blueprint-analyzer" class="flex items-center gap-3 p-3 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                Analizador de Planos
              </a>
              <a href="#project-management" class="flex items-center gap-3 p-3 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
                </svg>
                Gestión de Proyectos
              </a>
              <a href="#cost-budget" class="flex items-center gap-3 p-3 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"></path>
                </svg>
                Costos y Presupuestos
              </a>
              <a href="#suppliers" class="flex items-center gap-3 p-3 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                </svg>
                Proveedores
              </a>
              <a href="#reports" class="flex items-center gap-3 p-3 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                Reportes
              </a>
              <a href="#settings" class="flex items-center gap-3 p-3 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
                Configuración
              </a>
            </div>
          </nav>

          <!-- Área principal de contenido -->
          <main class="flex-1 p-6 bg-slate-900 overflow-auto">
            <div id="app-content" data-component="dashboard" class="w-full h-full">
              <!-- El contenido de los componentes se cargará aquí -->
            </div>
          </main>
        </div>
      </div>
    `;

    // Insertar la aplicación en el body
    document.body.insertAdjacentHTML('beforeend', appHTML);

    // Agregar funcionalidad de navegación
    this.setupNavigation();
  }

  setupNavigation() {
    // Agregar event listeners a los enlaces de navegación
    document.querySelectorAll('nav a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const component = link.getAttribute('href').substring(1);
        this.navigateToComponent(component);
        
        // Actualizar enlace activo
        document.querySelectorAll('nav a').forEach(l => l.classList.remove('bg-slate-700', 'text-white'));
        document.querySelectorAll('nav a').forEach(l => l.classList.add('text-slate-300'));
        link.classList.remove('text-slate-300');
        link.classList.add('bg-slate-700', 'text-white');
      });
    });

    // Activar el primer enlace por defecto
    const firstLink = document.querySelector('nav a[href="#dashboard"]');
    if (firstLink) {
      firstLink.classList.remove('text-slate-300');
      firstLink.classList.add('bg-slate-700', 'text-white');
    }
  }

  navigateToComponent(componentName) {
    const contentArea = document.getElementById('app-content');
    if (contentArea) {
      contentArea.setAttribute('data-component', componentName);
      
      // Disparar evento para que el main.js cargue el componente
      if (window.ComponentBus) {
        window.ComponentBus.dispatchEvent(new CustomEvent('navigate', {
          detail: { component: componentName }
        }));
      }
    }
  }

  showWelcomeMessage() {
    if (!this.auth) {
      console.error('❌ showWelcomeMessage: AuthSystem no disponible');
      return;
    }
    
    const user = this.auth.getCurrentUser();
    if (!user) return;

    const toast = document.createElement('div');
    toast.className = 'fixed top-4 right-4 bg-indigo-600 text-white px-6 py-4 rounded-lg shadow-lg z-50 flex items-center gap-3 max-w-md';
    toast.innerHTML = `
      <div class="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
        </svg>
      </div>
      <div>
        <div class="font-semibold">¡Bienvenido!</div>
        <div class="text-sm opacity-90">${user.name} - Acceso autorizado</div>
      </div>
    `;

    document.body.appendChild(toast);

    // Animar entrada
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.transition = 'transform 0.3s ease-out';
    }, 100);

    // Remover después de 4 segundos
    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
        }, 300);
      }
    }, 4000);
  }

  addUserControls() {
    if (!this.auth) {
      console.error('❌ addUserControls: AuthSystem no disponible');
      return;
    }
    
    const user = this.auth.getCurrentUser();
    if (!user) return;

    // Esperar a que el DOM esté completamente cargado
    const addControls = () => {
      // Buscar header existente o esperar a que aparezca
      let header = document.querySelector('.bp-hdr');
      
      if (!header) {
        // Si no hay header, intentar de nuevo en un momento
        setTimeout(addControls, 500);
        return;
      }

      // Verificar si ya se agregaron los controles para evitar duplicados
      if (header.querySelector('#user-controls')) {
        return;
      }

      // Buscar si ya hay controles ML-auto para reemplazarlos o agregar después
      const existingControls = header.querySelector('.ml-auto');
      
      // Crear controles de usuario
      const userControls = document.createElement('div');
      userControls.id = 'user-controls';
      userControls.className = 'flex items-center gap-3 bg-slate-800 px-3 py-1 rounded-lg border border-slate-600';
      
      userControls.innerHTML = `
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
            ${user.name.charAt(0).toUpperCase()}
          </div>
          <div class="text-sm">
            <div class="font-medium text-slate-200">${user.name}</div>
            <div class="text-xs text-slate-400 capitalize">${this.translateRole(user.role)}</div>
          </div>
        </div>
        <div class="h-6 w-px bg-slate-600"></div>
        <button id="logout-button" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
          </svg>
          Salir
        </button>
      `;

      // Insertar los controles
      if (existingControls) {
        existingControls.appendChild(userControls);
      } else {
        // Si no hay controles ml-auto, crear un contenedor
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'ml-auto flex items-center gap-3';
        controlsContainer.appendChild(userControls);
        header.appendChild(controlsContainer);
      }

      // Agregar funcionalidad de logout
      const logoutButton = document.getElementById('logout-button');
      if (logoutButton) {
        logoutButton.addEventListener('click', (e) => {
          e.preventDefault();
          this.handleLogout();
        });
      }
    };

    // Ejecutar inmediatamente o esperar al DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addControls);
    } else {
      setTimeout(addControls, 100);
    }
  }

  translateRole(role) {
    const roles = {
      'admin': 'administrador',
      'engineer': 'ingeniero',
      'architect': 'arquitecto', 
      'supervisor': 'supervisor',
      'analyst': 'analista'
    };
    return roles[role] || role;
  }

  handleLogout() {
    // Crear modal de confirmación personalizado
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-slate-800 p-6 rounded-lg border border-slate-600 max-w-md w-full mx-4">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 bg-yellow-600 rounded-full flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.502 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-semibold text-white">Cerrar Sesión</h3>
            <p class="text-slate-400 text-sm">¿Está seguro que desea salir del sistema?</p>
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button id="cancel-logout" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md transition-colors">
            Cancelar
          </button>
          <button id="confirm-logout" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors">
            Cerrar Sesión
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners para el modal
    document.getElementById('cancel-logout').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    document.getElementById('confirm-logout').addEventListener('click', () => {
      document.body.removeChild(modal);
      
      // Mostrar mensaje de cierre
      this.showLogoutMessage();
      
      // Cerrar sesión después de un momento
      setTimeout(() => {
        this.auth.logout();
        location.reload();
      }, 1500);
    });

    // Cerrar modal al hacer click fuera
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  showLogoutMessage() {
    const user = this.auth.getCurrentUser();
    const toast = document.createElement('div');
    toast.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3';
    toast.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
      </svg>
      <span>Sesión cerrada correctamente. ¡Hasta pronto, ${user?.name}!</span>
    `;

    document.body.appendChild(toast);

    // Remover después de mostrar
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 3000);
  }
}

// Exportar la clase
window.LoginUI = LoginUI;