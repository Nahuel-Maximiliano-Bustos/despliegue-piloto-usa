// asidebar.js — Pro dark sidebar (US English)
// Tailwind-friendly. Sin dependencias.
// Compact 72px / Expanded 280px. Section headers, accordions, badges,
// active indicator, profile card, tooltips, a11y + persistence.

export default function mount(el, props = {}) {
  console.log('🚀 Asidebar mount called with props:', props); // Debug
  console.log('🚀 Props.items:', props.items); // Debug
  console.log('🚀 Props.items type:', typeof props.items, 'isArray:', Array.isArray(props.items)); // Debug
  
  const brand = String(props.brand ?? "market-fx.ts");
  /** @type {Array} sections/ items */
  const nav = Array.isArray(props.items) ? props.items : [];
  const footer = props.footer ?? [{ label: "Settings", href: "#settings", icon: "cog" }];
  
  console.log('🚀 Final nav array:', nav); // Debug

  const LS_OPEN = "ui_sidebar_expanded_v2";
  const LS_ACCS = "ui_sidebar_accordions_v1";

  const initialExpanded =
    typeof props.expanded === "boolean"
      ? props.expanded
      : (localStorage.getItem(LS_OPEN) ?? "1") === "1";

  const openedAccordions = loadAccordions();

  el.innerHTML = `
    <aside
      class="fixed inset-y-0 left-0 z-40 border-r border-slate-800/60 bg-[#0B0F14]/90
             backdrop-blur-md transition-all duration-200 flex flex-col"
      data-aside
      data-state="${initialExpanded ? "expanded" : "collapsed"}"
      style="width:${initialExpanded ? "280px" : "72px"}"
      aria-label="Primary navigation"
    >
      <!-- Top brand -->
      <div class="relative h-16 px-3 flex items-center gap-3 border-b border-slate-800/60">
        <button
          aria-label="Toggle sidebar"
          class="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-12 rounded-l-xl bg-black/30 border border-slate-800
                 hover:bg-black/40 active:opacity-80 focus:outline-none focus:ring-2 focus:ring-blue-500
                 flex items-center justify-center"
          data-role="expand"
        >
          <span class="inline-block w-5 h-5 transition-transform" data-role="arrow">
            ${icon("chev-left")}
          </span>
        </button>

        <span class="flex items-center gap-3 overflow-hidden" data-role="brand">
          ${logo()}
          <span class="text-slate-100 font-semibold tracking-tight text-lg whitespace-nowrap" data-role="brand-text">${escapeHTML(brand)}</span>
        </span>
      </div>

      <!-- Nav -->
      <nav class="flex-1 overflow-y-auto px-2 py-3 space-y-2" data-role="nav" role="navigation" aria-label="Main">
        ${renderNav(nav)}
      </nav>

      <!-- Footer -->
      <div class="mt-auto px-2 py-2 border-t border-slate-800/60">
        ${footer.map(i => navItem(i)).join("")}
        ${profileCard(props.profile)}
      </div>
    </aside>
  `;

  // Refs
  const qs = (s) => el.querySelector(s);
  const aside = qs("aside");
  const expandBtn = qs('[data-role="expand"]');
  const arrowIcon = qs('[data-role="arrow"]');
  const brandWrap = qs('[data-role="brand"]');
  const brandText = qs('[data-role="brand-text"]');
  const linkNodes = aside.querySelectorAll("a[data-href]");
  const accordionBtns = aside.querySelectorAll("button[data-acc]");
  const getLabels = () => aside.querySelectorAll(".sb-label");

  // State
  let expanded = initialExpanded;
  applyState();

  // Toggle
  const onToggle = () => {
    expanded = !expanded;
    localStorage.setItem(LS_OPEN, expanded ? "1" : "0");
    applyState();
    el.dispatchEvent(new CustomEvent("ui:sidebar:toggle", { bubbles: true, detail: { expanded } }));
  };
  expandBtn.addEventListener("click", onToggle);

  // Keyboard: Ctrl/Cmd+B
  const onKey = (e) => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      onToggle();
    }
  };
  document.addEventListener("keydown", onKey);

  // Accordions
  accordionBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.acc;
      const open = !(openedAccordions[key] ?? false);
      openedAccordions[key] = open;
      saveAccordions();
      setAccordionState(btn, open);
    });
    // init state
    setAccordionState(btn, !!openedAccordions[btn.dataset.acc]);
  });

  // Active by hash + emit
  const markActive = () => {
    const hash = location.hash || "#dashboard";
    linkNodes.forEach((a) => {
      const active = a.getAttribute("href") === hash;
      a.classList.toggle("bg-white/5", active);
      a.classList.toggle("text-white", active);
      a.setAttribute("aria-current", active ? "page" : "false");
      // indicator bar
      const ind = a.querySelector("[data-ind]");
      if (ind) ind.style.opacity = active ? "1" : "0";
    });
  };
  markActive();
  const onHash = () => {
    markActive();
    el.dispatchEvent(new CustomEvent("ui:navigate", { bubbles: true, detail: { href: location.hash } }));
  };
  window.addEventListener("hashchange", onHash);

  // Click emits navigate (router can intercept)
  linkNodes.forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      const ev = new CustomEvent("ui:navigate", { bubbles: true, cancelable: true, detail: { href } });
      const cancelled = !el.dispatchEvent(ev) ? true : ev.defaultPrevented;
      if (cancelled) e.preventDefault();
    });
  });

  // Profile modal functionality
  const profileTrigger = qs('[data-role="profile-trigger"]');
  const profileModal = document.querySelector('[data-role="profile-modal"]'); // Search in document
  const logoutBtn = document.querySelector('[data-role="logout-btn"]'); // Search in document
  const closeModalBtn = document.querySelector('[data-role="close-modal"]'); // Search in document
  
  if (profileTrigger && profileModal) {
    const showModal = () => {
      profileModal.classList.remove('hidden');
      profileModal.classList.add('flex');
    };
    
    const hideModal = () => {
      profileModal.classList.add('hidden');
      profileModal.classList.remove('flex');
    };
    
    profileTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      showModal();
    });
    
    // Close modal when clicking overlay
    profileModal.addEventListener('click', (e) => {
      if (e.target === profileModal) {
        hideModal();
      }
    });
    
    // Close modal button
    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', hideModal);
    }
    
    // Logout functionality
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        // Emit logout event that the main app can listen to
        el.dispatchEvent(new CustomEvent("ui:logout", { bubbles: true }));
        hideModal();
      });
    }
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !profileModal.classList.contains('hidden')) {
        hideModal();
      }
    });
  }

  function applyState() {
    aside.dataset.state = expanded ? "expanded" : "collapsed";
    aside.style.width = expanded ? "280px" : "72px";

    // Arrow icon flip
    arrowIcon.style.transform = expanded ? "rotate(180deg)" : "rotate(0deg)";

    // Labels and headers visibility
    getLabels().forEach((n) => (n.style.display = expanded ? "" : "none"));
    aside.querySelectorAll("[data-section]").forEach((h) => (h.style.display = expanded ? "" : "none"));

    // Brand visibility
    brandWrap.style.display = expanded ? "flex" : "none";
    brandText.style.display = expanded ? "" : "none";

    // Center icons when collapsed
    aside.querySelectorAll("[data-role='item']").forEach((a) => {
      a.classList.toggle("justify-center", !expanded);
      a.classList.toggle("gap-3", expanded);
      a.classList.toggle("gap-0", !expanded);
    });

    // Tooltips via title when collapsed
    aside.querySelectorAll("[data-tt]").forEach((a) => {
      a.title = !expanded ? a.dataset.tt : "";
    });

    // Hide accordion chevrons when collapsed
    aside.querySelectorAll("[data-chevron]").forEach((c) => {
      c.style.display = expanded ? "" : "none";
    });
  }

  function setAccordionState(btn, open) {
    btn.setAttribute("aria-expanded", String(open));
    const panel = aside.querySelector(`[data-panel="${btn.dataset.acc}"]`);
    if (!panel) return;
    panel.style.display = open ? "" : "none";
    btn.querySelector("[data-chevron]").style.transform = open ? "rotate(180deg)" : "rotate(0deg)";
  }

  function renderNav(data) {
    console.log('🔍 renderNav called with data:', data); // Debug
    console.log('🔍 renderNav data type:', typeof data, 'isArray:', Array.isArray(data)); // Debug
    console.log('🔍 renderNav data length:', data ? data.length : 'undefined'); // Debug
    
    if (!Array.isArray(data) || data.length === 0) {
      console.warn('⚠️ renderNav: No valid navigation data provided');
      return '<div class="px-2 py-4 text-slate-400 text-sm">No navigation items</div>';
    }
    
    const result = data
      .map((n, idx) => {
        console.log(`🔍 Processing nav item ${idx}:`, n); // Debug
        if (n.section) {
          return `
            <div>
              <div class="text-[11px] uppercase tracking-wider text-slate-400/70 px-2 pt-2 pb-1 sb-label" data-section>
                ${escapeHTML(n.section)}
              </div>
              <div class="space-y-1">
                ${(n.items || []).map((i) => (i.children ? accordion(i) : navItem(i))).join("")}
              </div>
            </div>
          `;
        }
        return n.children ? accordion(n) : navItem(n);
      })
      .join("");
      
    console.log('🔍 renderNav result length:', result.length); // Debug
    return result;
  }

  function accordion(node) {
    const key = `acc:${(node.label || "").toLowerCase().replace(/\s+/g, "-")}`;
    const open = !!openedAccordions[key];
    return `
      <div class="rounded-xl overflow-hidden">
        <button class="w-full flex items-center gap-0 px-2 py-2.5 rounded-lg hover:bg-white/5 text-slate-300
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-acc="${escapeAttr(key)}" aria-expanded="${open}" data-tt="${escapeAttr(node.label)}">
          <span class="inline-flex items-center justify-center w-8 h-8 text-base">${icon(node.icon)}</span>
          <span class="sb-label ml-3 flex-1 text-left">${escapeHTML(node.label)}</span>
          <span data-chevron class="sb-label inline-block w-4 h-4 transition-transform opacity-70">${icon("chev-down")}</span>
        </button>
        <div class="ml-3 pl-3 border-l border-slate-800/60 space-y-1 mt-1" data-panel="${escapeAttr(key)}" style="display:${open ? "" : "none"}">
          ${(node.children || []).map((i) => subItem(i)).join("")}
        </div>
      </div>
    `;
  }

  function navItem(i) {
    const href = escapeAttr(i.href ?? "#");
    const label = String(i.label ?? "Item");
    const badge = i.badge != null ? String(i.badge) : "";
    return `
      <a href="${href}" data-href data-role="item" data-tt="${escapeAttr(label)}"
         class="group relative flex items-center gap-0 px-2 py-2.5 rounded-lg hover:bg-white/5
                text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
         aria-current="false">
        <span class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-500 rounded-r opacity-0 transition" data-ind></span>
        <span class="inline-flex items-center justify-center w-8 h-8 text-base">${icon(i.icon)}</span>
        <span class="sb-label ml-3 flex-1">${escapeHTML(label)}</span>
        ${badge ? `<span class="sb-label ml-auto text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">${escapeHTML(badge)}</span>` : ""}
      </a>
    `;
  }

  function subItem(i) {
    const href = escapeAttr(i.href ?? "#");
    const label = String(i.label ?? "Item");
    const badge = i.badge != null ? String(i.badge) : "";
    return `
      <a href="${href}" data-href data-role="item" data-tt="${escapeAttr(label)}"
         class="relative flex items-center gap-0 px-2 py-2 rounded-lg hover:bg-white/5
                text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
         aria-current="false">
        <span class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-blue-500 rounded-r opacity-0 transition" data-ind></span>
        <span class="inline-block w-2 h-2 rounded-full bg-slate-600"></span>
        <span class="sb-label ml-3 flex-1">${escapeHTML(label)}</span>
        ${badge ? `<span class="sb-label ml-auto text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">${escapeHTML(badge)}</span>` : ""}
      </a>
    `;
  }

  function profileCard(p = {}) {
    const name = p.name ?? "User";
    const email = p.email ?? "user@blueprint.com";
    const initials = (p.initials ?? getInitials(name)).slice(0, 2).toUpperCase();
    return `
      <div class="mt-2">
        <div class="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/5 cursor-pointer"
             data-role="profile-trigger" data-tt="${escapeAttr(name)}">
          <div class="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-white
                      flex items-center justify-center text-sm font-semibold">${escapeHTML(initials)}</div>
          <div class="sb-label flex-1">
            <div class="text-slate-100 text-sm leading-tight">${escapeHTML(name)}</div>
            <div class="text-slate-400 text-xs leading-tight">${escapeHTML(email)}</div>
          </div>
          <div class="sb-label">
            ${icon("chev-down")}
          </div>
        </div>
      </div>
      
      <!-- Modal overlay -->
      <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 hidden items-center justify-center"
           data-role="profile-modal">
        <div class="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6 mx-4 min-w-80 max-w-md">
          <div class="flex items-center gap-4 mb-6">
            <div class="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-white
                        flex items-center justify-center text-lg font-semibold">${escapeHTML(initials)}</div>
            <div>
              <div class="text-slate-100 text-lg font-semibold">${escapeHTML(name)}</div>
              <div class="text-slate-400 text-sm">${escapeHTML(email)}</div>
            </div>
          </div>
          
          <div class="space-y-2">
            <button class="w-full flex items-center gap-3 px-4 py-3 text-slate-300 hover:bg-slate-700 hover:text-white rounded-lg transition-colors"
                    data-role="logout-btn">
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5 opacity-90">
                <path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              </svg>
              <span>Sign Out</span>
            </button>
          </div>
          
          <button class="absolute top-4 right-4 text-slate-400 hover:text-white"
                  data-role="close-modal">
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  /* ---------- icons / utils ---------- */
  function logo() {
    return `<div class="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-400 shadow-md flex items-center justify-center">
      <span class="text-white font-bold">A</span>
    </div>`;
  }
  function icon(name) {
    const s = {
      grid: `<svg viewBox="0 0 24 24" fill="currentColor" class="opacity-90"><path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg>`,
      box: `<svg viewBox="0 0 24 24" fill="currentColor" class="opacity-90"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>`,
      layers: `<svg viewBox="0 0 24 24" fill="currentColor" class="opacity-90"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>`,
      users: `<svg viewBox="0 0 24 24" fill="currentColor" class="opacity-90"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`,
      folder: `<svg viewBox="0 0 24 24" fill="currentColor" class="opacity-90"><path d="M3 7h6l2 2h10v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>`,
      cog: `<svg viewBox="0 0 24 24" fill="currentColor" class="opacity-90"><path d="M10.3 2.3l.7 1.9a8 8 0 012 0l.7-1.9 2 1.2-.7 1.9a8 8 0 011.4 1.4l1.9-.7 1.2 2-1.9.7a8 8 0 010 2l1.9.7-1.2 2-1.9-.7a8 8 0 01-1.4 1.4l.7 1.9-2 1.2-.7-1.9a8 8 0 01-2 0l-.7 1.9-2-1.2.7-1.9a8 8 0 01-1.4-1.4l-1.9.7-1.2-2 1.9-.7a8 8 0 010-2l-1.9-.7 1.2-2 1.9.7a8 8 0 011.4-1.4l-.7-1.9 2-1.2z"/><circle cx="12" cy="12" r="3"/></svg>`,
      "chev-left": `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.7 6.3a1 1 0 010 1.4L10.4 12l4.3 4.3a1 1 0 01-1.4 1.4l-5-5a1 1 0 010-1.4l5-5a1 1 0 011.4 0z"/></svg>`,
      "chev-down": `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.3 9.3a1 1 0 011.4 0L12 13.6l4.3-4.3a1 1 0 111.4 1.4l-5 5a1 1 0 01-1.4 0l-5-5a1 1 0 010-1.4z"/></svg>`,
    };
    return s[name] ?? s.grid;
  }
  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
  function escapeAttr(s) {
    return escapeHTML(String(s)).replaceAll('"', "&quot;");
  }
  function getInitials(name) {
    return name.split(/\s+/).map(p => p[0] || "").join("");
  }
  function loadAccordions() {
    try { return JSON.parse(localStorage.getItem(LS_ACCS) || "{}"); } catch { return {}; }
  }
  function saveAccordions() {
    try { localStorage.setItem(LS_ACCS, JSON.stringify(openedAccordions)); } catch {}
  }

  return {
    destroy() {
      expandBtn.removeEventListener("click", onToggle);
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("keydown", onKey);
    }
  };
}

// Adapter for compatibility with component system
export function createComponent(props) {
  // Default navigation structure for Blueprint Analyzer
  const defaultNavigation = [
    {
      section: "ANALYSIS",
      items: [
        { label: "Dashboard", href: "#dashboard", icon: "grid" },
        { label: "Blueprint Analyzer", href: "#blueprint-analyzer", icon: "layers" }
      ]
    },
    {
      section: "MANAGEMENT", 
      items: [
        { label: "Project Management", href: "#project-management", icon: "folder" },
        { label: "Cost & Budget", href: "#cost-budget", icon: "box" },
        { label: "Suppliers", href: "#suppliers", icon: "users" }
      ]
    },
    {
      section: "REPORTS",
      items: [
        { label: "Reports", href: "#reports", icon: "layers" },
        { label: "Material & Labor", href: "#material-labor", icon: "box" }
      ]
    }
  ];

  // Get current user info from auth system
  const getCurrentUserInfo = () => {
    if (window.authSystem && window.authSystem.isLoggedIn()) {
      const user = window.authSystem.getCurrentUser();
      console.log('Current user from auth:', user); // Debug
      return {
        name: user.name || "User",
        email: user.email || "user@blueprint.com",
        initials: user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase() : "U"
      };
    }
    return {
      name: "John Smith",
      email: "john@blueprint.com", 
      initials: "JS"
    };
  };

  const sidebarProps = {
    brand: "Blueprint Analyzer",
    items: props.items || defaultNavigation,
    expanded: props.expanded !== false,
    profile: props.profile || getCurrentUserInfo(),
    footer: [
      { label: "Settings", href: "#settings", icon: "cog" }
    ],
    ...props
  };

  console.log('Sidebar props:', sidebarProps); // Debug

  return {
    render: () => '', // Not needed, mount modifies DOM directly
    mount: async (el) => {
      return mount(el || document.createElement('div'), sidebarProps);
    },
    destroy: () => {}
  };
}
