import path from "node:path";

import { defineConfig } from "tsup";

/**
 * Builds the Node.js sidecar that Tauri spawns. The existing Electron main
 * process is bundled as-is, with `"electron"` aliased to the transport-backed
 * shim so no main-process source needs to change. Native / builtin modules are
 * kept external and resolved from the shipped node_modules at runtime.
 */
export default defineConfig({
  entry: {
    sidecar: "src/bridge/sidecar.ts",
    "mastra-worker": "src/mastra-worker.ts"
  },
  platform: "node",
  target: "node22",
  format: ["cjs"],
  clean: false,
  dts: false,
  shims: true,
  outDir: "dist",
  // node-pty ships a native addon; node:sqlite is a Node builtin. Keep both
  // external so the prebuilt binaries load from node_modules at runtime.
  external: ["node-pty", "node:sqlite"],
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      electron: path.resolve(__dirname, "src/bridge/electron-shim.ts")
    };
  },
  outExtension() {
    return { js: ".cjs" };
  }
});
