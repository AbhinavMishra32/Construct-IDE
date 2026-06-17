# Construct Flow Socratic Agent Brief

Date: 2026-06-17

This brief captures the next Flow requirements from user feedback on concept editing, Flow Memory, research, question UI, and task workflows.

## Core Problem

Construct Flow cannot treat memory and concepts as generic notes. If the agent upgrades a concept to a confidence such as "emerging", the tool must record exactly why. If the agent edits code or scaffolds files, the resulting task and review flow must make authorship clear so the agent does not confuse agent-written code with learner understanding.

## Product Principles

- Concepts are the first stop before explanation. Before explaining, Flow should inspect existing concepts for the current topic. If a concept already covers the need, Flow should first point the learner to that concept. If the learner asks again or needs help applying it, Flow can explain conversationally.
- Concept changes need evidence. Adding, modifying, removing, or changing confidence on a concept must include explicit reason text and concrete evidence from the learner, the project, or the latest task diff.
- Memory is fetched on purpose. Flow should not read every memory file by default. It should fetch specific memory by file, current step, project path, project goal, task, or learner state.
- Memory changes are patches. Agent-facing memory tools should append or exact-replace scoped snippets and return a diff. Manual settings editing can still save the full file.
- Research is bounded. The research agent should do enough web and repo research to understand the project/domain and inform the mentor, not deep research that floods the context window.
- Questions must be real tool calls. When Flow needs an answer, it should use the question tool so the UI can pause, show choices, accept "Other", and continue from the learner response.
- Tasks are first-class. Flow should create task cards only after the relevant concepts have been introduced and explicitly understood. Tasks can contain subtasks, prepared files, relevant data, and diff-based review.
- Task review is separate from main Flow chat. The main Flow agent creates and frames tasks. A task-focused run reviews submitted diffs, marks subtasks complete, and only completes the task when understanding is demonstrated.
- Project data is user-facing. Flow should expose tasks, memory, milestones, concepts, and task history as a learner-facing project surface, not debug-only logs.

## Research Takeaways

- Claude Code memory uses a compact index plus separate topic files. The index is loaded at session start with a documented limit, while topic files are read on demand. This supports Flow Memory being separated into purpose-built files and fetched by need instead of bulk-loaded.
- Claude Code exposes coding-agent tools such as read, glob, grep, edit, write, shell, web search, and user-question tools. Flow should present familiar bounded equivalents rather than only coarse full-file reads or whole-file writes.
- Mastra working memory is best for small, always-relevant state, semantic recall is retrieval for older conversation context, and observational/event memory is a better fit for long-running logs. Flow should keep `learner.md` small and structured, while tasks/sessions remain event history and memory reads stay scoped.
- Tavily search should use concise queries, explicit `max_results`, and avoid raw-content payloads unless needed. Flow Research should default to low-result, basic-depth search.
- Deterministic policy should live in tool contracts where possible. Prompts guide judgment; tools enforce required fields, scoped patches, and visible diffs.

## Flow Memory Files

- `research.md`: concise domain/project research, references, technologies, terminology, caveats, and what the mentor should know.
- `project.md`: project goal, architecture map, important files, commands, constraints, repo conventions, and authored setup files.
- `path.md`: current direction, active task/milestone, recent progress, next move, blockers, and handoff notes.
- `learner.md`: learner style, known concepts, weak concepts, confidence evidence, help level, and recent demonstrated understanding.

## Required Tool Contract Changes

- `flow-memory-fetch`: read selected memory files or targeted excerpts by intent. Never read all memory unless the agent has a concrete reason.
- `flow-memory-patch`: append/prepend/exact-replace scoped memory snippets and return file, reason, changed text, and a unified diff.
- `ask-question`: ask a tracked question with optional choices, "Other", skip behavior, and whether progress is blocked.
- `add-concept`, `modify-concept`, `remove-concept`: require `reason`, `evidence`, and confidence-specific evidence when confidence changes.
- `suggest-existing-concept`: point the learner to an existing concept instead of re-explaining when appropriate.
- `practice-task`: create a task card with prepared files, task files, relevant concepts, success criteria, and optional subtasks.
- `complete-subtask` and `complete-task`: mark progress only after diff review or learner evidence.
- `read`, `grep`, `glob`, `edit`, `write`, `workspace-diff`, and terminal tools should be bounded and token-conscious, mirroring good coding-agent ergonomics.

## UI Requirements

- Ask-question cards should match the screenshot style: clear question title, numbered choices, an "Other" option, Skip, and Submit.
- Memory updates should render as a distinct "Memory updated" card. Clicking opens a modal showing the changed memory file and a diff viewer with additions/removals highlighted.
- Concept cards should show the reason and evidence for updates, especially confidence changes.
- Task cards should show status, subtasks, task files, prepared files, concept prerequisites, success criteria, and submit controls.
- A learner-facing project data tab should show roadmap/tasks, milestones, concepts, and memory summaries.
- Add a top-right reset chat/debug option for Flow sessions.

## Prompt Requirements

Flow is a Socratic coding mentor. It should explain, ask, listen, ask more, and then practice. It must not hand out tasks that depend on concepts not yet introduced and explicitly understood. It should use tools when workspace or learner state matters, but should not blindly follow a fixed tool sequence.

When teaching:

1. Check whether an existing concept covers the explanation.
2. If it does, recommend the concept first.
3. If the learner still asks or needs help applying it, explain in chat.
4. Ask one focused question to test or deepen understanding.
5. Only then propose a task that uses those concepts.

When updating memory or concepts, Flow must write the reason in the tool call, not merely in prose.

## Sources Used For This Brief

- Anthropic Claude Code memory docs: https://code.claude.com/docs/en/memory
- Anthropic Claude Code tools reference: https://code.claude.com/docs/en/tools-reference
- Anthropic Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
- Mastra working memory docs: https://mastra.ai/docs/memory/working-memory
- Mastra semantic recall docs: https://mastra.ai/docs/memory/semantic-recall
- Mastra observational memory docs: https://mastra.ai/docs/memory/observational-memory
- Tavily search API docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
- Tavily search best practices: https://docs.tavily.com/documentation/best-practices/best-practices-search
