# Construct Flow Mastery System

Flow concepts use Mastery as the source of truth for task readiness.

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

## Tool Responsibilities

- `add-concept` and `modify-concept` carry `masteryLevel`, `masteryText`, and `masteryReason`.
- `concept-exercise` creates practice that is answerable from the concept text directly.
- `review-concept-exercise` records the learner answer and applies careful Mastery changes.
- `practice-task` refuses concepts below Level 3.
- `review-subtask` can apply concept Mastery changes for concepts attached to that task.

Mastery history is append-only through concept history entries. Each level change keeps its timestamp, direction, reason, and evidence.
