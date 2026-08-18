# Construct Runtime

Construct treats `.construct` files as executable project programs.

The runtime is still intentionally small:

- `compiler/` lexes, recovers, validates, repairs, previews patches, and builds a compact project view before runtime parsing.
- `lib/parser.ts` parses human-readable `.construct` source into a linear tape.
- `lib/projectStore.ts` bootstraps saved projects from real `.construct` source.
- `App.tsx` mounts the opaline app frame.
- `components/Workspace.tsx` coordinates files, tape progress, code-entry steps, and terminal commands.
- `components/EditorPane.tsx` owns the current guided code-entry mechanic.
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
tape-0.2 + concepts + legacy guide blocks + inline navigation + rich support + knowledge links + git milestones + authoring lint

tape-0.3.1:
tape-0.3 + canonical guide.* namespace + explicit file/docs/concept inline references

tape-0.4:
tape-0.3.1 + Construct Interact + reply recall + local-first learner memory + Knowledge Base storage

tape-0.4.1:
tape-0.4 + validated generated live learning steps and run provenance

tape-0.4.2:
tape-0.4.1 + agent-chosen scoped tools + source-labelled resources + concept engagement
```

The canonical 0.4 revision history lives in `docs/tape-changelog.md`. Current
Construct keeps `tape-0.4` and `tape-0.4.1` projects compatible while applying
the source-aware Interact runtime to them.

Tape 0.3.1 keeps each concern in a distinct language layer:

```text
Core execution:
  step, explain, edit, recall, run, expect, checkpoint

Knowledge:
  concept, reference

Guide:
  guide.orientation, guide.trace, guide.why-now, guide.preflight,
  guide.mental-model, guide.misconception, guide.analogy

Agent internals:
  verify, goal, evidence, rubric, messages

Milestones:
  git, suggest, include

Navigation:
  [[file:path|label]]
  [[file:path:24-42|label]]
  [[file:path#anchor|label]]
  [[concept:id|label]]
  [[docs:https://example.com|label]]
```

For backwards compatibility, `tape-0.3` projects may still use legacy guide
block names such as `::orientation`, `::problem`, `::mental-model`, and
`::why-now`, and obvious legacy file refs such as `[[src/a.ts|open file]]`.
The compiler accepts those forms and the runtime normalizes them internally.

`guide.*` blocks are learner-facing understanding blocks. Verifier contracts stay
nested under recall and are not rendered as ordinary Guide steps. `expect` is a
learner-facing manual expectation, never a replacement for verifier evidence.

Generated beginner tapes should normally declare:

```construct
@audience "zero-prerequisite"
@teaching "mental-model-first vertical-slice-first production-build"
```

Use natural engineering milestone titles. Authoring phrases such as “Reveal why”
or “Mental model before code” belong in `guide.*` content, not in step titles.

Steps may declare teaching order explicitly:

```construct
::step id="verify-client-data" title="Verify browser ceremony data" kind="concept-to-code" teaches="webauthn.client-data-json" requires="webauthn.ceremony security.challenge"
```

Canonical tape grammar lives in `compiler/grammar.ts`. The project creation flow
uses the tolerant compiler first, applies deterministic repairs, then invokes the
strict runtime parser as the final gate. Optional authoring review receives a
compact `ProjectView` and focused snippets; it does not rewrite entire tapes.

All runtime agents resolve provider, model, endpoint, runtime, and credentials
through the OS-backed Construct config service in `src/main/config/constructConfig.ts`.
The Settings surface reads and writes that live config; verifier, authoring,
Construct Interact, code help, and contextual explanation agents then share the
same model policy through `src/main/constructAgentModels.ts`.

The file tree, editor, and terminal all point at the same materialized project
workspace through the Electron project bridge.

The `tape-0.2` verifier is runtime-owned. A `.construct` file defines the goal,
rubric, evidence files, terminal command, and success/failure copy; the
Construct Verifier Agent reads that evidence and returns structured pass/fail
feedback without modifying files.
