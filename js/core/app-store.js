import Logger from "./logger.js";

const log = Logger.createScope("AppStore");

const STORAGE_KEY = "app.store.v1";

const DEFAULT_STATE = {
  shapesByPage: {},
  meta: {},
  projects: [],
  materialLabor: {
    currency: "USD",
    materials: [],
    labor: [],
    contractors: "",
    allocation: "",
    overheadPct: 10,
    profitPct: 12,
    taxPct: 8
  },
  costControl: { estimates: [], cos: [], actuals: [], committed: [] },
  reports: [],
  suppliers: [],
  settings: null,
  notifications: [],
  blueprintSummary: null
};

const clone = (obj) => JSON.parse(JSON.stringify(obj));

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return Object.assign(clone(DEFAULT_STATE), parsed);
  } catch (error) {
    log.warn("Falling back to default state due to load error", error);
    return clone(DEFAULT_STATE);
  }
}

function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    log.warn("Unable to persist AppStore state", error);
  }
}

class AppStore {
  constructor() {
    this.state = loadState();
    this.subscribers = new Map();
    window.addEventListener("storage", () => {
      this.state = loadState();
      this.publish("state:changed", this.getAll());
    });
  }

  getAll() {
    return clone(this.state);
  }

  setAll(next) {
    this.state = Object.assign(clone(DEFAULT_STATE), clone(next || {}));
    persist(this.state);
    this.publish("state:changed", this.getAll());
  }

  subscribe(event, handler) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event).add(handler);
    return () => {
      const group = this.subscribers.get(event);
      if (group) group.delete(handler);
    };
  }

  publish(event, payload) {
    const group = this.subscribers.get(event);
    if (!group || !group.size) return;
    for (const handler of Array.from(group)) {
      try {
        handler(payload);
      } catch (error) {
        log.error(`Subscriber for ${event} failed`, error);
      }
    }
  }

  /* ---------- Shapes / blueprint ---------- */
  getShapes(pageKey) {
    return clone(this.state.shapesByPage?.[pageKey] || []);
  }

  setShapes(pageKey, shapes) {
    if (!pageKey) return;
    this.state.shapesByPage = this.state.shapesByPage || {};
    this.state.shapesByPage[pageKey] = Array.isArray(shapes) ? clone(shapes) : [];
    persist(this.state);
    this.publish("shapes:changed", { pageKey, shapes: this.getShapes(pageKey) });
    this.publish("blueprint:summary", { summary: this.getBlueprintSummary() });
    this.publish("state:changed", this.getAll());
  }

  addShape(pageKey, shape) {
    const list = this.getShapes(pageKey);
    list.push(clone(shape));
    this.setShapes(pageKey, list);
  }

  removeShape(pageKey, id) {
    if (!pageKey || !id) return;
    const list = this.getShapes(pageKey).filter((s) => s.id !== id);
    this.setShapes(pageKey, list);
  }

  getMeta(key) {
    return clone(this.state.meta?.[key]);
  }

  setMeta(key, value) {
    this.state.meta = this.state.meta || {};
    this.state.meta[key] = clone(value);
    persist(this.state);
    this.publish("meta:changed", { key, value: clone(value) });
    this.publish("state:changed", this.getAll());
  }

  getBlueprintSummary() {
    return this.state.blueprintSummary ? clone(this.state.blueprintSummary) : null;
  }

  setBlueprintSummary(summary) {
    this.state.blueprintSummary = summary ? clone(summary) : null;
    persist(this.state);
    this.publish("blueprint:summary", { summary: this.getBlueprintSummary() });
    this.publish("state:changed", this.getAll());
  }

  /* ---------- Projects ---------- */
  getProjects() {
    return clone(this.state.projects);
  }

  setProjects(projects) {
    this.state.projects = Array.isArray(projects) ? clone(projects) : [];
    persist(this.state);
    this.publish("projects:changed", { projects: this.getProjects() });
    this.publish("state:changed", this.getAll());
  }

  upsertProject(project) {
    const list = this.getProjects();
    const idx = list.findIndex((p) => String(p.id) === String(project?.id));
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], project);
    else list.push(project);
    this.setProjects(list);
  }

  removeProject(id) {
    this.setProjects(this.getProjects().filter((p) => String(p.id) !== String(id)));
  }

  /* ---------- Material & Labor ---------- */
  getMaterialLabor() {
    return clone(this.state.materialLabor);
  }

  saveMaterialLabor(patch = {}) {
    this.state.materialLabor = Object.assign(clone(this.state.materialLabor), clone(patch));
    persist(this.state);
    this.publish("materialLabor:changed", { materialLabor: this.getMaterialLabor() });
    this.publish("state:changed", this.getAll());
  }

  /* ---------- Cost Control / Estimates ---------- */
  getCostControl() {
    return clone(this.state.costControl);
  }

  saveCostControl(patch = {}) {
    this.state.costControl = Object.assign(clone(this.state.costControl), clone(patch));
    persist(this.state);
    this.publish("costControl:changed", { costControl: this.getCostControl() });
    this.publish("state:changed", this.getAll());
  }

  saveEstimate(estimate) {
    const cost = this.getCostControl();
    const list = Array.isArray(cost.estimates) ? cost.estimates : [];
    const idx = list.findIndex((x) => String(x.id) === String(estimate?.id));
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], estimate);
    else list.push(estimate);
    this.saveCostControl({ ...cost, estimates: list });
  }

  removeEstimate(id) {
    const cost = this.getCostControl();
    const list = Array.isArray(cost.estimates) ? cost.estimates : [];
    this.saveCostControl({ ...cost, estimates: list.filter((e) => String(e.id) !== String(id)) });
  }

  saveChangeOrder(changeOrder) {
    const cost = this.getCostControl();
    const list = Array.isArray(cost.cos) ? cost.cos : [];
    const idx = list.findIndex((x) => String(x.id) === String(changeOrder?.id));
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], changeOrder);
    else list.push(changeOrder);
    this.saveCostControl({ ...cost, cos: list });
  }

  removeChangeOrder(id) {
    const cost = this.getCostControl();
    const list = Array.isArray(cost.cos) ? cost.cos : [];
    this.saveCostControl({ ...cost, cos: list.filter((co) => String(co.id) !== String(id)) });
  }

  /* ---------- Reports ---------- */
  getReports() {
    return clone(this.state.reports);
  }

  setReports(list) {
    this.state.reports = Array.isArray(list) ? clone(list) : [];
    persist(this.state);
    this.publish("reports:changed", { reports: this.getReports() });
    this.publish("state:changed", this.getAll());
  }

  upsertReport(report) {
    const list = this.getReports();
    const idx = list.findIndex((r) => String(r.id) === String(report?.id));
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], report);
    else list.push(report);
    this.setReports(list);
  }

  removeReport(id) {
    this.setReports(this.getReports().filter((r) => String(r.id) !== String(id)));
  }

  /* ---------- Suppliers ---------- */
  getSuppliers() {
    return clone(this.state.suppliers);
  }

  setSuppliers(list) {
    this.state.suppliers = Array.isArray(list) ? clone(list) : [];
    persist(this.state);
    this.publish("suppliers:changed", { suppliers: this.getSuppliers() });
    this.publish("state:changed", this.getAll());
  }

  upsertSupplier(row) {
    const list = this.getSuppliers();
    const idx = list.findIndex((x) => String(x.id) === String(row?.id));
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], row);
    else list.push(row);
    this.setSuppliers(list);
  }

  removeSupplier(id) {
    this.setSuppliers(this.getSuppliers().filter((r) => String(r.id) !== String(id)));
  }

  /* ---------- Settings / notifications ---------- */
  getSettings() {
    return this.state.settings ? clone(this.state.settings) : null;
  }

  saveSettings(patch) {
    this.state.settings = Object.assign({}, this.state.settings || {}, clone(patch || {}));
    persist(this.state);
    this.publish("settings:changed", { settings: this.getSettings() });
    this.publish("state:changed", this.getAll());
  }

  getNotifications() {
    return clone(this.state.notifications || []);
  }

  setNotifications(list) {
    this.state.notifications = Array.isArray(list) ? clone(list) : [];
    persist(this.state);
    this.publish("notifications:changed", { notifications: this.getNotifications() });
    this.publish("state:changed", this.getAll());
  }
}

const appStore = new AppStore();

if (!window.AppStore) {
  window.AppStore = appStore;
}

export default appStore;
export { appStore as AppStore };
