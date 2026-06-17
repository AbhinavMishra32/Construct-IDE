<p align="center">
  <img src="app/assets/icon.png" alt="Construct" width="120">
</p>

<h1 align="center">Construct</h1>

<p align="center">
  <b>An IDE that teaches you to build.</b><br>
  AI-native workspace where a coding mentor lives beside your editor,
  <br>understands what you are learning, and helps you build real projects.
</p>

<p align="center">
  <a href="https://tryconstruct.cc"><b>Website</b></a> ·
  <a href="https://github.com/AbhinavMishra32/Construct-IDE/releases/latest"><b>Download</b></a> ·
  <a href="docs/construct-flow-projects-implementation-brief.md"><b>Flow Projects Spec</b></a> ·
  <a href="docs/tape-changelog.md"><b>Tape Changelog</b></a>
</p>

<p align="center">
  <img alt="Release" src="https://img.shields.io/badge/version-0.2.1-000000?style=flat-square">
  <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-000000?style=flat-square">
  <img alt="Desktop" src="https://img.shields.io/badge/desktop-Electron-47848f?style=flat-square&logo=electron&logoColor=white">
  <img alt="Stars" src="https://img.shields.io/github/stars/AbhinavMishra32/Construct-IDE?style=flat-square&color=000000">
</p>

---

## What is Construct?

Construct is an **AI-native desktop IDE** built for one reason: to help you learn by building real software.

Unlike coding assistants that hand you solutions, Construct works like a great human mentor. It sits beside your editor, inspects your workspace, understands what you are building, and guides you through the decisions that matter. You write the code. Construct helps you *understand* why it works.

Construct has two project kinds:

- **Flow Projects** – natural, agent-guided coding workspace (the primary way to use Construct)
- **Tapes** – authored, step-by-step lessons (legacy format, secondary)

---

## Flow Projects

Flow is Construct's flagship project kind: a **loose, natural, tool-call-native coding mentor workspace**. There is no rigid lesson engine, no step counter, no scripted sequence. The agent behaves like a senior engineer pair-programming with you.

When you create a Flow project, **two AI agents** work in your corner:

### Flow Research Agent

Runs once at project creation. It researches your project's domain and technology stack — web search, source reading, terminology, common libraries, caveats. It saves everything into `research.md` so the main mentor is never flying blind.

It does not teach, modify code, or create a plan. It just makes sure the context is set.

### Main Flow Agent

The primary coding mentor. It has real workspace powers:

- **Inspect files** – read, search, list, navigate any file in the project
- **Run terminal commands** – execute tests, builds, linters, whatever the project needs
- **Create practice tasks** – scaffold real code, capture a baseline, wait for you to attempt it, then receive a compact diff to review together
- **Focus your editor** – open files and highlight exact ranges so you never hunt for the right line
- **Run terminal commands** – test, build, lint, debug
- **Ask questions** – interactive clarification when a decision is needed
- **Internet search** – look up APIs, docs, libraries in real time
- **LSP & static analysis** – work with your language server for type-aware guidance

The system prompt is short and deliberate:

> *"You are not a code vending machine. Your job is to help the learner become capable of writing and understanding the project themselves. Prefer learner attempts. When the next step is a coding attempt, use the practice-task tool to prepare a real place in the workspace."*

### Flow Memory

Flow projects persist durable context in four markdown files, visible and editable from the settings tab:

| File | What it holds |
|------|--------------|
| `research.md` | Project/domain/technology background. Created by the Research Agent. |
| `project.md` | Durable identity: stack, architecture decisions, important files, commands, conventions. |
| `path.md` | Current direction: what you are working on, recently done, what comes next, blockers. |
| `learner.md` | Your understanding: known concepts, weak spots, help level, learning evidence. |

The agent reads and writes these files as you work, so context survives across sessions. Close the app, come back tomorrow — the agent remembers where you left off and what you already understand.

### Practice Tasks

The most important learning tool in Flow. When the agent wants you to write code:

1. It scaffolds the task in real project files (or tells you where to work)
2. It captures a **baseline** snapshot of the relevant files
3. It hands you the workspace and waits
4. You write code, run tests, iterate
5. When you submit, the agent receives a **compact diff** — exactly what changed, nothing more
6. It reviews your work, gives feedback, and updates Flow Memory

This is the core learning loop: **attempt → diff → feedback → improve**. No copy-pasting solutions. No "watch me code" videos. You build it.

---

## Tapes

Tapes are Construct's original project format: **authored, deterministic lessons** written in a custom DSL (`.construct` files). A tape specifies workspace files, learning steps, concept cards, verification checkpoints, and git milestones.

Tapes are still fully supported and continue to receive compatibility guarantees. But the focus of active development is Flow Projects.

Construct `0.2.1` supports every tape revision from `tape-0.1` through `tape-0.4.2`.

| Revision | Adds |
|----------|------|
| `tape-0.1` | Files, linear steps, explain, edit, run, expect, checkpoint |
| `tape-0.2` | Focus anchors, references, supported recall, agent verification |
| `tape-0.3` | Concept cards, richer support, git milestones, authoring lint |
| `tape-0.3.1` | Canonical `guide.*` names and explicit inline references |
| `tape-0.4` | Construct Interact, reply recall, learner memory, Knowledge Base |
| `tape-0.4.1` | Validated generated live steps, actions, and run provenance |
| `tape-0.4.2` | Agent-chosen tools, source-labelled resources, concept engagement, durable agent traces |

---

## AI Providers

Construct is provider-agnostic. Configure your preferred LLM backend in Settings and every agent feature uses it.

### Supported providers

| Provider | Key | Default model |
|----------|-----|---------------|
| **OpenAI** | `openai` | `gpt-5-mini` |
| **OpenRouter** | `openrouter` | `deepseek/deepseek-v4-flash` |
| **OpenCode Zen** | `opencode-zen` | `gpt-5.1-codex` |
| **GitHub Copilot** | `github-copilot` | `github_copilot/gpt-4` |
| **LiteLLM** | `litellm` | `openai/gpt-5-mini` |

Each provider stores its own API key, model selection, and base URL independently. Switch between them at any time without losing configuration.

**OpenAI-compatible endpoints** — set a custom base URL for any provider (including self-hosted or proxy-compatible backends). The default for OpenAI is `https://api.openai.com/v1`, for OpenRouter it is `https://openrouter.ai/api/v1`.

### Agent runtimes

Construct supports two agent runtimes, selectable in Settings:

- **Mastra** — the default runtime. Used for all agent features unless changed.
- **Fxpnt** — an alternative agent runtime.

### Per-feature model routing

Every agent feature can use a **different model**. Configure a global default for the provider, then override per feature:

| Feature ID | What it powers |
|------------|---------------|
| `construct-flow` | Flow Projects — open-ended coding mentor |
| `construct-interact` | Tape project conversational understanding checks |
| `verification` | Checks learner code against tape rubric and evidence |
| `selection-explain` | Explains highlighted code in project context |
| `code-explain` | Inline code help while you read or edit |
| `authoring-review` | Suggests tape structure and teaching improvements |

Model resolution follows this chain (first match wins):

1. **Feature-specific override** — model saved for that exact feature ID
2. **Global provider model** — the model field on the selected provider
3. **Built-in default** — the hardcoded default for that provider + feature combination

This means you can run Flow on a powerful model like `deepseek/deepseek-v4-flash`, route `selection-explain` to a cheaper model like `gpt-5-mini`, and keep `verification` on the global default — all from the same Settings panel.

### Observability

Construct supports **OpenInference / Phoenix** tracing for agent observability. Enable it in Settings to capture agent runs, tool calls, and LLM interactions for debugging and analysis.

### Privacy

All API keys, credentials, and learning state are stored **locally** in the Construct config file on your machine. No telemetry, no external logging, no data exfiltration. The only outbound calls are the LLM API requests you configure.

---

## Download

Get the latest installers from [GitHub Releases](https://github.com/AbhinavMishra32/Construct-IDE/releases/latest).

- **macOS**: `.dmg` and `.zip`
- **Windows**: Installer, portable executable, `.zip`
- **Linux**: `AppImage`, `.deb`, `.tar.gz`

---

## Build from Source

**Requirements**

- Node.js 25+
- pnpm 10+

```bash
pnpm install
pnpm --filter @construct/app dev
```

Run repository checks:

```bash
pnpm verify
```

---

## Repository Map

```
app/                         Desktop app (Electron + React + TypeScript)
app/src/main/                Main process — agents, services, IPC, tools
app/src/main/flow/           Flow agent service, Flow Memory service
app/src/main/agent-tools/    Agent tool implementations (Flow protocol + tape)
app/src/renderer/            Renderer — workspace UI, compiler, components
app/src/renderer/construct/  Tape runtime, compiler, Flow workspace, dashboard
opaline/packages/ui/         Shared desktop UI components
website/                     tryconstruct.cc
docs/                        Flow Projects spec, tape changelog, design docs
```

---

## License

License information is not finalized yet.
