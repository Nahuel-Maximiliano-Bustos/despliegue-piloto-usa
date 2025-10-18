// Sistema de Autenticación - Blueprint Analyzer
// Módulo de seguridad y gestión de sesiones

class AuthSystem {
  constructor() {
    this.users = new Map();
    this.currentUser = null;
    this.sessionTimeout = 2 * 60 * 60 * 1000; // 2 horas en milisegundos
    this.sessionTimer = null;
    this.initializeUsers();
    this.checkExistingSession();
  }

  // Función simple de hash (para propósitos de demostración)
  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'blueprint_salt_2025');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Inicializar usuarios del sistema
  async initializeUsers() {
    const usersData = [
      {
        email: 'admin@steeleye.com',
        password: 'Bp2025!Admin#',
        name: 'Administrador Principal',
        role: 'admin',
        permissions: ['all']
      },
      {
        email: 'ing.rodriguez@steeleye.com',
        password: 'StElEng$2025',
        name: 'Ing. Rodríguez',
        role: 'engineer',
        permissions: ['read', 'write', 'analyze']
      },
      {
        email: 'arq.martinez@steeleye.com',
        password: 'ArchDesign*24',
        name: 'Arq. Martínez',
        role: 'architect',
        permissions: ['read', 'write', 'design']
      },
      {
        email: 'supervisor@steeleye.com',
        password: 'TechSuper&25!',
        name: 'Supervisor Técnico',
        role: 'supervisor',
        permissions: ['read', 'write', 'supervise']
      },
      {
        email: 'analista@steeleye.com',
        password: 'ProjAnalyst#2025',
        name: 'Analista de Proyectos',
        role: 'analyst',
        permissions: ['read', 'analyze']
      }
    ];

    for (const userData of usersData) {
      const hashedPassword = await this.hashPassword(userData.password);
      this.users.set(userData.email, {
        ...userData,
        password: hashedPassword,
        lastLogin: null,
        loginAttempts: 0,
        lockedUntil: null
      });
    }
  }

  // Verificar sesión existente al cargar la página
  checkExistingSession() {
    const sessionData = localStorage.getItem('blueprint_session');
    if (sessionData) {
      try {
        const session = JSON.parse(sessionData);
        const now = Date.now();
        
        if (session.expiresAt > now) {
          this.currentUser = session.user;
          this.startSessionTimer();
          // Emitir evento inmediatamente - SIN DELAYS
          this.dispatchLoginEvent();
          return true;
        } else {
          localStorage.removeItem('blueprint_session');
        }
      } catch (error) {
        localStorage.removeItem('blueprint_session');
      }
    }
    return false;
  }

  // Validar email
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Validar fortaleza de contraseña
  isStrongPassword(password) {
    const minLength = 8;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    return password.length >= minLength && hasUpper && hasLower && hasNumber && hasSymbol;
  }

  // Verificar si el usuario está bloqueado
  isUserLocked(email) {
    const user = this.users.get(email);
    if (!user || !user.lockedUntil) return false;
    
    if (Date.now() > user.lockedUntil) {
      user.lockedUntil = null;
      user.loginAttempts = 0;
      return false;
    }
    return true;
  }

  // Intentar inicio de sesión
  async login(email, password) {
    if (!this.isValidEmail(email)) {
      return { success: false, message: 'Email no válido' };
    }

    if (this.isUserLocked(email)) {
      return { success: false, message: 'Usuario bloqueado. Intente más tarde.' };
    }

    const user = this.users.get(email);
    if (!user) {
      return { success: false, message: 'Credenciales incorrectas' };
    }

    const hashedPassword = await this.hashPassword(password);
    
    if (user.password !== hashedPassword) {
      user.loginAttempts++;
      
      if (user.loginAttempts >= 3) {
        user.lockedUntil = Date.now() + (15 * 60 * 1000); // Bloquear por 15 minutos
        return { success: false, message: 'Usuario bloqueado por múltiples intentos fallidos' };
      }
      
      return { success: false, message: `Credenciales incorrectas. Intentos restantes: ${3 - user.loginAttempts}` };
    }

    // Login exitoso
    user.loginAttempts = 0;
    user.lockedUntil = null;
    user.lastLogin = new Date().toISOString();
    
    this.currentUser = {
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: user.permissions
    };

    this.createSession();
    this.startSessionTimer();
    
    // Delay antes de disparar el evento para evitar conflictos de UI
    setTimeout(() => {
      this.dispatchLoginEvent();
    }, 100);

    return { 
      success: true, 
      message: 'Inicio de sesión exitoso',
      user: this.currentUser 
    };
  }

  // Crear sesión en localStorage
  createSession() {
    const sessionData = {
      user: this.currentUser,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionTimeout
    };
    
    localStorage.setItem('blueprint_session', JSON.stringify(sessionData));
  }

  // Iniciar temporizador de sesión
  startSessionTimer() {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
    }

    this.sessionTimer = setTimeout(() => {
      this.logout();
      alert('Su sesión ha expirado. Por favor, inicie sesión nuevamente.');
      location.reload();
    }, this.sessionTimeout);
  }

  // Cerrar sesión
  logout() {
    const user = this.currentUser;
    
    // Registrar el logout
    if (user) {
      console.log(`🔓 Usuario ${user.name} (${user.email}) cerró sesión`);
    }
    
    // Limpiar datos de sesión
    this.currentUser = null;
    localStorage.removeItem('blueprint_session');
    
    // Limpiar timer de sesión
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    
    // Limpiar otros datos temporales si existen
    sessionStorage.clear();
    
    // Notificar que la sesión terminó
    this.dispatchLogoutEvent();
  }

  // Disparar evento de login para otros componentes
  dispatchLoginEvent() {
    const event = new CustomEvent('userLoggedIn', {
      detail: { 
        user: this.currentUser,
        timestamp: new Date().toISOString() 
      }
    });
    window.dispatchEvent(event);
  }

  // Disparar evento de logout para otros componentes
  dispatchLogoutEvent() {
    const event = new CustomEvent('userLoggedOut', {
      detail: { timestamp: new Date().toISOString() }
    });
    window.dispatchEvent(event);
  }

  // Verificar si el usuario está autenticado
  isAuthenticated() {
    return this.currentUser !== null;
  }

  // Alias para isAuthenticated (compatibilidad)
  isLoggedIn() {
    return this.isAuthenticated();
  }

  // Verificar permisos
  hasPermission(permission) {
    if (!this.currentUser) return false;
    return this.currentUser.permissions.includes('all') || 
           this.currentUser.permissions.includes(permission);
  }

  // Obtener usuario actual
  getCurrentUser() {
    return this.currentUser;
  }

  // Extender sesión (renovar tiempo)
  extendSession() {
    if (this.isAuthenticated()) {
      this.createSession();
      this.startSessionTimer();
    }
  }
}

// Exportar la clase
window.AuthSystem = AuthSystem;