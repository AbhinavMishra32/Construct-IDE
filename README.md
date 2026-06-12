<p align="center">
  <img src="app/assets/icon.png" alt="Construct app icon" width="140">
</p>

<h1 align="center">Construct</h1>

<p align="center">
  Build real software. Learn with intent.
</p>

<p align="center">
  <img alt="Release" src="https://img.shields.io/badge/version-0.2.0-111111?style=flat-square">
  <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-111111?style=flat-square">
  <img alt="Construct Protocols" src="https://img.shields.io/badge/protocols-tape--0.1_%7C_0.2_%7C_0.3_%7C_0.3.1_%7C_0.4-cb9b2d?style=flat-square">
  <img alt="Desktop" src="https://img.shields.io/badge/desktop-Electron-47848f?style=flat-square&logo=electron&logoColor=white">
  <img alt="Stars" src="https://img.shields.io/github/stars/AbhinavMishra32/Construct-IDE?style=flat-square">
</p>

<p align="center">
  <a href="https://tryconstruct.cc">Website</a> ·
  <a href="https://github.com/AbhinavMishra32/Construct-IDE/releases">Downloads</a>
</p>

Construct is a desktop IDE for executable learning tapes. Instead of watching a tutorial or handing the whole task to an agent, you work inside a real project while Construct sets up the workspace, guides each step, checks recall, runs terminal work, and verifies what you actually built.

<p align="center">
  <img src="app/assets/construct-app.png" alt="Construct IDE showing Agent Runtime Tool Contracts tape" width="100%">
</p>

## Why Construct

Most tools split in the wrong direction.

- Tutorials explain but do not stay with you while you build.
- Coding agents move fast but often collapse the learning loop.
- Editors give you raw power but no teaching structure.

Construct combines those layers into one runtime. A tape becomes a project you can execute, edit, verify, and remember.

## Why people use it

- **Learn by shipping**: every lesson lives inside a real codebase, terminal, and file tree.
- **Stay in the work**: guided edits, references, recall, and verification happen in the same app.
- **Keep your old tapes alive**: the parser and compiler stay backwards-compatible as the spec evolves.
- **Use agents where they help**: Construct Interact, verification, authoring review, inline help, and selection explanations are assistive, not a substitute for the tape runtime.
- **Remember what matters**: saved concepts, recall attempts, assistance, and learner state live in one local-first learning store.

## What Construct does

- Opens `.construct` programs and materializes them into real local workspaces.
- Walks explain, Construct Interact, edit, recall, run, expect, checkpoint, and verify blocks in order.
- Gives you Monaco editing, terminal execution, file navigation, and project progress in one shell.
- Supports Construct protocols `tape-0.1`, `tape-0.2`, `tape-0.3`, `tape-0.3.1`, and `tape-0.4`.
- Accepts older guide aliases and obvious legacy inline file references so past projects do not break.
- Stores Knowledge Base cards, Construct Interact sessions, recall attempts, assistance events, and sync metadata in a single local learning state.

## Downloads

Construct `0.2.0` is the next desktop release target. Public downloads ship through GitHub Releases when a release is cut.

- macOS: `.dmg`, `.zip`
- Windows: `nsis`, `portable`, `.zip`
- Linux: `AppImage`, `.deb`, `.tar.gz`

## Tape Compatibility

Backwards compatibility is part of the contract.

- `tape-0.1`: files, linear steps, explain/edit/run/expect/checkpoint
- `tape-0.2`: focus anchors, reference cards, supported recall, agent verification
- `tape-0.3`: concept cards, richer support, git milestones, authoring lint, legacy guide blocks
- `tape-0.3.1`: canonical `guide.*` namespace and explicit inline refs such as `[[file:src/a.ts|open file]]`
- `tape-0.4`: Construct Interact, reply recall, global learning memory, Knowledge Base storage, and adaptive overlay infrastructure

Legacy guide names like `::orientation`, `::problem`, `::mental-model`, and `::why-now` still work. Obvious older file refs like `[[src/a.ts|open file]]` still resolve.

`guide.*` blocks are deprecated for new authoring in `tape-0.4`. Construct still parses them for compatibility, but new tapes should use `::explain`, `::interact`, or `::recall mode="reply"` depending on the learning moment.

## Roadmap

- `0.2.0`: tape-0.4 support, Construct Interact, reply recall, local-first learner memory, Knowledge Base in the learning store, and a developer learner-context inspector.
- `0.3.x`: richer adaptive overlays, stronger authoring lint, more protocol migration helpers, and release automation hardening.
- Later: optional cloud sync for learning state, team authoring workflows, and expanded protocol examples.

## Local Development

Requirements:

- Node.js 25+
- pnpm 10+

Install everything:

```bash
pnpm install
```

Run the desktop app:

```bash
pnpm --filter @construct/app dev
```

Run the website:

```bash
pnpm --filter @construct/website dev
```

Check the repo:

```bash
pnpm typecheck
pnpm test
pnpm verify
```

## Repository

```text
app/                         Electron desktop app
app/src/renderer/construct/  Tape runtime, compiler, parser, and UI
opaline/packages/ui/         Shared UI package used by the app
website/                     Marketing site for tryconstruct.cc
docs/                        Release notes and engineering documentation
scripts/release/             Internal release tooling used by coding agents
```

The old pre-tape runner architecture is gone. The active product is the tape-based Construct IDE.

## License

License information is not finalized yet.
