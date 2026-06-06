# Construct Runtime

Construct treats `.construct` files as executable project programs.

The runtime is intentionally small:

- `lib/parser.ts` parses human-readable `.construct` source into a linear tape.
- `lib/projectStore.ts` bootstraps saved projects from real `.construct` source.
- `App.tsx` mounts the open-shell app frame.
- `components/Workspace.tsx` coordinates files, tape progress, ghost edits, and terminal commands.
- `components/EditorPane.tsx` owns the current ghost-typing mechanic.
- `components/TerminalPanel.tsx` adapts xterm.js into open-shell's bottom panel.

The app owns the learning flow. The agent should later generate compact
`.construct` files, not drive the project experience directly.

MVP tape shape:

```text
explain -> edit -> run -> expect -> checkpoint
```

The file tree, editor, and terminal all point at the same materialized project
workspace through the Electron project bridge.
