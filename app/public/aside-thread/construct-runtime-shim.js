// Host adapter for the vendored production thread application. Its private
// daemon boundary is mapped onto Construct's parent renderer; the only bundle
// patches are the nested asset resolver and Construct-specific tool renderers.
window.__ASIDE_VITE_FIXTURE__ = true;
window.__ASIDE_LOCAL_RUNTIME__ = true;
window.__ASIDE_VITE_FIXTURE_MESSAGES_ENABLED__ = false;

const CHANNEL = "construct-aside-bridge:v1";
const frameId = crypto.randomUUID();
const pendingRequests = new Map();
const sockets = new Map();

window.__asideFixtureErrors = [];
window.__constructAsideBridgeLog = [];
const nativeConsoleError = console.error.bind(console);
console.error = (...args) => {
  window.__asideFixtureErrors.push(args.map((value) => value?.stack || value?.message || String(value)).join("\n"));
  nativeConsoleError(...args);
};
window.addEventListener("error", (event) => window.__asideFixtureErrors.push(event.error?.stack || event.message));
window.addEventListener("unhandledrejection", (event) => window.__asideFixtureErrors.push(event.reason?.stack || String(event.reason)));

function post(type, payload = {}, requestId) {
  window.parent.postMessage({ channel: CHANNEL, frameId, type, requestId, payload }, "*");
}

window.__CONSTRUCT_ASIDE_ACTION__ = (action, payload = {}) => post("action", { action, ...payload });

function request(type, payload) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Construct thread bridge timed out: ${type}`));
    }, 30_000);
    pendingRequests.set(requestId, { resolve, reject, timeout });
    post(type, payload, requestId);
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.channel !== CHANNEL || message.frameId !== frameId) return;

  if (message.type === "response" && message.requestId) {
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    pendingRequests.delete(message.requestId);
    window.clearTimeout(pending.timeout);
    if (message.payload?.ok === false) pending.reject(new Error(message.payload.error || "Construct thread bridge request failed"));
    else pending.resolve(message.payload?.value);
    return;
  }

  if (message.type === "theme") {
    const dark = message.payload?.theme === "dark";
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    return;
  }

  if (message.type === "ws-open") {
    sockets.get(message.payload?.socketId)?.open(message.payload?.sessionId);
    return;
  }

  if (message.type === "ws-message") {
    sockets.get(message.payload?.socketId)?.receive(message.payload?.data);
    return;
  }

  if (message.type === "ws-error") {
    sockets.get(message.payload?.socketId)?.fail(message.payload?.message);
    return;
  }

  if (message.type === "ws-close") {
    sockets.get(message.payload?.socketId)?.finish(message.payload?.code, message.payload?.reason);
  }
});

const storageListeners = new Set();
const chromeEvent = () => {
  const listeners = new Set();
  return {
    addListener: (callback) => listeners.add(callback),
    removeListener: (callback) => listeners.delete(callback),
    hasListener: (callback) => listeners.has(callback),
  };
};
const storage = {
  async get(keys) {
    const values = Object.fromEntries(Object.keys(localStorage)
      .filter((key) => key.startsWith("construct.aside."))
      .map((key) => [key.slice("construct.aside.".length), JSON.parse(localStorage.getItem(key))]));
    if (keys == null) return values;
    if (typeof keys === "string") return { [keys]: values[keys] };
    return Object.fromEntries((Array.isArray(keys) ? keys : Object.keys(keys)).map((key) => [key, values[key] ?? keys[key]]));
  },
  async set(values) {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(`construct.aside.${key}`, JSON.stringify(value));
    const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }]));
    for (const listener of storageListeners) listener(changes, "local");
  },
  async remove(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) localStorage.removeItem(`construct.aside.${key}`);
  },
};

window.chrome ??= {};
Object.assign(window.chrome, {
  extension: { inIncognitoContext: false },
  runtime: {
    getURL: (path = "") => new URL(path, new URL("./", location.href)).href,
    lastError: undefined,
    onMessage: chromeEvent(),
  },
  storage: {
    local: storage,
    onChanged: {
      addListener: (listener) => storageListeners.add(listener),
      removeListener: (listener) => storageListeners.delete(listener),
    },
  },
  tabs: {
    query: async () => [],
    get: async () => null,
    create: ({ url }) => {
      post("open-external", { url });
      return null;
    },
  },
  asideAccount: {
    getProfileContext: async () => ({
      profileId: "construct",
      profileIndex: 0,
      profilePath: "construct",
      boundAccountId: 1,
      boundUserId: 1,
    }),
    signDaemonAuthChallenge: async () => ({ signedChallenge: new Uint8Array([99, 111, 110, 115, 116, 114, 117, 99, 116]) }),
  },
});

function unwrapInput(value) {
  return value && typeof value === "object" && "json" in value ? value.json : value ?? {};
}

async function inputsFor(url, init, count) {
  let raw = url.searchParams.get("input");
  if ((init?.method || "GET").toUpperCase() === "POST") raw = typeof init?.body === "string" ? init.body : null;
  if (!raw) return Array.from({ length: count }, () => ({}));
  const parsed = JSON.parse(raw);
  if (count === 1 && !("0" in parsed)) return [unwrapInput(parsed)];
  return Array.from({ length: count }, (_, index) => unwrapInput(parsed[index]));
}

const nativeFetch = globalThis.fetch.bind(globalThis);
const constructFetch = async (input, init) => {
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(requestUrl, location.href);
  if (url.host !== "127.0.0.1:21420") return nativeFetch(input, init);

  if (url.pathname === "/auth/daemon/challenge") {
    return Response.json({ challenge: "Y29uc3RydWN0", challengeId: "construct" });
  }
  if (url.pathname === "/auth/daemon/session") {
    return Response.json({ access_token: "construct", expiresInSeconds: 86_400 });
  }
  if (url.pathname === "/auth/daemon/verify") return Response.json({ ok: true });

  if (!url.pathname.startsWith("/trpc/")) return new Response(null, { status: 404 });

  const paths = url.pathname.slice("/trpc/".length).split(",");
  try {
    const inputs = await inputsFor(url, init, paths.length);
    const values = await request("rpc", { paths, inputs });
    window.__constructAsideBridgeLog.push({ paths, inputs, values });
    // This extracted client does not install tRPC's superjson transformer. Its
    // query cache consumes result.data directly, so wrapping the value in a
    // `json` property would leak the transport envelope into every component.
    return Response.json(paths.map((_, index) => ({ result: { data: values[index] } })));
  } catch (error) {
    return Response.json({ error: { json: { message: error instanceof Error ? error.message : String(error), code: -32603 } } }, { status: 500 });
  }
};
globalThis.fetch = constructFetch;
window.fetch = constructFetch;

const NativeWebSocket = window.WebSocket;
class ConstructWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(value, protocols) {
    super();
    const url = new URL(value, location.href);
    if (url.host !== "127.0.0.1:21420") return new NativeWebSocket(value, protocols);
    this.socketId = crypto.randomUUID();
    this.url = url.href;
    this.protocol = "";
    this.extensions = "";
    this.binaryType = "blob";
    this.bufferedAmount = 0;
    this.readyState = ConstructWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    sockets.set(this.socketId, this);
    post("ws-connect", { socketId: this.socketId, url: this.url, protocols });
  }

  emit(type, event) {
    super.dispatchEvent(event);
    const handler = this[`on${type}`];
    if (typeof handler === "function") handler.call(this, event);
  }

  open(sessionId) {
    if (this.readyState !== ConstructWebSocket.CONNECTING) return;
    this.readyState = ConstructWebSocket.OPEN;
    this.emit("open", new Event("open"));
    this.receive(JSON.stringify({ op: "ready", protocolVersion: 1, sessionId }));
  }

  receive(data) {
    if (this.readyState !== ConstructWebSocket.OPEN) return;
    this.emit("message", new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data) }));
  }

  fail(message) {
    const error = new Event("error");
    error.message = message || "Construct thread bridge failed";
    this.emit("error", error);
  }

  finish(code = 1000, reason = "") {
    if (this.readyState === ConstructWebSocket.CLOSED) return;
    this.readyState = ConstructWebSocket.CLOSED;
    sockets.delete(this.socketId);
    this.emit("close", new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
  }

  send(data) {
    if (this.readyState !== ConstructWebSocket.OPEN) throw new DOMException("WebSocket is not open", "InvalidStateError");
    post("ws-send", { socketId: this.socketId, data: typeof data === "string" ? data : String(data) });
  }

  close(code = 1000, reason = "") {
    if (this.readyState === ConstructWebSocket.CLOSED || this.readyState === ConstructWebSocket.CLOSING) return;
    this.readyState = ConstructWebSocket.CLOSING;
    post("ws-disconnect", { socketId: this.socketId, code, reason });
    this.finish(code, reason);
  }
}
for (const [key, value] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) {
  Object.defineProperty(ConstructWebSocket.prototype, key, { value });
}
window.WebSocket = ConstructWebSocket;

post("ready", { href: location.href });
