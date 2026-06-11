# Construct

Construct is a project-based learning IDE. It turns real software projects into executable learning tapes: the app creates a workspace, guides each implementation step, checks recall, runs terminal tasks, and verifies what you built.

Website: [tryconstruct.cc](https://tryconstruct.cc)

Construct is early, but the repository now has one primary architecture: `.construct` tape files compiled into an Electron learning workspace.

## Why

Most learning tools stop at explanations. Most coding agents skip straight to answers.

Construct is built around the middle path: you build the project yourself, while the IDE keeps the learning path executable, contextual, and verifiable.

## What It Does

- Opens `.construct` files as project programs.
- Materializes the files described by a tape into a real workspace.
- Walks through explain, edit, recall, run, expect, checkpoint, and verify blocks.
- Provides Monaco editing, file navigation, terminal execution, and progress tracking.
- Stores project state locally through the Electron bridge.
- Uses agent-powered help for verification, authoring review, code ghosting, and selection explanations.

## Tape Specs

Construct keeps older tapes working as the format evolves.

- `tape-0.1`: files, linear steps, explain/edit/run/expect/checkpoint.
- `tape-0.2`: adds focus anchors, reference cards, supported recall, agent verification, and assistance tracking.
- `tape-0.3`: adds concept cards, rich support, git milestones, authoring lint, and legacy guide blocks.
- `tape-0.3.1`: canonicalizes the `guide.*` namespace and explicit inline refs such as `[[file:src/a.ts|open file]]`, `[[concept:id|label]]`, and `[[docs:https://example.com|docs]]`.

Backwards compatibility is part of the contract. `tape-0.3` projects can still use legacy guide names such as `::orientation`, `::problem`, `::mental-model`, and `::why-now`. Obvious legacy file refs such as `[[src/a.ts|open file]]` are also accepted.

## Repository

```text
app/                         Electron app and Construct IDE
app/src/renderer/construct/  Tape runtime, compiler, parser, and UI
opaline/packages/ui/         Local reusable UI package consumed by the app
website/                     Static marketing site for tryconstruct.cc
docs/                        Current engineering notes
```

The old runner, generated-blueprint sample project, Prisma persistence layer, and shared blueprint schema package have been removed. The active app is tape-based.

## Local Development

Requirements:

- Node.js 25+
- pnpm 10+

Install dependencies:

```bash
pnpm install
```

Run the desktop app:

```bash
pnpm --filter @construct/app dev
```

Run the static website locally:

```bash
python3 -m http.server 4174 --directory website
```

Useful checks:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

## App Architecture

The runtime lives in `app/src/renderer/construct`.

- `compiler/` lexes, validates, repairs, and previews `.construct` source.
- `lib/parser.ts` parses strict runtime tapes after compiler repair.
- `lib/projectStore.ts` persists local project records.
- `components/Workspace.tsx` coordinates files, tape progress, guidance, and terminal state.
- `components/EditorPane.tsx` owns guided code-entry behavior.
- `components/TerminalPanel.tsx` integrates xterm.js.
- `App.tsx` mounts the Opaline-based shell.

Agents live in `app/src/main/construct*Agent.ts` and are reached through the Electron bridge. They enhance the local tape workflow; they do not replace the tape runtime.

## Contributing

Keep changes tape-first and backwards-compatible:

- Add new spec behavior under a new patch version when syntax changes.
- Keep older tape versions parseable unless a migration is intentionally documented.
- Prefer deterministic compiler repairs for aliases and small authoring mistakes.
- Keep UI work inside the current Construct app or reusable Opaline package.
- Remove obsolete architecture instead of carrying parallel systems.

## License

License information is not finalized yet.
