import { useState, type CSSProperties } from "react";
import { EllipsisVertical, FolderOpen, PanelLeftClose, Pencil, Plus, Settings, Trash2, TriangleAlert } from "lucide-react";
import type { ProjectSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConstructWordmark } from "../common/ConstructWordmark";

/** "workspace" is one open project. Like a document window it draws its own
 *  toolbar and is not a destination in the nav. */
export type Page = "projects" | "settings" | "workspace";

/** What the sidebar can do to a project. Every one is a write the main process
 *  owns, so a row reports intent and never edits its own copy. */
export type ProjectActions = {
  open(project: ProjectSummary): void;
  rename(project: ProjectSummary, name: string): void;
  remove(project: ProjectSummary): void;
};

const NAV: Array<{ id: Page; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "projects", label: "Projects", icon: FolderOpen },
];

/* 30px tall on a 13px label, cornered at --radius-lg, inset 8px from the sidebar's
   edge by its container and carrying 10px of padding itself: the metrics of a
   platform source list, which is what this is. The height is not h-7-and-a-bit by
   accident — it is the 20px line box plus 5px of air top and bottom, so a row is
   exactly as tall as its text needs and not a pixel more.

   No transition on the fill. A source list is the one surface where the pointer
   is expected to travel fast, and a 150ms crossfade per row turns that into a
   wake of half-lit rows trailing the cursor. AppKit paints the highlight on the
   frame the pointer arrives — hovering here should feel like touching hardware,
   not like waking a web page up.

   Every label is solid ink at regular weight, and both halves of that are
   deliberate. Solid, because alpha text on a glass sidebar composites against the
   desktop twice and arrives grey and soft however dark the token behind it was.
   Regular, because the fix for washed-out text is not weight: a source list sets
   every row the same and separates them by fill and by colour, and a sidebar of
   semibold rows is what makes an app look like it is shouting its own navigation
   at you. */
const ROW =
  "flex h-[1.875rem] w-full items-center gap-2 rounded-lg px-2.5 text-source font-normal text-foreground outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

/** Nav and row glyphs, set against the label rather than chosen for their own
 *  sake: a source list wants the icon a little larger than the cap height beside
 *  it, or the label starts to look like it is dragging the icon along. */
const ROW_ICON = "size-4 shrink-0";
const ROW_ICON_TONE = "text-foreground/70";

type Props = {
  page: Page;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  actions: ProjectActions;
  onNavigate(page: Page): void;
  onNewProject(): void;
  onCollapse(): void;
  width: number;
  /** Reserved for the OS window buttons when they sit on this edge. */
  controlsInset: number;
};

export function Sidebar({ page, projects, activeProjectId, actions, onNavigate, onNewProject, onCollapse, width, controlsInset }: Props) {
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [removing, setRemoving] = useState<ProjectSummary | null>(null);

  return (
    <nav
      className="app-sidebar flex h-full shrink-0 flex-col gap-1 px-2 pb-2"
      style={{ width, paddingTop: controlsInset } as CSSProperties}
      aria-label="Projects"
    >
      <header className="flex h-9 items-center justify-between pl-2.5 pr-1">
        <ConstructWordmark className="text-[1.05rem] leading-none text-foreground" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6" onClick={onCollapse} aria-label="Hide sidebar">
              <PanelLeftClose className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Hide sidebar</TooltipContent>
        </Tooltip>
      </header>

      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onNavigate(item.id)}
          aria-current={page === item.id ? "page" : undefined}
          className={cn(ROW, page === item.id ? "bg-foreground/10" : "hover:bg-foreground/6")}
        >
          <item.icon className={cn(ROW_ICON, ROW_ICON_TONE)} />
          {item.label}
        </button>
      ))}

      <button type="button" onClick={onNewProject} className={cn(ROW, "hover:bg-foreground/6")}>
        <Plus className={cn(ROW_ICON, ROW_ICON_TONE)} />
        New project
      </button>

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <h2 className="px-2.5 pb-1 text-[0.6875rem] font-medium text-foreground/50">Recent</h2>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {projects.map((project) => (
            <li key={project.id} className="group/row relative">
              <button
                type="button"
                onClick={() => actions.open(project)}
                aria-current={project.id === activeProjectId ? "true" : undefined}
                className={cn(
                  ROW,
                  "pr-7 text-left",
                  project.id === activeProjectId ? "bg-foreground/10" : "hover:bg-foreground/6",
                  /* An absent directory is stated, not hidden. The row still
                     opens — opening is how the learner finds out where it went,
                     and a project that quietly vanished from the list reads as
                     Construct having lost their work. */
                  !project.present && "text-foreground/50",
                )}
              >
                <span className="truncate">{project.name}</span>
                {!project.present && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TriangleAlert className="size-3.5 shrink-0 text-warning" />
                    </TooltipTrigger>
                    <TooltipContent side="right">Construct cannot find this folder</TooltipContent>
                  </Tooltip>
                )}
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Actions for ${project.name}`}
                    className="absolute right-1 top-1/2 size-5 -translate-y-1/2 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
                  >
                    <EllipsisVertical className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenaming(project)}>
                    <Pencil className="size-3.5" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(project)}>
                    <Trash2 className="size-3.5" /> Remove from Construct
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
          {projects.length === 0 && <li className="px-2.5 py-1 text-source text-foreground/50">No projects yet</li>}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => onNavigate("settings")}
        aria-current={page === "settings" ? "page" : undefined}
        className={cn(ROW, page === "settings" ? "bg-foreground/10" : "hover:bg-foreground/6")}
      >
        <Settings className={cn(ROW_ICON, ROW_ICON_TONE)} />
        Settings
      </button>

      <RenameDialog project={renaming} onClose={() => setRenaming(null)} onRename={actions.rename} />
      <RemoveDialog project={removing} onClose={() => setRemoving(null)} onRemove={actions.remove} />
    </nav>
  );
}

function RenameDialog({ project, onClose, onRename }: { project: ProjectSummary | null; onClose(): void; onRename: ProjectActions["rename"] }) {
  const [name, setName] = useState("");

  return (
    <Dialog
      open={Boolean(project)}
      onOpenChange={(open) => {
        if (!open) onClose();
        else setName(project?.name ?? "");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>
            {/* Renaming does not move the directory. Saying so up front avoids the
                learner discovering it later by looking for a folder that kept its
                old name. */}
            This changes the name in Construct. The folder on disk keeps its name.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name || (project?.name ?? "")}
          onChange={(event) => setName(event.target.value)}
          aria-label="Project name"
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              if (project && name.trim()) onRename(project, name.trim());
              onClose();
            }}
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ project, onClose, onRemove }: { project: ProjectSummary | null; onClose(): void; onRemove: ProjectActions["remove"] }) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {project?.name} from Construct?</DialogTitle>
          <DialogDescription>
            {/* The distinction that matters: this is not a delete. Naming the path
                is what makes that credible. */}
            Construct forgets the project. Nothing in {project?.directory} is deleted, and you can add it back at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (project) onRemove(project);
              onClose();
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Exported for the projects page, which lists the same rows in a wider frame. */
export { relativeTime };
