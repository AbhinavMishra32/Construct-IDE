# Tauri migration (Electron → Tauri v2)

Construct's desktop shell moved from Electron to **Tauri v2**. The TypeScript
backend was **not** rewritten in Rust — it runs unchanged as a **Node.js
sidecar** that Tauri spawns. This keeps every backend capability (AI SDK /
Mastra agents, `node-pty` terminals, `node:sqlite` storage, LSP and LiteLLM
subprocesses, git) exactly as it was.

## Architecture

```text
┌────────────────────────── Tauri (Rust shell) ──────────────────────────┐
│  • Creates the native window (WRY webview)                              │
│  • Spawns the Node sidecar, reads its port + token from stdout          │
│  • Injects window.__CONSTRUCT_BRIDGE__ = { port, token } before load    │
│  • Official plugins: shell (sidecar), dialog, opener                    │
└─────────────────────────────────────────────────────────────────────────┘
        │ spawn (stdout: port+token)              ▲ webview loads Vite build
        ▼                                          │
┌──────────────── Node.js sidecar ────────────┐   │   ┌──── Renderer (React) ────┐
│  src/bridge/sidecar.ts                       │   │   │  src/renderer/**          │
│   → boots src/main/** (unchanged)            │   └───│  tauriBridge.ts installs  │
│  src/bridge/transport.ts                     │◄──────│  window.construct* over   │
│   → token-gated localhost WebSocket          │  ws   │  the WebSocket            │
│  src/bridge/electron-shim.ts                 │       └───────────────────────────┘
│   → "electron" alias: ipcMain / BrowserWindow│
│     / app / dialog / nativeTheme / shell     │
└──────────────────────────────────────────────┘
```

### Why a sidecar (not a Rust rewrite)

The backend is deep JS: Vercel AI SDK, `@mastra/core`, `better-auth`, Langfuse,
`node-pty`, `node:sqlite`. Porting it to Rust would be a rewrite, not a
migration, and would risk behavior changes. Tauri's [Node.js sidecar][sidecar]
pattern is the officially documented way to keep a Node backend. The renderer
talks to the sidecar directly over a localhost WebSocket, which cleanly carries
both request/response (invoke) and the app's many streaming events (terminal
data, agent logs, LSP notifications, code-ghost tokens).

### The Electron shim

`src/main/**` still imports `ipcMain`, `BrowserWindow`, `app`, `dialog`,
`nativeTheme`, `shell`, `nativeImage` from `"electron"`. At bundle time
(`tsup.sidecar.config.ts`) and for the type-checker (`tsconfig.json` `paths`),
`"electron"` resolves to `src/bridge/electron-shim.ts`:

- `ipcMain.handle/on` register handlers on the transport.
- `webContents.send` / `BrowserWindow.getAllWindows()` broadcast events to the
  connected renderer (single-window model → one virtual `webContents`).
- `app.getPath("userData")` returns the same per-OS path Electron used, so
  existing user data is picked up unchanged.
- `app` lifecycle (`whenReady`, `before-quit`) is driven by the sidecar entry
  and OS signals; `dialog`/`shell` are handled natively in the renderer.

### Bridge protocol

JSON over `ws://127.0.0.1:<port>/?token=<token>`:

| Direction | Message | Maps to |
| --- | --- | --- |
| renderer → sidecar | `{ k: "invoke", id, channel, args }` | `ipcMain.handle` |
| renderer → sidecar | `{ k: "send", channel, args }` | `ipcMain.on` |
| sidecar → renderer | `{ k: "result", id, ok, value/error }` | invoke reply |
| sidecar → renderer | `{ k: "event", channel, payload }` | `webContents.send` |

The token is generated per launch and injected by Rust, so no other local
process can attach to the bridge. Invokes that arrive before their handler is
registered wait briefly rather than failing, removing the startup race.

## Build & run

| Command | What it does |
| --- | --- |
| `pnpm --filter @construct/app dev` | `tauri dev`: Vite + sidecar build/stage + Rust shell |
| `pnpm --filter @construct/app build:sidecar` | Bundle the sidecar (`dist/sidecar.cjs`) |
| `pnpm --filter @construct/app sidecar:prepare` | Stage the Node runtime as the externalBin + copy the bundle to resources |
| `pnpm --filter @construct/app tauri:build` | Package the desktop installers |
| `pnpm --filter @construct/app bridge:smoke` | Boot the sidecar and round-trip an IPC call (no GUI) |

Packaging ships the Node runtime as a target-triple `externalBin`
(`binaries/construct-sidecar-<triple>`) and the bundled `sidecar.cjs` as a Tauri
resource; `native` modules (`node-pty`) load from the shipped `node_modules`.

## Platform notes

- **Window dragging**: the titlebar uses `-webkit-app-region: drag`, which Tauri
  v2 supports natively on macOS and Windows (the frameless platforms). Linux
  keeps native decorations, so the OS titlebar drags the window.
- **Window materials**: macOS sidebar vibrancy + hidden-inset traffic lights and
  Windows acrylic are applied in `src-tauri/src/lib.rs` via `window-vibrancy`,
  matching the former Electron chrome.
- **Requirements**: building the shell needs Rust + the Tauri v2 system
  dependencies (WebKitGTK on Linux). The JS `build`/`typecheck`/`test` tasks do
  not need Rust.

[sidecar]: https://v2.tauri.app/learn/sidecar-nodejs/
