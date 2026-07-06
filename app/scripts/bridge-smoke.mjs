// Boots the Node sidecar and exercises the bridge without a GUI:
//   1. reads the port + token the sidecar prints,
//   2. connects over the token-gated WebSocket,
//   3. round-trips real IPC channels (settings + project list),
//   4. asserts an unauthorized token is rejected.
// Exits 0 on success, 1 on failure. Run via `pnpm bridge:smoke`.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { WebSocket } = require(join(appDir, "node_modules/ws"));

const sidecar = join(appDir, "dist", "sidecar.cjs");
const child = spawn(process.execPath, [sidecar], {
  cwd: appDir,
  env: { ...process.env, CONSTRUCT_APP_PATH: appDir }
});

let done = false;
function finish(code, message) {
  if (done) return;
  done = true;
  if (message) console[code === 0 ? "log" : "error"](message);
  child.kill();
  process.exit(code);
}

const timer = setTimeout(() => finish(1, "bridge-smoke: timed out"), 20_000);
timer.unref?.();

let buffer = "";
let connected = false;
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const port = buffer.match(/CONSTRUCT_BRIDGE_PORT=(\d+)/)?.[1];
  const token = buffer.match(/CONSTRUCT_BRIDGE_TOKEN=([\w-]+)/)?.[1];
  if (port && token && !connected) {
    connected = true;
    run(Number(port), token);
  }
});
child.stderr.on("data", (chunk) => process.stderr.write(`[sidecar] ${chunk}`));
child.on("exit", (code) => finish(code === 0 ? 0 : 1, `sidecar exited early (${code})`));

function run(port, token) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
  const pending = new Map();
  let nextId = 1;
  const invoke = (channel, ...args) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      socket.send(JSON.stringify({ k: "invoke", id, channel, args }));
    });

  socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.k !== "result") return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.ok ? p.res(msg.value) : p.rej(new Error(msg.error?.message));
  });
  socket.on("error", (err) => finish(1, `bridge-smoke: socket error: ${err.message}`));

  socket.on("open", async () => {
    try {
      const settings = await invoke("construct:settings:get");
      if (!settings?.workspaceRoot) throw new Error("settings:get returned no workspaceRoot");
      const projects = await invoke("construct:project:list");
      if (!Array.isArray(projects)) throw new Error("project:list did not return an array");

      // The server completes the WS handshake and then closes bad tokens with
      // 1008, so only the close code is meaningful here.
      const bad = new WebSocket(`ws://127.0.0.1:${port}/?token=nope`);
      let settled = false;
      bad.on("close", (code) => {
        settled = true;
        if (code !== 1008) return finish(1, `unauthorized connection not rejected (code ${code})`);
        console.log("bridge-smoke: OK (settings + project list round-tripped, unauthorized rejected)");
        finish(0);
      });
      setTimeout(() => {
        if (!settled) finish(1, "unauthorized connection was not closed");
      }, 3000).unref?.();
    } catch (err) {
      finish(1, `bridge-smoke: ${err.message}`);
    }
  });
}
