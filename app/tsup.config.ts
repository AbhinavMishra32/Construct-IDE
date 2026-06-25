import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/main/index.ts",
    preload: "src/preload/index.ts"
  },
  platform: "node",
  target: "node22",
  external: ["electron", "node:sqlite"],
  format: ["cjs"],
  clean: true,
  dts: false,
  shims: true,
  outDir: "dist",
  outExtension() {
    return {
      js: ".cjs"
    };
  }
});
