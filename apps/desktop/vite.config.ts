import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import importMetaUrlPlugin from "@codingame/esbuild-import-meta-url-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
/* base must be relative. A packaged build is loaded over file://, where Vite's
   default absolute "/assets/..." resolves against the filesystem root instead of
   the app directory: every script and stylesheet 404s and the window comes up
   blank. Dev never shows it, because there the same paths are served over http. */
/* Vite treeshakes dynamic imports with a regular expression, and that regex
   cannot see past a `.then`. It reads

     const { applyStateStackDiff } = await import("x").then((n) => n.main)

   as if the destructuring applied to the module namespace, and rewrites the
   import to hand back only `{ applyStateStackDiff }` — so `.then` reads `.main`
   off an object that has no such key, and the awaited value is undefined. The
   editor's TextMate tokenizer is written in exactly that shape, in both the
   controller and its worker: the destructuring throws, background tokenization
   dies before it colours a single line, and every file renders as plain text.

   A comment between `await` and `import` stops the pattern matching and means
   nothing to JavaScript. https://github.com/vitejs/vite/issues/16545 */
const keepDynamicImportsWhole = {
  name: "construct:keep-dynamic-imports-whole",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.includes("node_modules") || !code.includes("await import(")) return null;
    const patched = code.replace(/=\s*await\s+import\([^()]*\)\s*\.then\(/g, (match) =>
      match.replace(/await\s+import\(/, "await /* not a namespace destructuring */ import("),
    );
    return patched === code ? null : { code: patched, map: null };
  },
};

export default defineConfig({
  base: "./",
  root: "src/renderer",
  plugins: [keepDynamicImportsWhole, react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(root, "src/renderer") } },
  /* The editor platform's workers import each other, so they are code-split —
     and a code-split bundle cannot be IIFE, which is Vite's default for
     workers. */
  worker: { format: "es" },
  /* Top-level await, in `main.tsx`: the editor services come up before React
     does. Both the dev pre-bundle and the build have to allow it, and the
     defaults for neither do. */
  esbuild: { target: "esnext" },
  /* Dev only, and not optional there.
     
     The editor platform locates its own assets with `new URL(..., import.meta.url)`
     — the oniguruma WASM that TextMate tokenizes with, every grammar and theme
     an extension contributes, the editor's workers. Vite pre-bundles those
     packages with esbuild before serving them, and esbuild rewrites the module
     out from under those URLs: the WASM request came back as index.html, every
     extension resource 404'd, and the worker URL picked up its query string
     twice. Highlighting was the visible half — no oniguruma, no tokens, white
     text — and it only ever failed in dev, because the production build does
     no pre-bundling. This plugin rewrites those URLs to ones that resolve. */
  optimizeDeps: {
    /* Left out of the pre-bundle entirely, because the plugin above cannot read
       it: tree-sitter writes `new URL("web-tree-sitter.wasm", import.meta.url)`
       with no leading `./`, and a bare specifier is a package name as far as
       the resolver is concerned — so it looks for a package called
       `web-tree-sitter.wasm` and the whole optimize step fails. Served from
       node_modules as it stands, the relative URL resolves against the real
       file and needs no rewriting at all. */
    exclude: ["web-tree-sitter"],
    esbuildOptions: { target: "esnext", plugins: [importMetaUrlPlugin] },
  },
  build: { outDir: "../../dist/renderer", emptyOutDir: true, target: "esnext" },
  server: { port: 5173, strictPort: true },
});
