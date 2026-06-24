# Construct Flow Mastery System

Flow concepts use Mastery as the source of truth for task readiness.

Concept permission is project-local. A reusable concept definition may appear in several projects, but it grants no capability until it is explicitly introduced in the current project.

## Mastery Levels

- Level 0, Unseen: the learner has only been introduced to the name or has no reliable understanding yet.
- Level 1, Recognizes Pieces: the learner can identify vocabulary or parts, but still needs close explanation and examples.
- Level 2, Guided Understanding: the learner can explain the basic idea with support and answer small guided checks.
- Level 3, Practice Ready: the learner can reason about the concept in their own words and is ready for scoped tasks that test it.
- Level 4, Applies Reliably: the learner can use the concept in their own work with only light review.
- Level 5, Transfers and Teaches: the learner can transfer, debug, or teach the concept across nearby problems.

## Teaching Loop

1. Introduce the concept and record it at Level 0 unless learner-owned evidence already proves more.
2. Teach the concept with mental models, examples, contrasts, and Socratic checks.
3. Use tracked questions and concept exercises to gather learner answers before project tasks.
4. Upgrade, keep, or downgrade Mastery only from learner-owned evidence.
5. Create project practice tasks only when every required concept is Level 3 or higher.
6. During subtask review, update only the concepts actually proven by the learner-authored diff or explanation.

## Project Concept Firewall

- Every project owns an append-only concept relation ledger with introduced, referenced, practiced, assessed, leveled-up, leveled-down, task-used, write-used, and blocked events.
- Every concept exposes the projects where it appeared and the event history for each project.
- Tasks and code-producing artifacts declare their exact project concept IDs.
- A semantic capability auditor compares the complete artifact against the actual bodies and examples of those concepts. Similar concept names are not sufficient.
- `learner.md` is also supplied to the auditor as project-local prior evidence. Explicitly recorded comfort, fluency, or experience can cover prerequisite material that is not the current teaching target.
- Prior learner evidence cannot cover anything recorded as weak, fragile, confused, needing introduction, or version-specific material still being learned.
- Deterministic syntax checks catch high-risk language features such as C++ lambdas, JavaScript or TypeScript arrow functions, async/await, generics, pointers, React hooks, comprehensions, decorators, and Swift closures.
- Missing relations, concepts from another project, insufficient project Mastery, uncovered constructs, or an unavailable semantic auditor all fail closed before files are changed or tasks are shown.
- Flow terminal commands are validation-only because an external generator could otherwise write unaudited concepts into the workspace.

## Tool Responsibilities

- `add-concept` and `modify-concept` carry `masteryLevel`, `masteryText`, and `masteryReason`.
- `concept-exercise` creates practice that is answerable from the concept text directly.
- `review-concept-exercise` records the learner answer and applies careful Mastery changes.
- `practice-task` refuses concepts below Level 3.
- `write`, `edit`, and `practice-task.preparations` are authorized before mutation against project-local concept bodies.
- `review-subtask` can apply concept Mastery changes for concepts attached to that task.

Mastery history and project concept events are append-only. Each level change keeps its project, timestamp, direction, reason, evidence, and artifact reference.
