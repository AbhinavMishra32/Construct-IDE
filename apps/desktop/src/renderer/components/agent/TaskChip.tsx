import { Check, ChevronRight } from "lucide-react";
import { Orb } from "../common/Orb";

import type { TaskSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";

/**
 * A task, as a reference in the conversation.
 *
 * The full card does not belong here. The agent panel is the narrowest column
 * in the window, and a task carries a brief, a numbered procedure, a checklist
 * and a set of files — opening all of that in a 380px column produced a wall
 * that overflowed its own panel and buried the conversation it was sitting in.
 *
 * So the chat gets a reference and the work gets a room: one line saying which
 * task it is and where it stands, and a click that opens it in the editor
 * column where there is width for it. That is the same relationship a file has
 * with its tab — the mention is not the thing.
 */
export function TaskChip({
  active,
  onOpen,
  task,
}: {
  /** True when this is the task the panel is currently showing, so the row it
   *  came from is marked the way an open file's row is. */
  active?: boolean;
  onOpen?: ((taskId: string) => void) | undefined;
  task: TaskSummary;
}) {
  const done = task.status === "passed";
  const waiting = task.status === "submitted";

  return (
    <button
      className={cn(
        "app-task group/task flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-lg)] px-2.5 py-1.5 text-left transition-colors",
        "hover:bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]",
        active && "bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]",
        done && "opacity-70",
      )}
      onClick={() => onOpen?.(task.taskId)}
      title="Open the task"
      type="button"
    >
      <span
        aria-hidden
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full",
          done ? "bg-[var(--success)] text-background" : "border border-[var(--border-strong)]",
        )}
      >
        {done && <Check className="size-2.5" strokeWidth={3} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-ui-sm font-semibold tracking-wide text-muted-foreground/70 uppercase">
          {done ? "Task complete" : waiting ? "Task in review" : "Task"}
        </span>
        <span className={cn("block truncate text-ui font-medium text-foreground", done && "line-through decoration-1")}>
          {task.title}
        </span>
      </span>

      {waiting ? (
        <Orb label="Checking your work" px={15} state="solving" />
      ) : (
        !done && (
          <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/70">
            {task.criteria.length} criteri{task.criteria.length === 1 ? "on" : "a"}
          </span>
        )
      )}
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover/task:text-foreground" />
    </button>
  );
}
