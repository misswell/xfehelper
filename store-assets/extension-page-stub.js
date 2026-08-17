(() => {
  const manifest = {
    name: 'XFeHelper - JSON格式化、编解码、二维码、开发者工具箱',
    version: '2026.7.28',
    homepage_url: 'https://fehelper.com/'
  };
  const values = Object.create(null);
  const resolveGet = (keys) => {
    if (keys == null) return { ...values };
    if (typeof keys === 'string') return { [keys]: values[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, values[key]]));
    return Object.fromEntries(Object.keys(keys).map((key) => [key, values[key] ?? keys[key]]));
  };
  const callback = (fn, value) => {
    if (typeof fn === 'function') queueMicrotask(() => fn(value));
    return Promise.resolve(value);
  };
  const storage = {
    get(keys, fn) { return callback(fn, resolveGet(keys)); },
    set(items, fn) {
      Object.assign(values, items || {});
      return callback(fn);
    },
    remove(keys, fn) {
      for (const key of [].concat(keys || [])) delete values[key];
      return callback(fn);
    },
    clear(fn) {
      for (const key of Object.keys(values)) delete values[key];
      return callback(fn);
    }
  };
  const messageResult = (message) => {
    if (message?.thing === 'request-jsonformat-options') return { MAX_JSON_KEYS_NUMBER: 10000 };
    return {};
  };
  const runtime = {
    lastError: null,
    getManifest: () => manifest,
    getURL: (path) => new URL(path, `${location.origin}/`).href,
    sendMessage(message, fn) { return callback(fn, messageResult(message)); },
    onMessage: { addListener() {}, removeListener() {} },
    onInstalled: { addListener() {} },
    requestUpdateCheck: () => Promise.resolve({ status: 'no_update' }),
    reload() {}
  };
  window.chrome = {
    runtime,
    storage: { local: storage },
    commands: { getAll: (fn) => callback(fn, [{ name: '_execute_action', shortcut: 'Alt+Shift+J' }]) },
    tabs: { create: () => Promise.resolve() },
    notifications: { create: (id, options, fn) => callback(fn, id), clear: () => Promise.resolve() },
    contextMenus: { create: () => {}, update: () => {}, remove: () => Promise.resolve() },
    i18n: { getMessage: () => '' }
  };
})();
