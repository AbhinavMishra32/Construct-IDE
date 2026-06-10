# Construct Runtime

Construct treats `.construct` files as executable project programs.

The runtime is still intentionally small:

- `compiler/` lexes, recovers, validates, repairs, previews patches, and builds a compact project view before runtime parsing.
- `lib/parser.ts` parses human-readable `.construct` source into a linear tape.
- `lib/projectStore.ts` bootstraps saved projects from real `.construct` source.
- `App.tsx` mounts the opaline app frame.
- `components/Workspace.tsx` coordinates files, tape progress, ghost edits, and terminal commands.
- `components/EditorPane.tsx` owns the current ghost-typing mechanic.
- `components/TerminalPanel.tsx` adapts xterm.js into opaline's bottom panel.

The app owns the learning flow. The agent should later generate compact
`.construct` files, not drive the project experience directly.

Protocol specs:

```text
tape-0.1:
files -> linear steps -> explain/edit/run/expect/checkpoint

tape-0.2:
tape-0.1 + focus anchors + reference cards + supported recall + agent verification + assistance tracking

tape-0.3:
tape-0.2 + concepts + rich support + knowledge links + git milestones + authoring lint
```

Canonical tape grammar lives in `compiler/grammar.ts`. The project creation flow
uses the tolerant compiler first, applies deterministic repairs, then invokes the
strict runtime parser as the final gate. Optional authoring review receives a
compact `ProjectView` and focused snippets; it does not rewrite entire tapes.

The file tree, editor, and terminal all point at the same materialized project
workspace through the Electron project bridge.

The `tape-0.2` verifier is runtime-owned. A `.construct` file defines the goal,
rubric, evidence files, terminal command, and success/failure copy; the
Construct Verifier Agent reads that evidence and returns structured pass/fail
feedback without modifying files.
