// Middleware de Seguridad - Blueprint Analyzer
// Funciones adicionales de protección y monitoreo

class SecurityMiddleware {
  constructor(authSystem) {
    this.auth = authSystem;
    this.loginAttempts = new Map();
    this.suspiciousActivity = [];
    this.init();
  }

  init() {
    // Protección contra manipulación del DOM
    this.protectConsole();
    this.monitorDOMChanges();
    this.preventInspectorAccess();
    this.setupCSPViolationHandling();
  }

  // Deshabilitar métodos de consola en producción
  protectConsole() {
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      const methods = ['log', 'debug', 'info', 'warn', 'error', 'assert', 'dir', 'dirxml', 
                     'group', 'groupEnd', 'time', 'timeEnd', 'count', 'trace', 'profile', 'profileEnd'];
      
      methods.forEach(method => {
        console[method] = () => {};
      });
    }
  }

  // Monitorear cambios sospechosos en el DOM
  monitorDOMChanges() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // Detectar inyección de scripts sospechosos
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeName === 'SCRIPT' && !node.src.includes(location.origin)) {
              this.logSuspiciousActivity('External script injection attempt', {
                src: node.src,
                content: node.textContent
              });
              node.remove();
            }
          });
        }
      });
    });

    observer.observe(document, {
      childList: true,
      subtree: true
    });
  }

  // Prevenir acceso a herramientas de desarrollador
  preventInspectorAccess() {
    // Detectar DevTools
    let devtools = { opened: false, orientation: null };
    setInterval(() => {
      if (window.outerHeight - window.innerHeight > 200 || 
          window.outerWidth - window.innerWidth > 200) {
        if (!devtools.opened) {
          devtools.opened = true;
          this.handleDevToolsDetection();
        }
      } else {
        devtools.opened = false;
      }
    }, 500);

    // Bloquear teclas de acceso rápido
    document.addEventListener('keydown', (e) => {
      // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
      if (e.key === 'F12' || 
          (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
          (e.ctrlKey && e.key === 'U')) {
        e.preventDefault();
        this.logSuspiciousActivity('Developer tools access attempt', {
          key: e.key,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey
        });
        return false;
      }
    });

    // Bloquear menú contextual
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });

    // Bloquear selección de texto
    document.addEventListener('selectstart', (e) => {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        return false;
      }
    });
  }

  handleDevToolsDetection() {
    this.logSuspiciousActivity('Developer tools opened');
    
    // En un entorno de producción, podrías cerrar sesión automáticamente
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      alert('Acceso no autorizado detectado. La sesión será cerrada por seguridad.');
      this.auth.logout();
      location.reload();
    }
  }

  // Manejo de violaciones CSP
  setupCSPViolationHandling() {
    document.addEventListener('securitypolicyviolation', (e) => {
      this.logSuspiciousActivity('CSP Violation', {
        violatedDirective: e.violatedDirective,
        blockedURI: e.blockedURI,
        documentURI: e.documentURI
      });
    });
  }

  // Verificar integridad de archivos críticos
  async verifyFileIntegrity() {
    const criticalFiles = [
      '/js/auth.js',
      '/js/login-ui.js',
      '/js/main.js'
    ];

    for (const file of criticalFiles) {
      try {
        const response = await fetch(file);
        const content = await response.text();
        
        // Verificaciones básicas de integridad
        if (content.includes('eval(') || content.includes('Function(')) {
          this.logSuspiciousActivity('Potential code injection in file', { file });
        }
      } catch (error) {
        this.logSuspiciousActivity('File verification failed', { file, error: error.message });
      }
    }
  }

  // Monitorear intentos de login
  trackLoginAttempt(email, success, ip = 'unknown') {
    const key = `${email}_${ip}`;
    const now = Date.now();
    
    if (!this.loginAttempts.has(key)) {
      this.loginAttempts.set(key, []);
    }
    
    const attempts = this.loginAttempts.get(key);
    attempts.push({ timestamp: now, success });
    
    // Mantener solo intentos de las últimas 24 horas
    const dayAgo = now - (24 * 60 * 60 * 1000);
    this.loginAttempts.set(key, attempts.filter(a => a.timestamp > dayAgo));
    
    // Verificar patrones sospechosos
    const recentFailures = attempts.filter(a => !a.success && a.timestamp > (now - 15 * 60 * 1000));
    if (recentFailures.length >= 5) {
      this.logSuspiciousActivity('Multiple failed login attempts', {
        email,
        ip,
        attempts: recentFailures.length
      });
    }
  }

  // Registrar actividad sospechosa
  logSuspiciousActivity(type, details = {}) {
    const activity = {
      timestamp: new Date().toISOString(),
      type,
      details,
      userAgent: navigator.userAgent,
      url: location.href,
      user: this.auth.getCurrentUser()?.email || 'anonymous'
    };
    
    this.suspiciousActivity.push(activity);
    
    // Mantener solo los últimos 100 registros
    if (this.suspiciousActivity.length > 100) {
      this.suspiciousActivity.shift();
    }
    
    // En un sistema real, esto se enviaría a un servidor de logging
    console.warn('🚨 Actividad sospechosa detectada:', activity);
    
    // Opcional: notificar al administrador en tiempo real
    this.notifyAdmin(activity);
  }

  // Notificar al administrador (simulado)
  notifyAdmin(activity) {
    // En un sistema real, esto sería una llamada a una API
    if (activity.type.includes('injection') || activity.type.includes('tools')) {
      // Simular notificación crítica
      setTimeout(() => {
        console.log('📧 Notificación enviada al administrador sobre:', activity.type);
      }, 1000);
    }
  }

  // Obtener reporte de seguridad
  getSecurityReport() {
    return {
      suspiciousActivities: this.suspiciousActivity,
      loginAttempts: Object.fromEntries(this.loginAttempts),
      timestamp: new Date().toISOString()
    };
  }

  // Limpiar registros antiguos
  cleanupOldLogs() {
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    this.suspiciousActivity = this.suspiciousActivity.filter(
      activity => new Date(activity.timestamp).getTime() > weekAgo
    );
    
    for (const [key, attempts] of this.loginAttempts.entries()) {
      const filtered = attempts.filter(a => a.timestamp > weekAgo);
      if (filtered.length === 0) {
        this.loginAttempts.delete(key);
      } else {
        this.loginAttempts.set(key, filtered);
      }
    }
  }
}

// Hacer disponible globalmente
window.SecurityMiddleware = SecurityMiddleware;