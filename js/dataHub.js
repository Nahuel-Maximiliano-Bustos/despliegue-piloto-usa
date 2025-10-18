const WAIT_INTERVAL = 150;
const WAIT_TIMEOUT = 6000;

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
};

function waitForStore(timeout = WAIT_TIMEOUT) {
  return new Promise((resolve) => {
    if (window.AppStore) return resolve(window.AppStore);
    const start = Date.now();
    const timer = setInterval(() => {
      if (window.AppStore) {
        clearInterval(timer);
        resolve(window.AppStore);
        return;
      }
      if (Date.now() - start > timeout) {
        clearInterval(timer);
        console.warn("dataHub: AppStore not detected within timeout");
        resolve(null);
      }
    }, WAIT_INTERVAL);
  });
}

function computeMaterialSummary(materialLabor = {}) {
  const materials = toArray(materialLabor.materials).map((item) => ({
    name: item.name || "Material",
    qty: Number(item.qty) || 0,
    unit: Number(item.unit) || 0,
    cost: (Number(item.qty) || 0) * (Number(item.unit) || 0)
  }));
  const labor = toArray(materialLabor.labor).map((item) => ({
    role: item.role || "Role",
    hours: Number(item.hours) || 0,
    rate: Number(item.rate) || 0,
    cost: (Number(item.hours) || 0) * (Number(item.rate) || 0)
  }));
  const subtotalMaterials = materials.reduce((acc, m) => acc + m.cost, 0);
  const subtotalLabor = labor.reduce((acc, l) => acc + l.cost, 0);
  const subtotal = subtotalMaterials + subtotalLabor;
  const overheadPct = Number(materialLabor.overheadPct) || 0;
  const profitPct = Number(materialLabor.profitPct) || 0;
  const taxPct = Number(materialLabor.taxPct) || 0;
  const overhead = subtotal * (overheadPct / 100);
  const profit = (subtotal + overhead) * (profitPct / 100);
  const tax = (subtotal + overhead + profit) * (taxPct / 100);
  const total = subtotal + overhead + profit + tax;
  return {
    currency: materialLabor.currency || "USD",
    materials,
    labor,
    totals: {
      materials: subtotalMaterials,
      labor: subtotalLabor,
      subtotal,
      overhead,
      profit,
      tax,
      total
    }
  };
}

function computeSupplierStats(suppliers = []) {
  const stats = suppliers.reduce((acc, row) => {
    const total = (Number(row.qty) || 0) * (Number(row.unitPrice) || 0);
    acc.committed += total;
    const delivered = row.status === "Delivered" || row.status === "Cancelled";
    if (!delivered) acc.open += 1;
    if (!delivered && row.deliveryDate) {
      const eta = new Date(row.deliveryDate);
      if (!Number.isNaN(eta.getTime()) && eta < new Date()) acc.delayed += 1;
    }
    return acc;
  }, { committed: 0, open: 0, delayed: 0 });
  return {
    totals: stats,
    count: suppliers.length
  };
}

function buildUsageSeries(projects = [], blueprintSummary) {
  const length = 12;
  const base = projects.length || 1;
  const blueprintWeight = blueprintSummary?.totals?.totalIcons ? blueprintSummary.totals.totalIcons / length : 0;
  return Array.from({ length }, (_, index) => {
    const sine = Math.sin(index / 2) * 2;
    const value = base + blueprintWeight + sine + (index % 3);
    return Math.max(1, Math.round(value));
  });
}

function buildAlerts({ blueprintSummary, materialSummary, supplierStats, costControl }) {
  const alerts = [];
  if (blueprintSummary && blueprintSummary.totals?.totalIcons) {
    const hasMaterials = materialSummary.totals.materials > 0;
    if (!hasMaterials) {
      alerts.push({
        id: "alert-blueprint-materials",
        level: "warning",
        message: "Blueprint markers detected but no materials added yet.",
        action: "#material-labor"
      });
    }
  }
  if (supplierStats.totals.delayed > 0) {
    alerts.push({
      id: "alert-suppliers-delayed",
      level: "danger",
      message: `${supplierStats.totals.delayed} supplier order${supplierStats.totals.delayed === 1 ? " is" : "s are"} delayed.`,
      action: "#suppliers"
    });
  }
  const estimates = toArray(costControl?.estimates);
  if (!estimates.length) {
    alerts.push({
      id: "alert-cost-estimates",
      level: "info",
      message: "No cost estimates created yet.",
      action: "#cost-budget"
    });
  }
  return alerts;
}

function buildPayload(store) {
  const state = store.getAll ? store.getAll() : {};
  const projects = store.getProjects ? store.getProjects() : [];
  const costControl = store.getCostControl ? store.getCostControl() : {};
  const materialLabor = store.getMaterialLabor ? store.getMaterialLabor() : {};
  const suppliers = store.getSuppliers ? store.getSuppliers() : [];
  const reports = store.getReports ? store.getReports() : [];
  const blueprintSummary = store.getBlueprintSummary ? store.getBlueprintSummary() : null;
  const notifications = store.getNotifications ? toArray(store.getNotifications()) : toArray(state.notifications);

  const materialSummary = computeMaterialSummary(materialLabor);
  const supplierStats = computeSupplierStats(suppliers);
  const alerts = buildAlerts({ blueprintSummary, materialSummary, supplierStats, costControl });
  const usage = buildUsageSeries(projects, blueprintSummary);

  const materialsForDashboard = materialSummary.materials.map((item) => ({
    name: item.name,
    cost: item.cost
  }));

  return {
    timestamp: new Date().toISOString(),
    projects,
    estimates: toArray(costControl?.estimates),
    materials: materialsForDashboard,
    alerts,
    notifications,
    usage,
    blueprintSummary,
    suppliers,
    materialSummary,
    supplierStats,
    costControl,
    reports
  };
}

(async () => {
  const store = await waitForStore();
  if (!store) return;

  let lastPayload = null;
  let scheduled = false;

  const broadcast = () => {
    try {
      const payload = buildPayload(store);
      lastPayload = payload;
      document.dispatchEvent(new CustomEvent("ui:data:update", { detail: payload }));
      if (typeof store.publish === "function") {
        store.publish("data:bridge", payload);
      }
      window.__dataBridge = {
        getLast: () => lastPayload
      };
    } catch (error) {
      console.error("dataHub: broadcast failed", error);
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(() => {
      scheduled = false;
      broadcast();
    });
  };

  broadcast();

  const subscriptions = [];
  const subscribe = (event) => {
    if (typeof store.subscribe === "function") {
      try {
        const unsub = store.subscribe(event, schedule);
        if (typeof unsub === "function") subscriptions.push(unsub);
      } catch (error) {
        console.warn(`dataHub: failed subscribing to ${event}`, error);
      }
    }
  };

  [
    "state:changed",
    "blueprint:summary",
    "materialLabor:changed",
    "suppliers:changed",
    "costControl:changed",
    "reports:changed",
    "projects:changed"
  ].forEach(subscribe);

  window.addEventListener("storage", schedule);

  window.addEventListener("beforeunload", () => {
    subscriptions.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    window.removeEventListener("storage", schedule);
  });
})();
