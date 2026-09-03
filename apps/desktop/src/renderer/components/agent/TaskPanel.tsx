import { useCallback, useEffect, useState } from "react";
import { Check, CornerDownLeft, FileCode2 } from "lucide-react";
import { Orb } from "../common/Orb";

import type { TaskSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { plainText } from "./taskInput";

/**
 * The task, in full.
 *
 * Lives in a popover off the workspace bar rather than in the conversation. A
 * task carries a brief, a numbered procedure, a checklist and a set of files;
 * opening that in the agent column — the narrowest in the window — produced a
 * wall that overflowed its own panel. It belongs over the editor, at the width
 * the editor has, because the editor is where the work happens.
 *
 * The progress read is a course of blocks, one per criterion. That is not a
 * generic progress bar: it is the app's own mark at strip scale, the same
 * coursing `MasteryStrip` uses and the same the icon draws. A task is a course
 * of the wall being built, and it should look like one.
 *
 * Ticking is the learner's bookkeeping and is kept per machine. It is
 * deliberately not what finishes a task — only the agent's verdict does that,
 * because a checklist you can tick yourself is a checklist that measures
 * nothing. What the ticks buy is knowing where you are.
 */
const TICKS_KEY = "construct.taskTicks";

function readTicks(taskId: string): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(`${TICKS_KEY}.${taskId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []);
  } catch {
    /* Private window, cleared storage, or something an older build wrote. All
       three mean the same thing: nothing is ticked. */
    return new Set();
  }
}

export function TaskPanel({
  onOpenFile,
  onSubmit,
  task,
}: {
  onOpenFile?: ((path: string) => void) | undefined;
  onSubmit?: ((taskId: string) => void) | undefined;
  task: TaskSummary;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => readTicks(task.taskId));

  useEffect(() => setTicked(readTicks(task.taskId)), [task.taskId]);

  const toggle = useCallback(
    (line: string) => {
      setTicked((current) => {
        const next = new Set(current);
        if (!next.delete(line)) next.add(line);
        try {
          localStorage.setItem(`${TICKS_KEY}.${task.taskId}`, JSON.stringify([...next]));
        } catch {
          /* Quota, or storage off. The tick still holds for this session. */
        }
        return next;
      });
    },
    [task.taskId],
  );

  const done = task.status === "passed";
  const waiting = task.status === "submitted";
  const checked = (line: string) => done || ticked.has(line);
  const met = task.criteria.filter(checked).length;

  return (
    <div className="flex max-h-[min(34rem,70vh)] w-[30rem] max-w-[calc(100vw-3rem)] flex-col">
      <header className="shrink-0 px-4 pt-3.5">
        <div className="flex items-center gap-2">
          <span className="text-ui-sm font-semibold tracking-[0.08em] text-muted-foreground/85 uppercase">
            Practice task
          </span>
          <StatusPill status={task.status} />
        </div>
        <h2 className={cn("mt-1 text-title font-semibold leading-tight tracking-[-0.01em]", done && "text-muted-foreground")}>
          {task.title}
        </h2>

        {/* One block per criterion, laid as a course. Reads as a quantity at a
            glance — how much of this is standing — without a number anybody has
            to parse. */}
        {task.criteria.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <span aria-hidden className="flex min-w-0 flex-1 gap-[2px]">
              {task.criteria.map((line) => (
                <span
                  className={cn(
                    "h-1.5 flex-1 rounded-[1px] transition-colors duration-200",
                    checked(line) ? "bg-[var(--success)]" : "bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]",
                  )}
                  key={line}
                />
              ))}
            </span>
            <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground">
              {met}/{task.criteria.length}
            </span>
          </div>
        )}
      </header>

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        {task.brief.trim() && (
          <div className="min-w-0">
            <Markdown source={task.brief} />
          </div>
        )}

        {task.criteria.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-1 text-ui-sm font-semibold tracking-[0.08em] text-muted-foreground/85 uppercase">Done when</h3>
            <ul className="-mx-1.5">
              {task.criteria.map((line) => (
                <li key={line}>
                  <button
                    aria-pressed={checked(line)}
                    className="flex w-full items-start gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] disabled:hover:bg-transparent"
                    disabled={done}
                    onClick={() => toggle(line)}
                    type="button"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-[0.1875rem] grid size-[0.9375rem] shrink-0 place-items-center rounded-[0.3125rem] border transition-colors duration-150",
                        checked(line)
                          ? "border-transparent bg-[var(--success)] text-background"
                          : "border-[var(--border-strong)] text-transparent",
                      )}
                    >
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-ui leading-[1.55]",
                        checked(line) ? "text-muted-foreground line-through decoration-1" : "text-foreground/85",
                      )}
                    >
                      {plainText(line)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Where the work goes. Clickable, because the thing you do after
            reading a task is open the file it names. */}
        {task.files.length > 0 && (
          <section className="mt-3.5">
            <h3 className="mb-1.5 text-ui-sm font-semibold tracking-[0.08em] text-muted-foreground/85 uppercase">In</h3>
            <div className="flex flex-wrap gap-1">
              {task.files.map((path) => (
                <button
                  className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 px-1.5 py-0.5 text-ui-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  key={path}
                  onClick={() => onOpenFile?.(path)}
                  type="button"
                >
                  <FileCode2 className="size-3 shrink-0" />
                  <span className="min-w-0 truncate font-mono">{path}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* The agent's answer to the criteria, under them. */}
        {task.outcome.trim() && (
          <section
            className={cn(
              "mt-4 rounded-[var(--radius-lg)] px-3 py-2.5",
              done
                ? "bg-[color-mix(in_oklab,var(--success)_14%,transparent)]"
                : "bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]",
            )}
          >
            <h3 className="mb-1 text-ui-sm font-semibold tracking-[0.08em] text-muted-foreground/85 uppercase">
              {done ? "Passed" : "Not yet"}
            </h3>
            <p className="text-ui leading-[1.6] text-foreground/85">{task.outcome}</p>
          </section>
        )}

        <div className="h-3" />
      </div>

      {/* Sticky, because the brief can be long and the action must not be
          something you scroll to find. */}
      <footer className="hairline-t flex shrink-0 items-center gap-2 px-4 py-2.5">
        {done ? (
          <span className="flex items-center gap-1.5 text-ui text-muted-foreground">
            <Check className="size-3.5 text-[var(--success)]" strokeWidth={3} />
            Finished
          </span>
        ) : waiting ? (
          <span className="flex items-center gap-1.5 text-ui text-muted-foreground">
            <Orb label="Checking your work" px={15} state="solving" />
            Construct is checking your work
          </span>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-ui-sm text-muted-foreground/85">
              {met === task.criteria.length && task.criteria.length > 0
                ? "Everything ticked — send it over."
                : "Tick as you go. Construct checks the code, not the ticks."}
            </span>
            <button
              className="click-depth-effect-slightly flex shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[var(--foreground)] px-2.5 py-1 text-ui font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={!onSubmit}
              onClick={() => onSubmit?.(task.taskId)}
              type="button"
            >
              Submit
              <CornerDownLeft className="size-3" />
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

function StatusPill({ status }: { status: TaskSummary["status"] }) {
  const look =
    status === "passed"
      ? { label: "Done", className: "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]" }
      : status === "submitted"
        ? { label: "In review", className: "bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)] text-muted-foreground" }
        : { label: "Open", className: "bg-[color-mix(in_oklab,var(--brand)_18%,transparent)] text-foreground/80" };

  return (
    <span className={cn("rounded-full px-1.5 py-px text-ui-sm font-medium", look.className)}>{look.label}</span>
  );
}
