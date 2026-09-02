import path from "node:path";

import { defineConfig } from "tsup";

/** Builds the only remaining Node process: the on-demand Mastra worker. */
export default defineConfig({
  entry: {
    "mastra-worker": "src/mastra-worker.ts"
  },
  platform: "node",
  target: "node22",
  format: ["cjs"],
  clean: false,
  dts: false,
  shims: true,
  outDir: "dist",
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
