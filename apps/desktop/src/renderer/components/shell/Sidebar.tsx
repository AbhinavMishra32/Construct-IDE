import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, EllipsisVertical, FolderOpen, Orbit, Pencil, Pin, PinOff, Plus, Settings, Trash2, TriangleAlert } from "lucide-react";
import type { ProjectSummary } from "../../../shared/api";
import type { ConstructApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Segmented } from "@/components/ui/segmented";
import { NavButtons } from "./NavButtons";
import { SyncBadge } from "./SyncBadge";
import { HomeGlyph, SidebarGlyph } from "./NavIcons";
import { initials, relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

/** "workspace" is one open project. Like a document window it draws its own
 *  toolbar and is not a destination in the nav — the sidebar becomes its file
 *  tree instead. */
export type Page = "projects" | "concepts" | "settings" | "workspace";

/** What the sidebar can do to a project. Every one of these is a write the main
 *  process owns, so the row reports intent and never edits its own copy. */
export type ProjectActions = {
  rename(project: ProjectSummary, title: string): void;
  setPinned(project: ProjectSummary, pinned: boolean): void;
  setArchived(project: ProjectSummary, archived: boolean): void;
  remove(project: ProjectSummary): void;
};

const NAV: Array<{ id: Page; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "projects", label: "Projects", icon: FolderOpen },
  /* The atlas is a destination in its own right, and deliberately as high in the
     nav as the projects are: what the learner understands outlives any one of
     them, which is the whole claim Construct makes. */
  { id: "concepts", label: "Atlas", icon: Orbit },
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
   deliberate. Solid, because the labels used to be foreground at some fraction —
   95, 85, 80 — and on an opaque sidebar that is a legitimate way to rank rows,
   but on this one it is not: the surface is glass, so alpha text composites
   against the desktop twice and arrives grey and soft however dark the token
   behind it was. That, not the transparency, was why the list read as washed out.

   Regular, because the fix for washed-out text is not weight. A source list sets
   every row the same and separates them by fill and by colour. Reaching for medium
   here would buy back the contrast the alpha lost while saying, wrongly, that the
   fixed rows outrank the project titles — and a sidebar of semibold rows is the
   thing that makes an app look like it is shouting its own navigation at you. */
const ROW =
  "flex h-[1.875rem] w-full items-center gap-2 rounded-lg px-2.5 text-source font-normal text-foreground outline-none";

/** Nav and row glyphs. Set against the label rather than chosen for its own sake:
 *  a source list wants the icon a little larger than the cap height it sits
 *  beside, or the label starts to look like it is dragging the icon along.
 *
 *  A shade off the label rather than the muted grey they used to be: at 55% on
 *  glass a 16px line drawing has no stroke left to read, and the row turned into
 *  a label with a smudge in front of it. */
const ROW_ICON = "size-4 shrink-0";
const ROW_ICON_TONE = "text-foreground/70";

/** Unpinned projects shown before the list starts asking to be scrolled. */
const RECENT_LIMIT = 8;

/** Indented to the row's text column, not to the row's box: the label heads a
 *  list of titles, so it is the titles it has to line up with. */
function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-2.5 pt-1">
      <span className="text-source-sm text-muted-foreground">{children}</span>
      {action}
    </div>
  );
}

type ProjectLens = "path" | "concepts";

export function Sidebar({
  page,
  email,
  api,
  projects,
  activeProjectId,
  projectActions,
  projectView,
  atlasView,
  onGoHome,
  nav,
  onPage,
  onOpenProject,
  onNewProject,
  onCollapse,
}: {
  page: Page;
  email: string;
  /** Only for the sync badge, which reads its own status. */
  api: ConstructApi | undefined;
  projects: ProjectSummary[];
  activeProjectId?: string | undefined;
  projectActions: ProjectActions;
  /** Rendered in place of the project list while a project is open. */
  projectView?: { name: string; tree: React.ReactNode; path: React.ReactNode; concepts: React.ReactNode } | undefined;
  /** Rendered in place of the project list on the Atlas. Two indexes side by
   *  side — the projects you are not looking at, and the concepts you are — is
   *  one too many for a column this narrow. */
  atlasView?: React.ReactNode | undefined;
  onGoHome?: (() => void) | undefined;
  /** Back and forward. Rendered here — beside the traffic lights — whenever the
   *  sidebar is showing; the page bars carry the same pair when it is not, so
   *  the control exists exactly once. */
  nav: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void };
  onPage(page: Page): void;
  onOpenProject(project: ProjectSummary): void;
  onNewProject(): void;
  onCollapse(): void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  /* Which of the project's two indexes the lower half is showing. Kept here
     rather than in the workspace's per-project memory: it is a way of looking,
     not a property of the project, and carrying it between projects is what a
     view switch should do. */
  const [lens, setLens] = useState<ProjectLens>("path");
  /* Whether the lower half is showing at all. Collapsing it is how you give the
     file tree the whole column on a project deep enough to need it. */
  const [lensOpen, setLensOpen] = useState(true);

  // The store already sorts pinned first, then by last touched; the sidebar only
  // has to say where one group stops and the next starts.
  const shelved = projects.filter((project) => project.archivedAt);
  const live = projects.filter((project) => !project.archivedAt);
  const pinned = live.filter((project) => project.pinnedAt);
  const recent = live.filter((project) => !project.pinnedAt).slice(0, RECENT_LIMIT);
  /* The open project keeps its row whatever else is true of it. Archiving or
     finishing the project you are working in is the ordinary way to file it away,
     and the row disappearing from under the cursor while its workspace is still
     on screen reads as having lost the thing rather than having tidied it. */
  const shown = new Set([...pinned, ...recent, ...(showArchived ? shelved : [])].map((project) => project.id));
  const stranded = activeProjectId && !shown.has(activeProjectId) ? projects.find((project) => project.id === activeProjectId) : undefined;

  const row = (project: ProjectSummary) => (
    <ProjectRow
      key={project.id}
      actions={projectActions}
      active={activeProjectId === project.id}
      onOpen={() => onOpenProject(project)}
      onRenameEnd={() => setRenaming(null)}
      onRenameStart={() => setRenaming(project.id)}
      onRequestDelete={() => setPendingDelete(project)}
      renaming={renaming === project.id}
      project={project}
    />
  );

  return (
    <aside className="app-sidebar app-drag flex h-full w-full flex-col">
      {/* Clears the native traffic lights, and carries the collapse control. The leading
          inset is the shared chrome token rather than a hand-measured margin, so the
          wordmark keeps its clearance if the button metrics ever move. */}
      <div className="flex h-[var(--titlebar-height)] shrink-0 items-center pl-[max(0.625rem,var(--window-controls-leading))] pr-2">
        {/* Home, back, forward — one group of three, in the order they are
            reached for. The wordmark stood here and doubled as the way home,
            which is the convention on a web page and not in an application
            window: it named the app to someone already looking at it, and hid
            a navigation control inside a logo. A labelled button says what it
            does, and gives the arrows beside it something to belong to. */}
        <button
          aria-label="All projects"
          className={cn(
            "app-no-drag grid size-7 shrink-0 place-items-center rounded-md transition-colors",
            onGoHome
              ? "text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground"
              : /* Already home: kept in place, so the arrows never shift under
                   the cursor as you move between pages. */
                "cursor-default text-muted-foreground/30",
          )}
          disabled={!onGoHome}
          onClick={onGoHome}
          title="All projects"
          type="button"
        >
          <HomeGlyph />
        </button>
        <NavButtons canBack={nav.canBack} canForward={nav.canForward} onBack={nav.onBack} onForward={nav.onForward} />
        <button
          /* The same box as home and the arrows. It carried a `rounded-lg`
             where they are `rounded-md`, so the one control on the trailing edge
             of the row was shaped unlike everything on the leading edge. */
          className="app-no-drag ml-auto grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
          onClick={onCollapse}
          title="Hide sidebar ⌘B"
          type="button"
        >
          <SidebarGlyph />
        </button>
      </div>

      {!projectView && (
      <>
      <div className="app-no-drag space-y-0.5 px-2">
        <button
          className={cn(ROW, "hover:bg-[var(--sidebar-accent)]")}
          onClick={onNewProject}
          type="button"
        >
          <Plus className={cn(ROW_ICON, ROW_ICON_TONE)} />
          <span className="flex-1 text-left">New project</span>
          <kbd className="font-sans text-source-sm text-muted-foreground">⌘N</kbd>
        </button>
      </div>

      {/* Wider than the gap between rows by enough to read as a new group rather
          than as a skipped row — the reference's own break between its actions and
          its nav, and between the nav and the first section label. */}
      <nav className="app-no-drag mt-4 space-y-0.5 px-2">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={cn(
              ROW,
              /* Selection is the fill and nothing else. The ink was a step lighter
                 on unselected rows, which meant the nav read as one lit item and
                 four half-off ones — on glass, where alpha already costs contrast,
                 that is four rows you have to look at rather than glance at. AppKit
                 keeps the label constant and moves the highlight. */
              page === id
                ? "bg-[var(--sidebar-accent-active)]"
                : "hover:bg-[var(--sidebar-accent)]",
            )}
            onClick={() => onPage(id)}
            type="button"
          >
            <Icon className={cn(ROW_ICON, ROW_ICON_TONE)} />
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          </button>
        ))}
      </nav>
      </>
      )}

      {atlasView ? (
        <div className="app-no-drag mt-3 flex min-h-0 flex-1 flex-col">
          <SectionLabel>Concepts</SectionLabel>
          {atlasView}
        </div>
      ) : projectView ? (
        /* Inside a project the sidebar is the file tree. The project's name
           takes the place of the section label, so the column still says what
           it is a list of. */
        /* Files above, the path below, both scrolling in one column. The two
           are the project's two indexes — what it is made of, and where the
           teaching is going — and they belong in the same place for the reason a book
           puts its contents and its index at either end rather than in separate
           volumes. */
        /* Two sections, one scrolls.
           
           They used to share a single scroller, so a long path pushed the file
           tree up out of sight and a deep tree pushed the path off the bottom —
           whichever you wanted, the other was in the way. The tree takes the
           flexible space and scrolls inside it; the path sits on the floor of
           the column at its natural height, where it is always visible and never
           moves. */
        <div className="app-no-drag mt-3 flex min-h-0 flex-1 flex-col">
          <SectionLabel>Files</SectionLabel>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto">{projectView.tree}</div>

          {/* The cap lives on the flex item, not on the scroller inside it.
              A percentage max-height only resolves against a parent with a
              definite height, and the wrapper's height was content-derived — so
              the path scrolled inside a cramped box with free space under it.
              As a flex child of a column that does have a height, 45% means 45%,
              and below that the section is simply as tall as its steps. */}
          <div
            className={cn(
              /* No rule above it. The segmented control is already a hard
                 shape sitting in open space, so a line over it made two
                 horizontal edges within a few pixels of each other and read as
                 a seam rather than a division. The gap does the separating. */
              "mt-2 flex min-h-0 shrink-0 flex-col pt-2",
              /* Collapsed, the section is its own switch and nothing else, and
                 the tree above takes back every pixel it was holding. */
              lensOpen && "max-h-[45%]",
            )}
          >
            {/* Two readings of the same project, in one slot rather than two
                sections stacked. They answer neighbouring questions — where the
                teaching is going, and what it has already left behind — and
                showing both at once would halve each of them in a column that is
                already the narrowest thing on screen. */}
            <div className="mx-2 mb-1.5 flex items-center gap-0.5">
              <Segmented<ProjectLens>
                ariaLabel="What to show about this project"
                className="min-w-0 flex-1"
                size="sm"
                onChange={(value) => {
                  setLens(value);
                  /* Picking a lens is asking to see it. Switching tabs while
                     collapsed and having nothing happen would read as broken. */
                  setLensOpen(true);
                }}
                options={[
                  { value: "path", label: "Path" },
                  { value: "concepts", label: "Concepts" },
                ]}
                value={lens}
              />
              <button
                aria-expanded={lensOpen}
                aria-label={lensOpen ? "Hide this section" : "Show this section"}
                className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
                onClick={() => setLensOpen((open) => !open)}
                title={lensOpen ? "Hide this section" : "Show this section"}
                type="button"
              >
                <ChevronDown className={cn("size-3.5 transition-transform duration-200", !lensOpen && "rotate-180")} />
              </button>
            </div>
            {lensOpen && (
              <div className="app-scroll min-h-0 overflow-y-auto">
                {lens === "path" ? projectView.path : projectView.concepts}
              </div>
            )}
          </div>
        </div>
      ) : (
      <div className="app-no-drag app-scroll mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pinned.length > 0 && (
          <>
            <SectionLabel>Pinned</SectionLabel>
            <div className="space-y-0.5">{pinned.map(row)}</div>
          </>
        )}

        {(recent.length > 0 || stranded) && (
          <>
            <SectionLabel>Recent</SectionLabel>
            <div className="space-y-0.5">
              {recent.map(row)}
              {stranded && row(stranded)}
            </div>
          </>
        )}

        {/* Collapsed by default: the point of archiving was to get these out of
            the way, and a permanent list of them would put them back. */}
        {shelved.length > 0 && (
          <>
            <button
              className="flex h-7 w-full items-center gap-1 px-2.5 pt-1 text-source-sm text-muted-foreground hover:text-foreground"
              onClick={() => setShowArchived((value) => !value)}
              type="button"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", showArchived && "rotate-90")} />
              Archived
              <span className="tabular-nums font-normal text-muted-foreground">{shelved.length}</span>
            </button>
            {showArchived && <div className="space-y-0.5">{shelved.map(row)}</div>}
          </>
        )}
      </div>
      )}

      {/* One row rather than three. The address under the name repeated what the
          avatar and the name already say, and the sync line spent a whole line of
          chrome on one bit of state — so sync is the status light on the row and
          the words for it live in the tooltip.

          Taller than the rows above it, because the avatar is: this is the one
          place in the list where the leading glyph is a face rather than a line
          drawing, and it takes the room a face needs to read as one. */}
      <div className="app-no-drag flex items-center gap-1 border-t border-[var(--sidebar-border)] p-2">
        {/* The avatar is 4px wider than a nav glyph, so the gap gives back the 4px:
            it starts on the icons' left edge and the name still lands on the one
            text column the whole list reads down. */}
        <button
          className={cn(ROW, "h-9 gap-1 hover:bg-[var(--sidebar-accent)]")}
          onClick={() => onPage("settings")}
          title={email}
          type="button"
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-background-elevated-secondary)] text-ui-sm font-semibold text-foreground">
            {initials(email)}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{email}</span>
          <Settings className={cn(ROW_ICON, ROW_ICON_TONE)} />
        </button>
        {/* Beside the account, because that is what it is about. Renders
            nothing at all when there is nothing to say. */}
        <SyncBadge api={api} />
      </div>

      <DeleteProjectDialog
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) projectActions.remove(pendingDelete);
          setPendingDelete(null);
        }}
        project={pendingDelete}
      />
    </aside>
  );
}

/** The control cluster's buttons, in the order they sit in the row. */
const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md text-foreground/70 hover:bg-[var(--sidebar-accent-active)] hover:text-foreground";

/**
 * One project in the list, with everything you can do to it behind ⋮ or a
 * right-click on the row — and the two you actually reach for, pinning and
 * filing, as their own icons on hover.
 *
 * No gutter is reserved for them. The old row paid for the ⋮ on every row it
 * drew, so titles ended in an ellipsis a word early even with nothing hovered;
 * here the controls take their room from the title only while they are visible,
 * and the title fades under them rather than being cut. What the fade hides,
 * hovering walks past — see {@link RowTitle}.
 */
function ProjectRow({
  project,
  active,
  renaming,
  actions,
  onOpen,
  onRenameStart,
  onRenameEnd,
  onRequestDelete,
}: {
  project: ProjectSummary;
  active: boolean;
  renaming: boolean;
  actions: ProjectActions;
  onOpen(): void;
  onRenameStart(): void;
  onRenameEnd(): void;
  onRequestDelete(): void;
}) {
  const [open, setOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const archived = !!project.archivedAt;

  const items: Array<{ key: string; label: string; icon: React.ComponentType<{ className?: string }>; run(): void; destructive?: boolean }> = [
    { key: "r", label: "Rename", icon: Pencil, run: onRenameStart },
    ...(archived
      ? []
      : [{ key: "p", label: project.pinnedAt ? "Unpin" : "Pin to top", icon: project.pinnedAt ? PinOff : Pin, run: () => actions.setPinned(project, !project.pinnedAt) }]),
    { key: "a", label: archived ? "Restore" : "Archive", icon: archived ? ArchiveRestore : Archive, run: () => actions.setArchived(project, !archived) },
    { key: "d", label: "Delete…", icon: Trash2, run: onRequestDelete, destructive: true },
  ];

  /* Pin and file, the two that are one click on the row rather than two through a
     menu. Everything else stays in the menu: shelf position is worth an icon,
     renaming and deleting are not — and three icons is already the most a row
     this narrow can show without becoming a toolbar. */
  const quick = [
    ...(archived ? [] : [{ label: project.pinnedAt ? "Unpin" : "Pin to top", icon: project.pinnedAt ? PinOff : Pin, run: () => actions.setPinned(project, !project.pinnedAt) }]),
    { label: archived ? "Restore" : "Archive", icon: archived ? ArchiveRestore : Archive, run: () => actions.setArchived(project, !archived) },
  ];

  if (renaming) return <RenameRow onCancel={onRenameEnd} onCommit={(title) => { actions.rename(project, title); onRenameEnd(); }} project={project} />;

  /** Asking for the menu withdraws the peek. Both open off the same row, so the
   *  two of them up at once is two panels fighting over one anchor — and once the
   *  menu has been dismissed the pointer has to leave and come back before the
   *  peek is offered again, rather than springing up in the menu's place. */
  const openMenu = (next: boolean) => {
    setOpen(next);
    if (next) setPeeking(false);
  };

  return (
    <HoverCard closeDelay={90} onOpenChange={setPeeking} open={peeking && !open} openDelay={420}>
      <HoverCardTrigger asChild>
        <div
          className="sidebar-row group/project relative"
          onContextMenu={(event) => { event.preventDefault(); openMenu(true); }}
          // The cluster is absolute, so the gutter it needs has to be stated: one
          // slot per quick action plus the ⋮, and the inset it sits in.
          style={{ "--sidebar-controls-width": `calc(${quick.length + 1} * 1.5rem + 0.7rem)` } as CSSProperties}
        >
          <button
            className={cn(
              ROW,
              /* Solid ink at regular weight: a title is the one thing in the list
                 you actually read word by word, so it gets the full value and
                 leaves being-chrome to the medium rows above it. Archived is still
                 dimmed, because filed-away is a state of the project rather than a
                 rank in the list — but not so far down that reading it is work. */
              "text-foreground",
              active ? "bg-[var(--sidebar-accent-active)]" : "hover:bg-[var(--sidebar-accent)]",
              archived && !active && "text-foreground/60",
            )}
            onClick={onOpen}
            type="button"
          >
            <RowTitle>{project.name}</RowTitle>
          </button>

          {/* No `flex` utility here: display is CSS's to own, because it is the
              thing hover toggles, and a utility-layer `display` would outrank the
              rule that hides the cluster at rest. */}
          <div
            className="absolute right-1 top-1/2 -translate-y-1/2 items-center gap-px"
            data-open={open}
            data-row-controls
          >
            {quick.map((action) => (
              <button
                key={action.label}
                aria-label={`${action.label}: ${project.name}`}
                className={ICON_BUTTON}
                onClick={action.run}
                title={action.label}
                type="button"
              >
                <action.icon className={ROW_ICON} />
              </button>
            ))}

            <DropdownMenu modal={false} onOpenChange={openMenu} open={open}>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Options for ${project.name}`}
                  className={cn(ICON_BUTTON, open && "bg-[var(--sidebar-accent-active)] text-foreground")}
                  type="button"
                >
                  <EllipsisVertical className={ROW_ICON} />
                </button>
              </DropdownMenuTrigger>
              {/* The letters are real: Radix would otherwise spend them on typeahead,
                  which moves the highlight and leaves the hint lying about what it does. */}
              <DropdownMenuContent
                align="start"
                className="min-w-[11.5rem]"
                onKeyDown={(event) => {
                  if (event.metaKey || event.ctrlKey || event.altKey) return;
                  const item = items.find((entry) => entry.key === event.key.toLowerCase());
                  if (!item) return;
                  event.preventDefault();
                  setOpen(false);
                  item.run();
                }}
                side="right"
              >
                {items.map((item) => (
                  <Fragment key={item.key}>
                    {item.destructive && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={item.run} variant={item.destructive ? "destructive" : "default"}>
                      <item.icon />
                      <span className="flex-1">{item.label}</span>
                      <kbd className="font-sans text-ui-sm text-muted-foreground/60 uppercase">{item.key}</kbd>
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </HoverCardTrigger>

      {/* Unmounted while the menu is up rather than only closed, so there is no
          panel left to animate out over the menu that replaced it.

          Not hoverable either: there is nothing in it to click, and a panel that
          kept itself alive under the pointer would swallow clicks on the page it
          is floating over. */}
      {!open && (
        <HoverCardContent align="start" className="pointer-events-none w-[18.5rem]" side="right" sideOffset={10}>
          <ProjectPeek project={project} />
        </HoverCardContent>
      )}
    </HoverCard>
  );
}

/**
 * A sidebar title that fades where it runs out of room, and walks the rest of
 * itself past the fade while its row is hovered.
 *
 * Both need the same measurement — how much of the title does not fit — and it
 * has to be taken live: the width changes when the sidebar is dragged, when the
 * hover controls claim their gutter, and when the title is renamed. The clipped
 * flag and the travel are handed to CSS, which owns the hover state; see
 * `.sidebar-title` in theme.css.
 */
function RowTitle({ children }: { children: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const box = viewport.current;
    const inner = text.current;
    if (!box || !inner) return;
    const measure = () => {
      const hidden = inner.scrollWidth - box.clientWidth;
      // Sub-pixel layout leaves a fraction over on titles that do fit, and a row
      // that marquees by half a pixel is a row that twitches under the cursor.
      setOverflow(hidden > 1 ? hidden : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [children]);

  /* Travel is the hidden part plus the fade, so the last character ends up clear
     of the gradient rather than arriving inside it. Pace is constant — a long
     title takes longer than a short one instead of moving faster — with a floor
     so a two-word overrun is not a flick. */
  const travel = overflow + TITLE_FADE;
  const seconds = Math.min(9, Math.max(2.6, travel / 38 + 1.4));

  return (
    <span
      ref={viewport}
      className="sidebar-title text-left"
      data-clipped={overflow > 0}
      style={overflow > 0 ? ({ "--sidebar-title-shift": `-${travel}px`, "--sidebar-title-duration": `${seconds}s` } as CSSProperties) : undefined}
    >
      <span ref={text}>{children}</span>
    </span>
  );
}

/** Width of the gradient that hides the overrun, matching `--sidebar-title-fade`. */
const TITLE_FADE = 26;

/**
 * What the row could not say in one line: where the project got to, and what it
 * has actually been doing.
 *
 * This is what the native tooltip on the row used to be. A tooltip could only
 * repeat the title and a timestamp, which is the one thing the fade and the
 * marquee already cover — so the space is spent on the numbers you would open the
 * project to find out.
 */
function ProjectPeek({ project }: { project: ProjectSummary }) {
  const meta = [
    project.language,
    project.archivedAt ? "archived" : null,
    relativeTime(project.openedAt ?? project.createdAt),
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-ui leading-snug font-medium text-foreground">{project.name}</p>
        <p className="text-ui-sm text-muted-foreground/75">{meta.join(" · ")}</p>
      </div>

      {/* The goal, because it is what the agent teaches against — the one fact
          about a project worth reading before opening it. */}
      <p className="line-clamp-3 text-ui-sm leading-[1.5] text-muted-foreground">{project.goal}</p>

      <div className="border-t border-border/60 pt-2">
        {project.present ? (
          /* The path, broken at the separator so a deep folder wraps instead of
             being truncated to something unrecognisable. */
          <p className="break-all text-ui-sm text-muted-foreground/70">{project.directory}</p>
        ) : (
          <p className="flex items-start gap-1.5 text-ui-sm text-[var(--warning)]">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            <span className="break-all">Construct cannot find {project.directory}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** Renaming happens in place. Enter and blur commit, Escape restores the old
 *  title — a dialog for one short string would be more ceremony than the edit. */
function RenameRow({ project, onCommit, onCancel }: { project: ProjectSummary; onCommit(title: string): void; onCancel(): void }) {
  const input = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  /* Claimed twice: the menu that opened this row unmounts in the same commit, and
     the focus its overlay hands back can land after the first attempt. */
  useLayoutEffect(() => {
    const claim = () => {
      if (document.activeElement === input.current) return;
      input.current?.focus();
      input.current?.select();
    };
    claim();
    const frame = requestAnimationFrame(claim);
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const value = input.current?.value.trim() ?? "";
    if (value && value !== project.name) onCommit(value);
    else onCancel();
  };

  return (
    <div className={cn(ROW, "bg-[var(--sidebar-accent-active)] text-foreground")}>
      <input
        ref={input}
        aria-label="Project title"
        className="min-w-0 flex-1 bg-transparent text-source outline-none"
        defaultValue={project.name}
        maxLength={80}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") { committed.current = true; onCancel(); }
        }}
      />
    </div>
  );
}

/** Removing is the one option with nothing behind it afterwards, so it says what
 *  goes and what survives before it runs.
 *
 *  In Construct the distinction is unusually important and worth spelling out:
 *  the files are the learner's own and are never touched. Naming the path is
 *  what makes that credible rather than reassuring. */
function DeleteProjectDialog({ project, onConfirm, onCancel }: { project: ProjectSummary | null; onConfirm(): void; onCancel(): void }) {

  return (
    <Dialog onOpenChange={(next) => { if (!next) onCancel(); }} open={!!project}>
      <DialogContent className="sm:max-w-[27rem]">
        <DialogHeader>
          <DialogTitle>Remove {project?.name} from Construct?</DialogTitle>
          <DialogDescription>
            Construct forgets the project and its conversation. Nothing in {project?.directory} is deleted — those files are yours — and you can add the folder back at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="secondary">Cancel</Button>
          <Button onClick={onConfirm} variant="destructive">Delete permanently</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

