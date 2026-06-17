# Construct Flow Path, Tasks, And Global Concepts Brief

Date: 2026-06-18

## Goal

Construct Flow should feel like a mentor-led project path, not a loose chat with incidental task cards. Tasks are the main unit of work. The learner should always understand which path node they are in, which task is currently active, and which global concepts changed because of the work.

## Concept Architecture

- Concepts are global learner knowledge, shared across all projects.
- A concept ID must describe the reusable technology idea, not a project instance.
- Prefer IDs such as `swiftui.core-structure`, `swiftui.state`, `typescript.types.interfaces`, and `python.files`.
- Avoid project-specific IDs such as `swiftui.notesapp.core-structure`.
- Concept tool UI should show a compact tree so the learner sees where the concept lives:

```text
swiftui
  |
  +-- core-structure
```

- Concept mutations should be visibly typed:
  - Added: green text and add icon.
  - Modified: yellow text and edit icon.
  - Removed: red text and remove icon.
- The tool UI should expose the important reason, confidence evidence, evidence bullets, authorship, and project/provenance only when useful.

## Path Architecture

- When a Flow project starts, the agent should ask enough tracked questions to learn the user and project context.
- The agent should read global concepts, ask about prior experience and comfort level when useful, then update `learner.md`.
- After learner profiling, the agent must call the path creation tool.
- The path tool should create a researched, ability-aware sequence of path nodes. If the learner is new to Swift, the path starts with Swift fundamentals before SwiftUI app work.
- The project tab should show a horizontal timeline for the path. Completed nodes are clear, the current node is emphasized, and future nodes are greyed out.
- The path can change as the learner progresses.

## Task Architecture

- Tasks are pinned and primary.
- A task behaves like a tracked question: it waits until the learner submits, and the agent resumes from that submission.
- The chat should show the current active task as a floating overlay above the conversation, not as a normal section that pushes messages down.
- The task overlay should expand with smooth spring/accordion motion.
- The task overlay must not contain a separate "message this task" input. While a task is active, the normal bottom composer sends task-scoped messages automatically.
- Hovering or opening the task should show the detailed prompt, success criteria, subtasks, files, concepts, and authored-by metadata.
- The project tab should show concept history and task history for the current path node, not a single undifferentiated list.
- Each task belongs to a path node. If the learner is at node 2, the task list and task history should focus on node 2.

## Concept Card Presentation

- Concept detail cards should use a plain Opaline surface: compact border, semantic tokens, clear title, useful metadata, and no image-backed/shimmer/3D treatment.
- Concepts must store explicit metadata:
  - `language`: enum-backed primary language (`swift`, `python`, `typescript`, `javascript`, `cpp`, `unknown`).
  - `technology`: framework/library/API/platform text such as SwiftUI, OpenGL, GLFW, React, or Node.
- Add/modify concept messages in chat should render the same Opaline concept summary card directly inside the chat artifact, then show the minimal concept-tree mutation below it.
- The card should feel focused and current: restrained borders, semantic tokens, legible text, and no flashy palette takeover.
