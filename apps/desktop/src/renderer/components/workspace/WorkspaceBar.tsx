import { Orb } from "../common/Orb";
import type { ProjectSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import type { TaskSummary } from "../../../shared/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TaskPanel } from "../agent/TaskPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NavButtons } from "../shell/NavButtons";
import { ChatGlyph, TerminalGlyph } from "../shell/NavIcons";
import { ExpandSidebar } from "../shell/ExpandSidebar";
import { NAV_BUTTONS_WIDTH, SidebarReveal } from "../shell/SidebarReveal";
import { SIDEBAR_SLIDE_CSS } from "../shell/sidebarMotion";

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
  onExpandSidebar,
  nav,
  onToggleTerminal,
  onToggleAgent,
  task,
  taskOpen,
  onTaskOpenChange,
  onOpenFile,
  onSubmitTask,
}: {
  project: ProjectSummary;
  terminalOpen: boolean;
  agentOpen: boolean;
  /** Present only while the sidebar is hidden. Without it a project was a trap:
   *  the shell's toolbar — which carries this control everywhere else — is not
   *  rendered in the workspace, so collapsing the sidebar here left nothing to
   *  bring it back but the keyboard shortcut. */
  onExpandSidebar?: (() => void) | undefined;
  /** Supplied only while the sidebar is hidden, which is the one time this bar
   *  is the leading edge of the window. */
  nav?: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void } | undefined;
  onToggleTerminal(): void;
  onToggleAgent(): void;
  /** The task to offer, or nothing when there is none worth offering. */
  task?: TaskSummary | undefined;
  taskOpen: boolean;
  onTaskOpenChange(open: boolean): void;
  onOpenFile(path: string): void;
  onSubmitTask(taskId: string): void;
}) {
  return (
    <header
      className={cn(
        "app-drag flex h-[var(--titlebar-height)] shrink-0 items-center gap-3 px-3",
        /* No hairline under it. The panels below carry their own borders, and a
           rule here would be a third horizontal line within 40 pixels. */

        /* The OS draws its window buttons over this row whenever the sidebar —
           which normally hosts them — is hidden. Without the inset the project
           name started underneath the traffic lights, which is where it was.
           `Toolbar` has carried this for every other page; the workspace draws
           its own bar and never got it. */
        "pr-[max(0.75rem,var(--window-controls-trailing))]",
        /* See Toolbar: the inset eases in on the sidebar's curve rather than
           stepping the project name sideways mid-slide. */
        "transition-[padding-left]",
        SIDEBAR_SLIDE_CSS,
        onExpandSidebar && "pl-[max(0.75rem,var(--window-controls-leading))]",
      )}
    >
      <ExpandSidebar gap={12} onExpand={onExpandSidebar} />
      {/* See `SidebarReveal`: the pair opens its own space on the sidebar's
          curve, so the tabs and everything after them are carried rather than
          shoved. */}
      <SidebarReveal gap={12} show={nav !== undefined} width={NAV_BUTTONS_WIDTH}>
        {nav && <NavButtons canBack={nav.canBack} canForward={nav.canForward} onBack={nav.onBack} onForward={nav.onForward} />}
      </SidebarReveal>
      <div className="mr-2 min-w-0 flex-1">
        {/* The goal leads and the project name is the label above it, not the
            other way round. The name is a filing detail; the goal is the work. */}
        <p className="truncate text-ui-sm leading-tight text-muted-foreground">{project.name}</p>
        <p className="truncate text-content font-medium leading-tight text-foreground">{project.goal}</p>
      </div>


      {task && (
        <TaskButton
          onOpenChange={onTaskOpenChange}
          onOpenFile={onOpenFile}
          onSubmit={onSubmitTask}
          open={taskOpen}
          task={task}
        />
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <BarToggle icon={TerminalGlyph} label="Terminal" on={terminalOpen} onClick={onToggleTerminal} shortcut="⌘J" />
        <BarToggle icon={ChatGlyph} label="Construct" on={agentOpen} onClick={onToggleAgent} shortcut="⌘I" />
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
            /* The same box and radius the title bar's own controls use, so the
               two ends of the row are one set rather than two. */
            "app-no-drag grid size-7 place-items-center rounded-md transition-colors",
            on ? "bg-[var(--sidebar-accent-active)] text-foreground" : "text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground",
          )}
          onClick={onClick}
          type="button"
        >
          <Icon />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} {shortcut}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The task, in the bar.
 *
 * Here because this row is the one thing in the window that is always visible
 * while you work and always about *this project* — which is exactly what a task
 * is. The conversation scrolls, the sidebar is about files and concepts, and
 * the editor is the work itself; the bar above it is where a persistent state
 * of the project belongs.
 *
 * The trigger is a reading, not a label. The course of blocks is the same
 * quantity the panel shows at full size, so the bar answers "how much of this
 * is left" without being opened at all — and it is the app's own mark at the
 * smallest scale it appears at.
 */
function TaskButton({
  onOpenChange,
  onOpenFile,
  onSubmit,
  open,
  task,
}: {
  onOpenChange(open: boolean): void;
  onOpenFile(path: string): void;
  onSubmit(taskId: string): void;
  open: boolean;
  task: TaskSummary;
}) {
  const done = task.status === "passed";
  const waiting = task.status === "submitted";

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "app-no-drag flex min-w-0 max-w-[16rem] shrink items-center gap-2 rounded-[var(--radius-lg)] px-2 py-1 transition-colors",
            "hover:bg-accent data-[state=open]:bg-accent",
          )}
          title={task.title}
          type="button"
        >
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-ui-sm leading-tight text-muted-foreground">
              {done ? "Task done" : waiting ? "In review" : "Task"}
            </span>
            <span className={cn("block truncate text-ui font-medium leading-tight text-foreground", done && "line-through decoration-1")}>
              {task.title}
            </span>
          </span>

          {waiting ? (
            <Orb label="Checking your work" px={15} state="solving" />
          ) : (
            /* One block per criterion, the same course the panel draws. At this
               size it is a texture rather than a count, which is the right
               amount of information for a control you are not looking at. */
            <span aria-hidden className="flex shrink-0 gap-[2px]">
              {task.criteria.slice(0, 6).map((line, index) => (
                <span
                  className={cn(
                    "h-3.5 w-[3px] rounded-[1px]",
                    done ? "bg-[var(--success)]" : "bg-[color-mix(in_oklab,var(--foreground)_18%,transparent)]",
                  )}
                  key={`${line}-${index}`}
                />
              ))}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="center" className="p-0" sideOffset={6}>
        <TaskPanel onOpenFile={onOpenFile} onSubmit={onSubmit} task={task} />
      </PopoverContent>
    </Popover>
  );
}
