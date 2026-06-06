# Open Shell Readable Library

This folder is the readable shared UI library used by `@open-shell/ui`.

It is rebuilt from the component research and literal upstream extraction in `research/codex-internals/src/component-library`, but it does not import bundled upstream React components directly. The upstream bundled components carry their own compiled React runtime, so mixing them with this app's React runtime causes a blank renderer.

Use this layer for the copy app:

- `AppShell` for the native Electron-style Codex frame
- `Sidebar` for navigation, project/thread rows, and footer status
- `ThreadSurface` for static conversation/workspace content
- `Composer` for the Codex prompt dock
- `BottomPanel` and `TerminalSurface` for the app-shell bottom panel and terminal tab system
- `FileTree` for the filesystem tree DOM contract and core icon sprite
- `FileBrowserPanel` for the right-side file/editor panel using the shared `FileTree`
- `Dialog` and `DialogContent` for the shared popup/dialog primitive
- `Button`, `IconButton`, `Pill`, and `StatusDot` for shared controls
- `codex-theme.css` for Codex-like tokens and upstream-compatible CSS aliases

Sidebar transparency requirement:

- `examples/electron-shell/src/main/library-main.cjs` enables a transparent Electron window.
- `examples/electron-shell/src/renderer/main.tsx` sets `data-codex-window-type="electron"` and `data-codex-os`.
- `app-shell.css` keeps the main app pane opaque.
- `Sidebar.tsx` marks the sidebar with `app-shell-left-panel`.
- `sidebar.css` mirrors the upstream 55% transparent `color-token-editor-background` rule and edge `:after` extension.
- `sidebar.css` also applies the upstream medium blur amount as `backdrop-filter: blur(var(--blur-md))`; `codex-theme.css` preserves `--blur-md: 12px`.
- `sidebar/appActionAttributes.ts` preserves the upstream `data-app-action-sidebar-*` attributes used by sidebar project/thread automation and selection logic.

Readable port evidence:

- `primitives/Dialog.tsx` ports Codex dialog wrapper behavior from `dialog-layout-CCvvb1Vc.js` onto `@radix-ui/react-dialog`.
- `bottom-panel/BottomPanel.tsx` ports app-shell bottom panel constants from `app-shell-D7yvB1FT.js`: default `280`, min `160`, max half of main area.
- `file-tree/FileTree.tsx` ports the upstream filesystem tree data attributes, flex row lanes, selected state, `Filter files…` search wrapper, and base icon sprite from `file-tree-search-input-DWq_lg9v.js`.
- `file-browser/FileBrowserPanel.tsx` ports the right-panel file browser shape from `RightPanelOutlet`/`RightPanelTabs` usage in `thread-app-shell-chrome-BjerXYKb.js`.
- `app-shell/AppShell.tsx` ports the header tab-controller shape from `app-shell-D7yvB1FT.js` and the thread overflow action set from `thread-actions-DlCTuMux.js` / `local-conversation-thread-CRSaT3IN.js`.
- `thread/ThreadSurface.tsx` ports the readable static version of the Codex conversation rhythm: assistant activity rows, user bubble, and edited-files review card.

Use `research/codex-internals/src/component-library` as the literal source/reference catalog:

- `original/assets` contains copied upstream renderer files
- `component-system.json` maps systems, entry files, and export aliases
- `styles/index.js` imports copied upstream global/feature CSS
