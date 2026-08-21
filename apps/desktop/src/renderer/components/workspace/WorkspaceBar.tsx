import { MessageSquare, SquareTerminal } from "lucide-react";
import type { ProjectSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Construct's top bar, which is deliberately not a title bar.
 *
 * An IDE's toolbar names the file being edited, because in an IDE the file is
 * the subject. Here the file is already named twice — by its tab and by the
 * tree — and the thing named nowhere else is what the learner set out to
 * understand and how far they have got. So this row carries the goal and the
 * concept rail, and the file is left to its tab.
 *
 * The goal is the one line worth keeping permanently visible: everything the
 * agent does is judged against it, and a learner who has lost track of what
 * they were building is the failure mode this whole product exists to prevent.
 *
 * The concepts used to sit here too, as a rail. They moved to the sidebar: a
 * concept title is a sentence, so four across a toolbar was four truncations,
 * and the goal ended up squeezed to nothing beside them. The bar now gives the
 * goal the whole width it needs.
 */
export function WorkspaceBar({
  project,
  terminalOpen,
  agentOpen,
  onToggleTerminal,
  onToggleAgent,
}: {
  project: ProjectSummary;
  terminalOpen: boolean;
  agentOpen: boolean;
  onToggleTerminal(): void;
  onToggleAgent(): void;
}) {
  return (
    <header
      className={cn(
        "app-drag flex h-[var(--titlebar-height)] shrink-0 items-center gap-3 px-3",
        /* No hairline under it. The panels below carry their own borders, and a
           rule here would be a third horizontal line within 40 pixels. */
      )}
    >
      <div className="min-w-0 flex-1">
        {/* The goal leads and the project name is the label above it, not the
            other way round. The name is a filing detail; the goal is the work. */}
        <p className="truncate text-ui-sm leading-tight text-muted-foreground">{project.name}</p>
        <p className="truncate text-content font-medium leading-tight text-foreground">{project.goal}</p>
      </div>


      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <BarToggle icon={SquareTerminal} label="Terminal" on={terminalOpen} onClick={onToggleTerminal} shortcut="⌘J" />
        <BarToggle icon={MessageSquare} label="Construct" on={agentOpen} onClick={onToggleAgent} shortcut="⌘I" />
      </div>
    </header>
  );
}

function BarToggle({
  icon: Icon,
  label,
  on,
  onClick,
  shortcut,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  on: boolean;
  onClick(): void;
  shortcut: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-pressed={on}
          className={cn(
            "app-no-drag grid size-7 place-items-center rounded-lg transition-colors",
            on ? "bg-[var(--sidebar-accent-active)] text-foreground" : "text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground",
          )}
          onClick={onClick}
          type="button"
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} {shortcut}
      </TooltipContent>
    </Tooltip>
  );
}
