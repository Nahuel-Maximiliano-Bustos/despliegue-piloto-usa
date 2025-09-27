// settings.js — Full Settings panel (dark, responsive, vanilla JS, US English)
// Usage:
//   import mountSettings from './settings.js'
//   mountSettings(document.querySelector('#settings'), { provider: myProvider })  // optional provider
//
// If no provider is passed, a LocalStorage provider is used (key: "app.settings.v1").
// Replace the provider methods to connect your real backend without touching the UI.

export default function mountSettings(el, props = {}) {
    // -------------------------------
    // Config & Provider (pluggable)
    // -------------------------------
    const STORAGE_KEY = props.storageKey ?? 'app.settings.v1';

    // Minimal helpers for token generation / ids
    const uid = () => Math.random().toString(36).slice(2, 10);
    const token = (len = 40) => Array.from(crypto.getRandomValues(new Uint8Array(len)))
        .map(b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
    const nowISO = () => new Date().toISOString();

    // LocalStorage provider (safe defaults). Swap with your backend.
    const localProvider = {
        _read() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) return JSON.parse(raw);
            } catch { }
            // Defaults (empty but valid)
            return {
                org: {
                    name: 'Your Organization',
                    legalName: '',
                    logoUrl: '',
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                    locale: 'en-US',
                    currency: 'USD',
                    units: 'imperial', // imperial | metric
                    dateFormat: 'MM/dd/yyyy',
                    twoFactorRequired: false,
                    retentionDays: 365,
                },
                user: {
                    id: 'U-0001',
                    name: 'Admin',
                    email: 'admin@example.com',
                    twoFactorEnabled: false,
                },
                preferences: {
                    theme: 'dark', // dark only in UI, but kept here for parity
                    density: 'comfortable', // comfortable | compact
                    sidebarCollapsed: false,
                },
                notifications: {
                    email: {
                        estimates: true,
                        budgetAlerts: true,
                        weeklyDigest: true,
                    },
                    push: {
                        approvals: true,
                        mentions: true,
                    },
                    thresholds: {
                        costOverrunPct: 10,
                    }
                },
                users: [
                    { id: 'U-0001', name: 'Admin', email: 'admin@example.com', role: 'owner', active: true, joinedAt: nowISO() },
                ],
                apiKeys: [
                    // { id, label, last4, tokenHash, scopes, createdAt, expiresAt }
                ],
                webhooks: [
                    // { id, url, event, active, createdAt }
                ],
                integrations: {
                    slackWebhookUrl: '',
                    smtp: { host: '', port: 587, username: '', from: '', tls: true },
                },
                billing: {
                    plan: 'Free',
                    renewalAt: null,
                    invoices: [], // { id, date, amount, status, url }
                }
            };
        },
        _write(data) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        },

        // --- Basic get/save
        async getAll() { return this._read(); },
        async savePatch(patch) {
            const db = this._read();
            const merged = deepMerge(db, patch);
            this._write(merged);
            return merged;
        },

        // --- Users
        async listUsers() { return this._read().users; },
        async addUser({ name, email, role }) {
            const db = this._read();
            const u = { id: `U-${uid()}`, name, email, role: role || 'member', active: true, joinedAt: nowISO() };
            db.users.push(u); this._write(db); return u;
        },
        async updateUser(userId, patch) {
            const db = this._read();
            const i = db.users.findIndex(u => u.id === userId);
            if (i < 0) throw new Error('User not found');
            db.users[i] = { ...db.users[i], ...patch }; this._write(db); return db.users[i];
        },
        async deleteUser(userId) {
            const db = this._read();
            db.users = db.users.filter(u => u.id !== userId);
            this._write(db);
        },

        // --- API Keys
        async listApiKeys() { return this._read().apiKeys; },
        async createApiKey({ label, scopes, expiresAt }) {
            const db = this._read();
            const raw = token(48);
            const key = { id: `K-${uid()}`, label, last4: raw.slice(-4), tokenHash: pseudoHash(raw), scopes, createdAt: nowISO(), expiresAt: expiresAt || null };
            db.apiKeys.push(key); this._write(db);
            return { ...key, plain: raw }; // plain returned ONCE
        },
        async deleteApiKey(id) {
            const db = this._read();
            db.apiKeys = db.apiKeys.filter(k => k.id !== id);
            this._write(db);
        },

        // --- Webhooks
        async listWebhooks() { return this._read().webhooks; },
        async addWebhook({ url, event }) {
            const db = this._read();
            const wh = { id: `W-${uid()}`, url, event, active: true, createdAt: nowISO() };
            db.webhooks.push(wh); this._write(db); return wh;
        },
        async deleteWebhook(id) {
            const db = this._read();
            db.webhooks = db.webhooks.filter(w => w.id !== id);
            this._write(db);
        },
        async toggleWebhook(id, active) {
            const db = this._read();
            const i = db.webhooks.findIndex(w => w.id === id);
            if (i < 0) throw new Error('Webhook not found');
            db.webhooks[i].active = !!active; this._write(db); return db.webhooks[i];
        },

        // --- Test hooks / smtp (no-op locally)
        async testEmail(to) { return { ok: true, message: `Test email queued to ${to}` }; },
        async testWebhook(id) { return { ok: true, message: `Webhook ${id} test event enqueued` }; },

        // --- Billing
        async getBilling() { return this._read().billing; },
        async saveBilling(patch) {
            const db = this._read(); db.billing = { ...db.billing, ...patch }; this._write(db); return db.billing;
        },
    };

    const provider = props.provider ?? localProvider;

    // -------------------------------
    // State
    // -------------------------------
    const state = {
        data: null,
        panel: 'general', // general | preferences | notifications | users | security | api | integrations | data | billing
        saving: false,
        error: null,
        searchUser: '',
    };

    // -------------------------------
    // Utilities
    // -------------------------------
    const $$ = (sel, root = el) => Array.from(root.querySelectorAll(sel));
    const $ = (sel, root = el) => root.querySelector(sel);
    const toastQueue = [];
    let toastTimer = null;

    function deepMerge(a, b) {
        if (Array.isArray(b)) return b.slice();
        if (b && typeof b === 'object') {
            const out = { ...(a || {}) };
            for (const k of Object.keys(b)) out[k] = deepMerge(a?.[k], b[k]);
            return out;
        }
        return b;
    }

    function pseudoHash(s) {
        // Not cryptographically secure; only to avoid storing plain keys in LocalStorage
        let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i), h |= 0;
        return String(h >>> 0);
    }

    function money(n) { return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }

    function toast(msg, kind = 'ok') {
        toastQueue.push({ msg, kind });
        if (!toastTimer) runToast();
    }
    function runToast() {
        const item = toastQueue.shift(); if (!item) { toastTimer = null; return; }
        const bar = document.createElement('div');
        bar.className = `fixed bottom-4 right-4 z-50 rounded-lg px-3 py-2 text-sm shadow
      ${item.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`;
        bar.textContent = item.msg;
        document.body.appendChild(bar);
        toastTimer = setTimeout(() => { bar.remove(); toastTimer = null; runToast(); }, 2200);
    }

    // -------------------------------
    // Render skeleton (dark)
    // -------------------------------
    el.innerHTML = `
    <div class="px-6 md:px-10 py-8 md:ml-72 min-h-[90vh] bg-slate-950">
      <div class="flex items-center gap-3">
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#0f172a"></rect>
          <path d="M5 12h14M5 17h10M5 7h10" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"></path>
        </svg>
        <h1 class="text-5xl md:text-6xl font-black tracking-tight text-slate-50">Settings</h1>
      </div>
      <p class="mt-2 text-lg text-slate-400">Configure your organization, preferences, security, and integrations.</p>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <!-- Sidebar -->
        <aside class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <nav class="grid gap-2" data-role="nav">
            ${[
            ['general', 'General'],
            ['preferences', 'Preferences'],
            ['notifications', 'Notifications'],
            ['users', 'Users & Roles'],
            ['security', 'Security'],
            ['api', 'API & Webhooks'],
            ['integrations', 'Integrations'],
            ['data', 'Data & Privacy'],
            ['billing', 'Billing'],
        ].map(([k, lab]) => `
              <button data-panel="${k}" class="text-left rounded-lg px-3 py-2 text-slate-200 hover:bg-slate-800/60 border border-transparent">${lab}</button>
            `).join('')}
          </nav>
        </aside>

        <!-- Main -->
        <section class="lg:col-span-2 space-y-6" data-role="panels">
          <!-- Panels are injected below -->
        </section>
      </div>
    </div>
  `;

    const nav = $('[data-role="nav"]');
    const panels = $('[data-role="panels"]');

    // -------------------------------
    // Panels (templates)
    // -------------------------------
    const T = {
        general(d) {
            return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-100">General</h3>
          <div class="flex items-center gap-2">
            <button data-action="save-general" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2">Save changes</button>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Organization name</span>
            <input value="${escape(d.org.name)}" name="orgName" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
          </label>
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Legal name</span>
            <input value="${escape(d.org.legalName || '')}" name="orgLegalName" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
          </label>
          <label class="text-sm text-slate-300 md:col-span-2">
            <span class="block mb-1">Logo URL</span>
            <input value="${escape(d.org.logoUrl || '')}" name="logoUrl" placeholder="https://…" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
          </label>
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Time zone</span>
            <input value="${escape(d.org.timezone)}" name="timezone" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
          </label>
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Locale</span>
            <input value="${escape(d.org.locale)}" name="locale" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
          </label>
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Currency (ISO)</span>
            <input value="${escape(d.org.currency)}" name="currency" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
          </label>
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Units</span>
            <select name="units" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2">
              <option ${d.org.units === 'imperial' ? 'selected' : ''} value="imperial">Imperial (US)</option>
              <option ${d.org.units === 'metric' ? 'selected' : ''} value="metric">Metric</option>
            </select>
          </label>
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Date format</span>
            <input value="${escape(d.org.dateFormat)}" name="dateFormat" placeholder="MM/dd/yyyy" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
          </label>
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Data retention (days)</span>
            <input type="number" value="${d.org.retentionDays || 365}" name="retentionDays" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
          </label>
          <label class="text-sm text-slate-300 flex items-center gap-2 md:col-span-2">
            <input type="checkbox" name="twoFactorRequired" ${d.org.twoFactorRequired ? 'checked' : ''} class="accent-blue-500">
            <span>Require two-factor authentication for all users</span>
          </label>
        </div>
      </div>`;
        },

        preferences(d) {
            return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-100">Preferences</h3>
          <button data-action="save-preferences" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2">Save changes</button>
        </div>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label class="text-sm text-slate-300"><span class="block mb-1">Theme</span>
            <select name="theme" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2">
              <option selected value="dark">Dark</option>
            </select>
          </label>
          <label class="text-sm text-slate-300"><span class="block mb-1">Density</span>
            <select name="density" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2">
              <option ${d.preferences.density === 'comfortable' ? 'selected' : ''} value="comfortable">Comfortable</option>
              <option ${d.preferences.density === 'compact' ? 'selected' : ''} value="compact">Compact</option>
            </select>
          </label>
          <label class="text-sm text-slate-300 flex items-center gap-2 md:col-span-1">
            <input type="checkbox" name="sidebarCollapsed" ${d.preferences.sidebarCollapsed ? 'checked' : ''} class="accent-blue-500">
            <span>Collapse sidebar by default</span>
          </label>
        </div>
      </div>`;
        },

        notifications(d) {
            const n = d.notifications;
            return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-100">Notifications</h3>
          <button data-action="save-notifications" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2">Save changes</button>
        </div>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <fieldset class="border border-slate-800 rounded-xl p-3">
            <legend class="px-2 text-slate-200">Email</legend>
            ${check('email.estimates', 'Estimates updates', n.email.estimates)}
            ${check('email.budgetAlerts', 'Budget alerts', n.email.budgetAlerts)}
            ${check('email.weeklyDigest', 'Weekly digest', n.email.weeklyDigest)}
            <label class="text-sm text-slate-300 block mt-2"><span class="block mb-1">Budget overrun threshold (%)</span>
              <input type="number" step="1" name="threshold.costOverrunPct" value="${n.thresholds.costOverrunPct || 10}" class="w-40 rounded bg-slate-800 border border-slate-700 text-slate-100 px-2 py-1"/>
            </label>
          </fieldset>
          <fieldset class="border border-slate-800 rounded-xl p-3">
            <legend class="px-2 text-slate-200">Push</legend>
            ${check('push.approvals', 'Approvals', n.push.approvals)}
            ${check('push.mentions', 'Mentions', n.push.mentions)}
          </fieldset>
        </div>
      </div>`;
        },

        users(d) {
            const q = state.searchUser.trim().toLowerCase();
            const users = d.users.filter(u =>
                !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
            );
            return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-lg font-semibold text-slate-100">Users & Roles</h3>
          <div class="flex items-center gap-2">
            <input data-role="user-search" placeholder="Search users…" class="rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2">
            <button data-action="invite-user" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3 py-2">Invite</button>
          </div>
        </div>
        <div class="mt-3 overflow-x-auto">
          <table class="w-full text-sm border border-slate-800 text-slate-200">
            <thead class="bg-slate-800/60">
              <tr>
                <th class="px-2 py-1 text-left">Name</th>
                <th class="px-2 py-1 text-left">Email</th>
                <th class="px-2 py-1 text-left">Role</th>
                <th class="px-2 py-1 text-left">Active</th>
                <th class="px-2 py-1 text-left">Joined</th>
                <th class="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => `
              <tr data-user="${u.id}">
                <td class="px-2 py-1">${escape(u.name)}</td>
                <td class="px-2 py-1">${escape(u.email)}</td>
                <td class="px-2 py-1">
                  <select class="rounded bg-slate-800 border border-slate-700 text-slate-100 px-1 py-1">
                    ${['owner', 'admin', 'manager', 'member', 'viewer'].map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                  </select>
                </td>
                <td class="px-2 py-1">
                  <label class="inline-flex items-center gap-2 text-slate-200">
                    <input type="checkbox" ${u.active ? 'checked' : ''} class="accent-blue-500">
                    <span>${u.active ? 'Active' : 'Inactive'}</span>
                  </label>
                </td>
                <td class="px-2 py-1 text-slate-400">${new Date(u.joinedAt).toLocaleDateString()}</td>
                <td class="px-2 py-1 text-right">
                  <button data-action="remove-user" class="rounded border border-red-900 text-red-300 hover:bg-red-950 px-2">Remove</button>
                </td>
              </tr>`).join('') || `<tr><td colspan="6" class="px-2 py-2 text-slate-500">No users found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
        },

        security(d) {
            return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-100">Security</h3>
          <div class="flex items-center gap-2">
            <button data-action="logout-all" class="rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 px-3 py-2">Log out all sessions</button>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <fieldset class="border border-slate-800 rounded-xl p-3">
            <legend class="px-2 text-slate-200">Password</legend>
            <label class="text-sm text-slate-300 block mb-2">
              <span class="block mb-1">Current password</span>
              <input type="password" data-sec="current" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
            </label>
            <label class="text-sm text-slate-300 block mb-2">
              <span class="block mb-1">New password</span>
              <input type="password" data-sec="new" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
            </label>
            <label class="text-sm text-slate-300 block">
              <span class="block mb-1">Confirm new password</span>
              <input type="password" data-sec="confirm" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
            </label>
            <div class="mt-3 text-right">
              <button data-action="change-password" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3 py-2">Change password</button>
            </div>
          </fieldset>

          <fieldset class="border border-slate-800 rounded-xl p-3">
            <legend class="px-2 text-slate-200">Two-Factor Authentication</legend>
            <label class="inline-flex items-center gap-2 text-slate-200">
              <input type="checkbox" data-sec="2fa" ${d.user.twoFactorEnabled ? 'checked' : ''} class="accent-blue-500">
              <span>Enable 2FA for my account</span>
            </label>
            <div class="mt-3">
              <button data-action="backup-codes" class="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">Generate backup codes</button>
            </div>
            <div data-role="codes" class="mt-2 text-xs text-slate-400"></div>
          </fieldset>
        </div>
      </div>`;
        },

        api(d) {
            return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-100">API & Webhooks</h3>
          <div class="flex items-center gap-2">
            <button data-action="new-key" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3 py-2">New API key</button>
            <button data-action="add-webhook" class="rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 px-3 py-2">Add webhook</button>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-xl border border-slate-800 p-3">
            <div class="text-slate-200 font-semibold">API Keys</div>
            <table class="mt-2 w-full text-sm border border-slate-800 text-slate-200">
              <thead class="bg-slate-800/60"><tr><th class="px-2 py-1 text-left">Label</th><th class="px-2 py-1 text-left">Scopes</th><th class="px-2 py-1 text-left">Created</th><th class="px-2 py-1 text-left">Expires</th><th class="px-2 py-1"></th></tr></thead>
              <tbody data-role="keys"></tbody>
            </table>
            <div data-role="key-once" class="mt-2 text-xs text-amber-300"></div>
          </div>

          <div class="rounded-xl border border-slate-800 p-3">
            <div class="text-slate-200 font-semibold">Webhooks</div>
            <table class="mt-2 w-full text-sm border border-slate-800 text-slate-200">
              <thead class="bg-slate-800/60"><tr><th class="px-2 py-1 text-left">Event</th><th class="px-2 py-1 text-left">URL</th><th class="px-2 py-1 text-left">Active</th><th class="px-2 py-1"></th></tr></thead>
              <tbody data-role="hooks"></tbody>
            </table>
          </div>
        </div>
      </div>`;
        },

        integrations(d) {
            const i = d.integrations;
            return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-100">Integrations</h3>
          <button data-action="save-integrations" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2">Save changes</button>
        </div>

        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <fieldset class="border border-slate-800 rounded-xl p-3">
            <legend class="px-2 text-slate-200">Slack</legend>
            <label class="text-sm text-slate-300 block">
              <span class="block mb-1">Incoming webhook URL</span>
              <input name="slackWebhookUrl" value="${escape(i.slackWebhookUrl || '')}" placeholder="https://hooks.slack.com/services/…" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
            </label>
          </fieldset>

          <fieldset class="border border-slate-800 rounded-xl p-3">
            <legend class="px-2 text-slate-200">SMTP</legend>
            <div class="grid grid-cols-2 gap-2">
              <label class="text-sm text-slate-300"><span class="block mb-1">Host</span><input name="smtp.host" value="${escape(i.smtp.host || '')}" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/></label>
              <label class="text-sm text-slate-300"><span class="block mb-1">Port</span><input type="number" name="smtp.port" value="${i.smtp.port ?? 587}" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/></label>
              <label class="text-sm text-slate-300"><span class="block mb-1">Username</span><input name="smtp.username" value="${escape(i.smtp.username || '')}" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/></label>
              <label class="text-sm text-slate-300"><span class="block mb-1">From (email)</span><input name="smtp.from" value="${escape(i.smtp.from || '')}" class="w-full rounded bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/></label>
              <label class="text-sm text-slate-300 flex items-center gap-2 col-span-2">
                <input type="checkbox" name="smtp.tls" ${i.smtp.tls ? 'checked' : ''} class="accent-blue-500"><span>Use TLS</span>
              </label>
            </div>
            <div class="mt-2">
              <button data-action="test-email" class="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">Send test email</button>
            </div>
          </fieldset>
        </div>
      </div>`;
        },

        data(d) {
            return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-100">Data & Privacy</h3>
        </div>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-xl border border-slate-800 p-3">
            <div class="text-slate-200 font-semibold">Export settings</div>
            <p class="text-slate-400 text-sm mt-1">Download a JSON snapshot of your settings.</p>
            <button data-action="export-settings" class="mt-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3 py-2">Export JSON</button>
          </div>
          <div class="rounded-xl border border-slate-800 p-3">
            <div class="text-slate-200 font-semibold">Import settings</div>
            <p class="text-slate-400 text-sm mt-1">Upload a JSON file to overwrite current settings.</p>
            <input type="file" accept="application/json" data-role="import-file" class="mt-2 block text-slate-300"/>
            <button data-action="import-settings" class="mt-2 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 px-3 py-2">Import</button>
          </div>
          <div class="rounded-xl border border-slate-800 p-3 md:col-span-2">
            <div class="text-red-300 font-semibold">Danger zone</div>
            <p class="text-slate-400 text-sm mt-1">Clear local cache (does not affect server data).</p>
            <button data-action="clear-cache" class="mt-2 rounded-lg border border-red-900 text-red-300 hover:bg-red-950 px-3 py-2">Clear local cache</button>
          </div>
        </div>
      </div>`;
        },

        billing(d) {
            const b = d.billing || { plan: 'Free', renewalAt: null, invoices: [] };
            return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-100">Billing</h3>
          <button data-action="save-billing" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2">Save</button>
        </div>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Plan</span>
            <select name="plan" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2">
              ${['Free', 'Starter', 'Pro', 'Enterprise'].map(p => `<option ${b.plan === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </label>
          <label class="text-sm text-slate-300">
            <span class="block mb-1">Renewal date</span>
            <input name="renewalAt" type="date" value="${b.renewalAt ? b.renewalAt.slice(0, 10) : ''}" class="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2"/>
          </label>
        </div>
        <div class="mt-4">
          <div class="text-slate-200 font-semibold">Invoices</div>
          <table class="mt-2 w-full text-sm border border-slate-800 text-slate-200">
            <thead class="bg-slate-800/60"><tr><th class="px-2 py-1 text-left">Invoice</th><th class="px-2 py-1 text-left">Date</th><th class="px-2 py-1 text-right">Amount</th><th class="px-2 py-1 text-left">Status</th></tr></thead>
            <tbody>
              ${(b.invoices || []).map(i => `
                <tr>
                  <td class="px-2 py-1">${escape(i.id)}</td>
                  <td class="px-2 py-1">${new Date(i.date).toLocaleDateString()}</td>
                  <td class="px-2 py-1 text-right">${money(i.amount)}</td>
                  <td class="px-2 py-1">${escape(i.status)}</td>
                </tr>
              `).join('') || `<tr><td class="px-2 py-2 text-slate-500" colspan="4">No invoices.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
        }
    };

    // -------------------------------
    // Small helpers for templates
    // -------------------------------
    function escape(s) { return String(s || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", "&#39;"); }
    function check(name, label, checked) {
        return `
    <label class="block text-sm text-slate-300">
      <span class="inline-flex items-center gap-2"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} class="accent-blue-500"><span>${label}</span></span>
    </label>`;
    }

    // -------------------------------
    // Render & wire
    // -------------------------------
    async function render() {
        // Sidebar active
        nav.querySelectorAll('[data-panel]').forEach(b => {
            b.classList.toggle('bg-slate-800', b.dataset.panel === state.panel);
            b.classList.toggle('border', b.dataset.panel === state.panel);
            b.classList.toggle('border-slate-700', b.dataset.panel === state.panel);
        });

        const d = state.data;
        panels.innerHTML = T[state.panel](d);

        // Wire panel-specific events
        wirePanel();
    }

    function wirePanel() {
        if (state.panel === 'general') {
            $('[data-action="save-general"]').addEventListener('click', async () => {
                const patch = {
                    org: {
                        name: $('[name="orgName"]').value.trim(),
                        legalName: $('[name="orgLegalName"]').value.trim(),
                        logoUrl: $('[name="logoUrl"]').value.trim(),
                        timezone: $('[name="timezone"]').value.trim(),
                        locale: $('[name="locale"]').value.trim(),
                        currency: $('[name="currency"]').value.trim() || 'USD',
                        units: $('[name="units"]').value,
                        dateFormat: $('[name="dateFormat"]').value.trim(),
                        retentionDays: Number($('[name="retentionDays"]').value || 365),
                        twoFactorRequired: panels.querySelector('[name="twoFactorRequired"]').checked,
                    }
                };
                await provider.savePatch(patch);
                state.data = await provider.getAll();
                toast('General settings saved');
                render();
            });
        }

        if (state.panel === 'preferences') {
            $('[data-action="save-preferences"]').addEventListener('click', async () => {
                const patch = {
                    preferences: {
                        theme: panels.querySelector('[name="theme"]').value,
                        density: panels.querySelector('[name="density"]').value,
                        sidebarCollapsed: panels.querySelector('[name="sidebarCollapsed"]').checked,
                    }
                };
                await provider.savePatch(patch);
                state.data = await provider.getAll();
                toast('Preferences saved');
                render();
            });
        }

        if (state.panel === 'notifications') {
            $('[data-action="save-notifications"]').addEventListener('click', async () => {
                const get = (n) => panels.querySelector(`[name="${n}"]`)?.checked || false;
                const patch = {
                    notifications: {
                        email: {
                            estimates: get('email.estimates'),
                            budgetAlerts: get('email.budgetAlerts'),
                            weeklyDigest: get('email.weeklyDigest'),
                        },
                        push: {
                            approvals: get('push.approvals'),
                            mentions: get('push.mentions'),
                        },
                        thresholds: {
                            costOverrunPct: Number(panels.querySelector('[name="threshold.costOverrunPct"]').value || 10),
                        }
                    }
                };
                await provider.savePatch(patch);
                state.data = await provider.getAll();
                toast('Notification settings saved');
                render();
            });
        }

        if (state.panel === 'users') {
            const search = $('[data-role="user-search"]');
            search.value = state.searchUser;
            search.addEventListener('input', () => { state.searchUser = search.value; render(); });

            panels.querySelectorAll('tbody tr').forEach(tr => {
                const id = tr.dataset.user;
                const roleSel = tr.querySelector('select');
                const activeChk = tr.querySelector('input[type="checkbox"]');
                roleSel.addEventListener('change', async () => { await provider.updateUser(id, { role: roleSel.value }); toast('Role updated'); });
                activeChk.addEventListener('change', async () => { await provider.updateUser(id, { active: activeChk.checked }); toast('User status updated'); });
                tr.querySelector('[data-action="remove-user"]').addEventListener('click', async () => {
                    if (!confirm('Remove this user?')) return;
                    await provider.deleteUser(id);
                    state.data.users = await provider.listUsers();
                    render();
                });
            });

            $('[data-action="invite-user"]').addEventListener('click', async () => {
                const name = prompt('Name:'); if (!name) return;
                const email = prompt('Email:'); if (!email) return;
                const role = prompt('Role (owner/admin/manager/member/viewer):', 'member') || 'member';
                await provider.addUser({ name, email, role });
                state.data.users = await provider.listUsers();
                toast('Invitation registered'); render();
            });
        }

        if (state.panel === 'security') {
            $('[data-action="change-password"]').addEventListener('click', async () => {
                const cur = panels.querySelector('[data-sec="current"]').value;
                const n1 = panels.querySelector('[data-sec="new"]').value;
                const n2 = panels.querySelector('[data-sec="confirm"]').value;
                if (!n1 || n1.length < 8) { toast('Password must be at least 8 characters', 'err'); return; }
                if (n1 !== n2) { toast('Passwords do not match', 'err'); return; }
                // Delegate to provider in real app; here we just notify
                toast('Password change submitted');
            });

            panels.querySelector('[data-sec="2fa"]').addEventListener('change', async (e) => {
                await provider.savePatch({ user: { twoFactorEnabled: e.target.checked } });
                state.data = await provider.getAll(); toast('2FA setting updated');
            });

            $('[data-action="backup-codes"]').addEventListener('click', () => {
                const codes = Array.from({ length: 8 }, () => `${uid()}-${uid()}`.slice(0, 10).toUpperCase());
                const box = $('[data-role="codes"]');
                box.innerHTML = `<div class="text-slate-300">Save these one-time codes:</div><pre class="mt-1 p-2 bg-slate-800 rounded border border-slate-700">${codes.join('\n')}</pre>`;
            });

            $('[data-action="logout-all"]').addEventListener('click', () => {
                if (!confirm('Log out all active sessions?')) return;
                toast('All sessions will be logged out');
            });
        }

        if (state.panel === 'api') {
            // Keys table
            renderKeys();
            renderHooks();

            $('[data-action="new-key"]').addEventListener('click', async () => {
                const label = prompt('Key label:'); if (!label) return;
                const scopes = prompt('Scopes (comma separated):', 'read,write') || 'read';
                const expires = prompt('Expires at (YYYY-MM-DD) optional:', '') || null;
                const { plain } = await provider.createApiKey({ label, scopes: scopes.split(',').map(s => s.trim()).filter(Boolean), expiresAt: expires ? `${expires}T00:00:00Z` : null });
                const info = $('[data-role="key-once"]');
                info.textContent = `Copy your API key now — it will not be shown again: ${plain}`;
                state.data.apiKeys = await provider.listApiKeys();
                renderKeys();
            });

            $('[data-action="add-webhook"]').addEventListener('click', async () => {
                const event = prompt('Event (e.g., estimate.updated):', 'estimate.updated'); if (!event) return;
                const url = prompt('Webhook URL:'); if (!url) return;
                await provider.addWebhook({ url, event });
                state.data.webhooks = await provider.listWebhooks();
                renderHooks();
            });
        }

        if (state.panel === 'integrations') {
            $('[data-action="save-integrations"]').addEventListener('click', async () => {
                const patch = {
                    integrations: {
                        slackWebhookUrl: panels.querySelector('[name="slackWebhookUrl"]').value.trim(),
                        smtp: {
                            host: panels.querySelector('[name="smtp.host"]').value.trim(),
                            port: Number(panels.querySelector('[name="smtp.port"]').value || 587),
                            username: panels.querySelector('[name="smtp.username"]').value.trim(),
                            from: panels.querySelector('[name="smtp.from"]').value.trim(),
                            tls: panels.querySelector('[name="smtp.tls"]').checked,
                        }
                    }
                };
                await provider.savePatch(patch);
                state.data = await provider.getAll();
                toast('Integrations saved');
            });

            $('[data-action="test-email"]').addEventListener('click', async () => {
                const to = prompt('Send test email to:', 'admin@example.com'); if (!to) return;
                const res = await provider.testEmail(to);
                toast(res.ok ? res.message : 'Email test failed', res.ok ? 'ok' : 'err');
            });
        }

        if (state.panel === 'data') {
            $('[data-action="export-settings"]').addEventListener('click', async () => {
                const data = await provider.getAll();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `settings_export_${Date.now()}.json`;
                document.body.appendChild(a); a.click();
                setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
            });

            $('[data-action="import-settings"]').addEventListener('click', async () => {
                const file = panels.querySelector('[data-role="import-file"]').files?.[0];
                if (!file) { toast('Choose a file first', 'err'); return; }
                const text = await file.text();
                try {
                    const json = JSON.parse(text);
                    await provider.savePatch(json);
                    state.data = await provider.getAll();
                    toast('Settings imported'); render();
                } catch {
                    toast('Invalid JSON', 'err');
                }
            });

            $('[data-action="clear-cache"]').addEventListener('click', () => {
                if (!confirm('This clears LocalStorage for settings on this browser. Continue?')) return;
                localStorage.removeItem(STORAGE_KEY);
                toast('Local cache cleared');
                // reload state
                init();
            });
        }

        if (state.panel === 'billing') {
            $('[data-action="save-billing"]').addEventListener('click', async () => {
                const plan = panels.querySelector('[name="plan"]').value;
                const renewalAt = panels.querySelector('[name="renewalAt"]').value || null;
                const b = await provider.saveBilling({ plan, renewalAt: renewalAt ? `${renewalAt}T00:00:00Z` : null });
                state.data.billing = b; toast('Billing updated'); render();
            });
        }
    }

    function renderKeys() {
        const tbody = panels.querySelector('[data-role="keys"]');
        const keys = state.data.apiKeys || [];
        tbody.innerHTML = keys.map(k => `
      <tr data-key="${k.id}">
        <td class="px-2 py-1">${escape(k.label)}</td>
        <td class="px-2 py-1">${Array.isArray(k.scopes) ? k.scopes.join(', ') : ''}</td>
        <td class="px-2 py-1">${new Date(k.createdAt).toLocaleDateString()}</td>
        <td class="px-2 py-1">${k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '—'}</td>
        <td class="px-2 py-1 text-right">
          <button data-action="del-key" class="rounded border border-red-900 text-red-300 hover:bg-red-950 px-2">Delete</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="5" class="px-2 py-2 text-slate-500">No API keys.</td></tr>`;

        tbody.querySelectorAll('[data-action="del-key"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.closest('tr').dataset.key;
                if (!confirm('Delete this API key?')) return;
                await provider.deleteApiKey(id);
                state.data.apiKeys = await provider.listApiKeys();
                renderKeys();
                toast('API key deleted');
            });
        });
    }

    function renderHooks() {
        const tbody = panels.querySelector('[data-role="hooks"]');
        const hooks = state.data.webhooks || [];
        tbody.innerHTML = hooks.map(h => `
      <tr data-hook="${h.id}">
        <td class="px-2 py-1">${escape(h.event)}</td>
        <td class="px-2 py-1">${escape(h.url)}</td>
        <td class="px-2 py-1">
          <label class="inline-flex items-center gap-2"><input type="checkbox" ${h.active ? 'checked' : ''} class="accent-blue-500"><span>${h.active ? 'Active' : 'Paused'}</span></label>
        </td>
        <td class="px-2 py-1 text-right">
          <button data-action="test-hook" class="rounded border border-slate-700 text-slate-200 hover:bg-slate-800 px-2">Test</button>
          <button data-action="del-hook"  class="rounded border border-red-900 text-red-300 hover:bg-red-950 px-2">Delete</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="4" class="px-2 py-2 text-slate-500">No webhooks.</td></tr>`;

        tbody.querySelectorAll('tr').forEach(tr => {
            const id = tr.dataset.hook;
            tr.querySelector('input[type="checkbox"]').addEventListener('change', async (e) => {
                await provider.toggleWebhook(id, e.target.checked);
                state.data.webhooks = await provider.listWebhooks();
                toast('Webhook updated');
            });
            tr.querySelector('[data-action="test-hook"]').addEventListener('click', async () => {
                const res = await provider.testWebhook(id);
                toast(res.ok ? res.message : 'Webhook test failed', res.ok ? 'ok' : 'err');
            });
            tr.querySelector('[data-action="del-hook"]').addEventListener('click', async () => {
                if (!confirm('Delete this webhook?')) return;
                await provider.deleteWebhook(id);
                state.data.webhooks = await provider.listWebhooks();
                renderHooks(); toast('Webhook deleted');
            });
        });
    }

    // -------------------------------
    // Navigation events & Init
    // -------------------------------
    nav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-panel]'); if (!btn) return;
        state.panel = btn.dataset.panel;
        render();
    });

    async function init() {
        state.data = await provider.getAll();
        render();
    }

    init();
}
