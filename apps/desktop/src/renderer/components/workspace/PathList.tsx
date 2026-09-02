import { Check, CircleDashed, CircleDot, PauseCircle, RotateCw } from "lucide-react";

import type { PathStep, ProjectPath } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ConstructDots } from "../common/ConstructDots";

/**
 * The teaching path, as a section of the sidebar.
 *
 * The path already existed — the agent plans it, revises it, and writes it to
 * `path.md` — and until now nothing in the window showed it. The concepts list
 * was in this slot instead, which answers "what have I been taught" but never
 * "where is this going", and the second question is the one you have while you
 * are working. Concepts are still a click away in the Atlas; the path is only
 * meaningful here, next to the project it plans.
 *
 * Ordered, and drawn as a spine with a node per step, because the order is the
 * information: a checklist says what is left, a path says what has to happen
 * before what. The current step is the only one that gets full weight — the rest
 * are context for it.
 */
const STATUS_ICON: Record<PathStep["status"], React.ComponentType<{ className?: string }>> = {
  completed: Check,
  active: CircleDot,
  planned: CircleDashed,
  blocked: PauseCircle,
  revising: RotateCw,
};

/** Said in the sidebar's own voice rather than the schema's: `revising` is a
 *  state the agent uses and not a word anybody would pick for it. */
const STATUS_LABEL: Record<PathStep["status"], string> = {
  completed: "Done",
  active: "Now",
  planned: "Next",
  blocked: "Blocked",
  revising: "Rethinking",
};

export function PathList({
  activeStepId,
  onOpen,
  path,
}: {
  /** The step the agent says it is on, from `currentNodeId`. */
  activeStepId: string | null;
  /** Opens a step's detail. Optional: the list is worth showing before there is
   *  anywhere to go from it. */
  onOpen?: ((step: PathStep) => void) | undefined;
  path: ProjectPath | null;
}) {
  const steps = [...(path?.nodes ?? [])].sort((a, b) => a.order - b.order);

  if (steps.length === 0) {
    /* The mark, and nothing else. A sentence explaining that the path is not
       written yet is an explanation nobody asked for taking up the space the
       path will occupy; the mark says "not full yet" without saying anything. */
    return (
      <div className="flex justify-center py-4">
        <ConstructDots className="text-foreground/25" pattern="still" size={26} />
      </div>
    );
  }

  return (
    <ol className="px-1.5">
      {steps.map((step, index) => {
        const current = step.id === activeStepId || step.status === "active";
        const done = step.status === "completed";
        const Icon = STATUS_ICON[step.status];
        return (
          <li className="relative" key={step.id}>
            {/* The spine, drawn between the nodes rather than behind them, so a
                step's own mark never sits on a line. Skipped on the last step —
                a path that trails off past its end reads as unfinished data.
                
                Anchored to this row's mark and run past the row's own bottom to
                where the next mark starts, rather than given a height: the
                current step carries a summary and is half again as tall as the
                rest, and a fixed line leaves a gap under it. */}
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[0.875rem] top-[1.3125rem] bottom-[-0.3125rem] w-px",
                  done ? "bg-foreground/25" : "bg-border",
                )}
              />
            )}
            {/* The summary lives on hover, not in the column.
                
                Printed inline it was four lines of prose under one step, which
                pushed the rest of the path off the bottom and buried the file
                tree above it — the sidebar became an essay about one step rather
                than a list of all of them. On hover it is there when you ask. */}
            <HoverCard>
            <HoverCardTrigger
              className={cn(
                "group/step flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors outline-none",
                onOpen ? "cursor-default hover:bg-[var(--sidebar-accent)]" : "hover:bg-[var(--sidebar-accent)]",
                current && "bg-[var(--sidebar-accent-active)]",
              )}
              onClick={() => onOpen?.(step)}
            >
              <span
                className={cn(
                  "mt-px grid size-4 shrink-0 place-items-center rounded-full transition-colors",
                  done
                    ? "bg-foreground/85 text-background"
                    : current
                      ? "text-foreground"
                      : step.status === "blocked"
                        ? "text-warning"
                        : "text-muted-foreground/60",
                )}
              >
                <Icon className={done ? "size-2.5" : "size-3.5"} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-source-sm leading-[1.45]",
                    /* Completed steps stay legible but stop competing: they are
                       the reason the current one makes sense, not the thing you
                       are looking for. */
                    current ? "font-medium text-foreground" : done ? "text-foreground/55" : "text-foreground/75",
                  )}
                >
                  {step.title}
                </span>
              </span>
              {(current || step.status === "blocked") && (
                <span
                  className={cn(
                    "mt-px shrink-0 text-ui-sm",
                    step.status === "blocked" ? "text-warning" : "text-muted-foreground/70",
                  )}
                >
                  {STATUS_LABEL[step.status]}
                </span>
              )}
            </HoverCardTrigger>
            {step.summary && (
              <HoverCardContent align="start" className="w-72" side="right" sideOffset={10}>
                <p className="text-ui font-medium text-foreground">{step.title}</p>
                <p className="mt-1 text-ui leading-[1.5] text-muted-foreground">{step.summary}</p>
              </HoverCardContent>
            )}
            </HoverCard>
          </li>
        );
      })}
    </ol>
  );
}
