import type { TaskSummary } from "../../../shared/api";

/**
 * The task a `set-practice-task` call describes, read back from its own input.
 *
 * The transcript draws the card the instant the tool runs, which is before the
 * stored task has been re-read — so the call's arguments stand in until it
 * arrives. Everything the store owns and the call does not is defaulted to the
 * state a brand new task is in, because that is exactly what it is.
 */
export function taskFromToolInput(input: string): TaskSummary | null {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const taskId = String(parsed.taskId ?? "").trim();
    const title = String(parsed.title ?? "").trim();
    if (!taskId || !title) return null;

    const list = (value: unknown, limit: number) =>
      Array.isArray(value) ? value.map(String).map((entry) => entry.trim()).filter(Boolean).slice(0, limit) : [];

    const now = new Date().toISOString();
    return {
      taskId,
      title,
      brief: String(parsed.brief ?? ""),
      criteria: list(parsed.criteria, 8),
      concepts: list(parsed.concepts, 8),
      files: list(parsed.files, 8),
      status: "open",
      outcome: "",
      createdAt: now,
      updatedAt: now,
    };
  } catch {
    return null;
  }
}

/**
 * The task the learner is on, if any.
 *
 * The newest one that is not finished. There is normally only one — the agent
 * is told to judge a submitted task before setting another — but if it sets a
 * second anyway, the newest is the one that was just asked for.
 *
 * Here rather than beside the component that renders it: this is arithmetic
 * over a list, and the component reaches Monaco through the card's Markdown, so
 * testing it there would need a DOM to answer a question that has nothing to do
 * with one.
 */
export function activeTask(tasks: TaskSummary[]): TaskSummary | null {
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    const task = tasks[index]!;
    if (task.status !== "passed") return task;
  }
  return null;
}

/**
 * A criterion as plain words.
 *
 * The agent writes these with the same reflexes it writes prose, so they arrive
 * carrying backticks and asterisks — and a checklist row is the one place that
 * markup has nowhere to go. It is a single line beside a checkbox, not a
 * paragraph, and rendering a code chip inside one makes the row taller than the
 * thing it is measuring. The syntax is stripped rather than rendered, so what
 * shows is the sentence the agent meant.
 */
export function plainText(line: string): string {
  return line
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<![\w*])\*([^*\n]+)\*(?!\w)/g, "$1")
    .replace(/(?<![\w_])_([^_\n]+)_(?!\w)/g, "$1")
    /* A reference keeps its label, which is the readable half. */
    .replace(/\[\[(?:concept|file):[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[(?:concept|file):([^\]]*)\]\]/g, "$1")
    .trim();
}
