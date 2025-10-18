const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const DEFAULT_LEVEL = (() => {
  const value = (window.localStorage && localStorage.getItem("app.log.level")) || "info";
  return LEVELS[value] ? value : "info";
})();

let currentLevel = DEFAULT_LEVEL;

function setLevel(level) {
  if (!LEVELS[level]) {
    console.warn("[logger] Invalid level supplied:", level);
    return;
  }
  currentLevel = level;
}

function shouldLog(level) {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function format(scope, level, args) {
  const time = new Date().toISOString();
  return [`[${time}] [${scope}] [${level.toUpperCase()}]`, ...args];
}

function createScope(scope = "app") {
  return {
    debug: (...args) => { if (shouldLog("debug")) console.debug(...format(scope, "debug", args)); },
    info: (...args) => { if (shouldLog("info")) console.info(...format(scope, "info", args)); },
    warn: (...args) => { if (shouldLog("warn")) console.warn(...format(scope, "warn", args)); },
    error: (...args) => { if (shouldLog("error")) console.error(...format(scope, "error", args)); }
  };
}

export default {
  LEVELS,
  setLevel,
  createScope
};
