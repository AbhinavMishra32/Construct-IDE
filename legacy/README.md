# Legacy trees

Code in this directory is **archived reference only**. It is excluded from the
pnpm workspace, from Turbo's task graph, and from TypeScript project references.
Nothing here is built, tested, or importable from the live application.

## `v0.7/`

Construct v0.7-alpha — the Tauri-era tree that Construct 1.0 replaces.

Kept so the 1.0 rebuild can check behaviour against the implementation it is
porting: the Flow agent prompt and tools, the concept/learning policy, project
and git services, and the `node:sqlite` storage layer all originate here.

The same tree is recoverable from git at either tag:

- `v0.7-alpha` — the last release cut from this tree
- `archive/v0.7` — the commit immediately before the 1.0 restructure

### What 1.0 takes from it

| Area | Disposition |
| --- | --- |
| Flow agent (prompt, tool schemas) | Ported verbatim |
| Concept / learning policy | Ported |
| Projects, git, workspace services | Ported |
| `node:sqlite` storage | Ported |
| Terminal (xterm + node-pty) | Ported |
| Code ghost, selection explain | Ported as small features |
| Verifier, authoring review | Dropped |
| Tape system | Dropped |
| LiteLLM / AIGateway | Dropped — replaced by Pi |
| Tauri shell (`src-tauri`) | Dropped — Electron only |
| Renderer UI, opaline | Dropped — replaced by the Spar-derived shell |
