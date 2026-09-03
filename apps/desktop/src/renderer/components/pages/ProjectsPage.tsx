import { useEffect, useMemo, useState } from "react";
import { Archive, Check, ChevronRight, Ellipsis, FolderOpen, FolderPlus, Import, PencilLine, Pin, Search, TriangleAlert, Trash2 } from "lucide-react";
import { Orb } from "../common/Orb";
import { LANGUAGES, type Language } from "@construct/domain";
import type { AtlasConcept, ConstructApi, ProjectDefaults, ProjectSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { modKey } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/common/EmptyState";
import { LanguageGlyph, LANGUAGE_LABEL } from "@/components/common/LanguageGlyph";
import { MasteryStrip } from "@/components/common/MasteryStrip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The host capabilities the preload exposes beside the Construct API. */
declare const constructHost: { chooseDirectory(): Promise<string | null> };

type Props = {
  api: ConstructApi | undefined;
  /** What a new project inherits: where it goes, and what it is written in.
   *  Owned by Settings so this page never has to ask. */
  defaults: ProjectDefaults;
  projects: ProjectSummary[];
  creating: boolean;
  onCreatingChange(open: boolean): void;
  onOpen(project: ProjectSummary): void;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

/**
 * Where the work lives.
 *
 * This used to be one flat list of rows: a glyph, a name, a line of goal, and a
 * timestamp, all at the same weight. It was a directory listing for an app whose
 * whole subject is what you have learned — and it left most of what Construct
 * knows about a project unsaid. Pinning, archiving, renaming and removing all
 * existed in the model and reached no control here at all.
 *
 * So each project is a card, and the card carries the thing the list was for:
 * the mastery strip, which is the concepts that project has taught you tinted by
 * how well you hold them. Two projects with the same name and date are no longer
 * indistinguishable — the one you actually got somewhere in looks like it.
 *
 * Pinned first, then most recently opened, then archived out of the way at the
 * bottom rather than deleted, because archiving is not deleting.
 */
export function ProjectsPage({ api, defaults, projects, creating, onCreatingChange, onOpen, onChanged, onError }: Props) {
  /* Concepts come from the atlas rather than per project: one call answers every
     card, and the atlas is the only source that spans projects. A project with
     no entry simply has no concepts yet, which is a fact the card can show. */
  const [atlas, setAtlas] = useState<AtlasConcept[] | null>(null);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [removing, setRemoving] = useState<ProjectSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!api) return;
    void api.conceptAtlas().then(setAtlas).catch(() => setAtlas([]));
  }, [api, projects.length]);

  const levels = useMemo(() => {
    const byProject = new Map<string, number[]>();
    for (const concept of atlas ?? []) {
      const held = byProject.get(concept.projectId) ?? [];
      held.push(concept.masteryLevel);
      byProject.set(concept.projectId, held);
    }
    return byProject;
  }, [atlas]);

  /* Pinned first, then by when you last had it open — a project you pinned is a
     project you said should not move, and everything else sorts by recency
     because that is the order you are actually looking for it in. */
  const sorted = useMemo(() => {
    const rank = (project: ProjectSummary) => Date.parse(project.openedAt ?? project.createdAt) || 0;
    return [...projects].sort((a, b) => {
      if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
      return rank(b) - rank(a);
    });
  }, [projects]);

  const live = sorted.filter((project) => !project.archivedAt);
  const archived = sorted.filter((project) => project.archivedAt);

  const act = async (run: () => Promise<void>) => {
    try { await run(); await onChanged(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : "That did not work."); }
  };

  return (
    /* The empty screen is centred in the window rather than sitting at the top
       of an otherwise blank page, which is what a page-width container with
       nothing under it produces. */
    <div className={cn("mx-auto w-full max-w-3xl px-6", projects.length === 0 ? "flex h-full items-center justify-center py-6" : "py-6")}>
      {projects.length === 0 ? (
        /* The first screen of the application, for anyone who did not start one
           of the three the intake offered. It is the whole page rather than a
           card in the middle of it, and it says what a project *is* — the one
           thing about Construct that is not obvious and that everything after
           it depends on: it works in a folder on your disk, on your files, and
           it is not a chat window with a workspace bolted on.

           Both actions are here at full size and neither is a link. Starting
           something and bringing something in are the only two things that can
           happen on this screen, so they are the screen. */
        <EmptyState
          action={
            <>
              <Button className="px-4" onClick={() => onCreatingChange(true)} size="lg">
                <FolderPlus className="size-4" /> New project
              </Button>
              <ImportButton api={api} onChanged={onChanged} onError={onError} size="lg" />
            </>
          }
          description="Construct works in a folder on your disk — your files, your git history, your build. Start an empty one, or bring in something you are already working on."
          hint={<><kbd className="font-sans">{modKey}N</kbd> for a new one, any time</>}
          icon={FolderOpen}
          title="Nothing on the go yet."
        />
      ) : (
        <>
          <header className="mb-4 flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h1 className="text-title font-semibold">Projects</h1>
              <span className="text-ui text-muted-foreground">{live.length}</span>
            </div>
            <div className="flex shrink-0 gap-2">
              <ImportButton api={api} onChanged={onChanged} onError={onError} />
              <Button size="sm" onClick={() => onCreatingChange(true)}>
                <FolderPlus className="size-4" /> New project
              </Button>
            </div>
          </header>

          {/* Two up. A card wide enough for a goal to breathe, narrow enough that
              the second one is on screen beside it rather than below the fold. */}
          <ul className="grid gap-2 sm:grid-cols-2">
            {live.map((project) => (
              <ProjectCard
                key={project.id}
                levels={levels.get(project.id) ?? []}
                onArchive={() => void act(async () => api?.setProjectArchived({ projectId: project.id, value: true }))}
                onOpen={() => onOpen(project)}
                onPin={() => void act(async () => api?.setProjectPinned({ projectId: project.id, value: !project.pinnedAt }))}
                onRemove={() => setRemoving(project)}
                onRename={() => setRenaming(project)}
                project={project}
              />
            ))}
          </ul>

          {archived.length > 0 && (
            <section className="mt-6">
              <button
                aria-expanded={showArchived}
                className="flex items-center gap-1.5 rounded-md px-1 py-1 text-ui text-muted-foreground transition-colors outline-none hover:text-foreground"
                onClick={() => setShowArchived((open) => !open)}
                type="button"
              >
                <ChevronRight className={cn("size-3.5 transition-transform", showArchived && "rotate-90")} />
                Archived
                <span className="text-muted-foreground/60">{archived.length}</span>
              </button>
              {showArchived && (
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {archived.map((project) => (
                    <ProjectCard
                      key={project.id}
                      levels={levels.get(project.id) ?? []}
                      onArchive={() => void act(async () => api?.setProjectArchived({ projectId: project.id, value: false }))}
                      onOpen={() => onOpen(project)}
                      onPin={() => void act(async () => api?.setProjectPinned({ projectId: project.id, value: !project.pinnedAt }))}
                      onRemove={() => setRemoving(project)}
                      onRename={() => setRenaming(project)}
                      project={project}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <RenameDialog
        api={api}
        onChanged={onChanged}
        onClose={() => setRenaming(null)}
        onError={onError}
        project={renaming}
      />

      <Dialog onOpenChange={(next) => { if (!next) setRemoving(null); }} open={!!removing}>
        <DialogContent className="sm:max-w-[28rem]">
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              {/* Said plainly, because the folder is the learner's work and the
                  fear here is that Construct takes it with the record. */}
              This removes Construct's record of the project — the concepts it taught you and the path it
              was following. The folder on your disk is left exactly where it is.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setRemoving(null)} variant="secondary">Cancel</Button>
            <Button
              onClick={() => {
                const target = removing;
                setRemoving(null);
                if (target) void act(async () => api?.deleteProject({ projectId: target.id }));
              }}
              variant="destructive"
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewProjectDialog
        api={api}
        defaults={defaults}
        onChanged={onChanged}
        onCreated={onOpen}
        onError={onError}
        onOpenChange={onCreatingChange}
        open={creating}
      />
    </div>
  );
}

/**
 * One project.
 *
 * The card is a button, and the menu inside it is not — a card you have to aim
 * at a small target to open is a list with extra steps. So the whole surface
 * opens the project, and the menu stops the click from reaching it.
 */
function ProjectCard({
  levels,
  onArchive,
  onOpen,
  onPin,
  onRemove,
  onRename,
  project,
}: {
  levels: number[];
  onArchive(): void;
  onOpen(): void;
  onPin(): void;
  onRemove(): void;
  onRename(): void;
  project: ProjectSummary;
}) {
  return (
    <li>
      <div
        className={cn(
          "group/card relative flex h-full cursor-default flex-col gap-2.5 rounded-xl bg-card/40 p-3.5 text-left smooth-shadow-ring-sm transition-[background-color,box-shadow]",
          /* No border to darken on hover any more — the ring lives inside the
             shadow, so hover lifts the card instead of thickening its edge. */
          "hover:bg-card/70 hover:smooth-shadow-ring-md",
          project.archivedAt && "opacity-60",
        )}
        onClick={onOpen}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-2">
          <LanguageGlyph className="size-4 shrink-0" language={project.language} />
          <p className="min-w-0 flex-1 truncate text-content font-medium">{project.name}</p>
          {project.pinnedAt && <Pin className="size-3 shrink-0 fill-current text-muted-foreground/70" />}
          {!project.present && (
            <span className="flex shrink-0 items-center gap-1 text-ui-sm text-warning" title="The folder has moved or been deleted">
              <TriangleAlert className="size-3" /> Missing
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${project.name} options`}
              /* Held back until the card is under the pointer or the menu is
                 open, so a grid of cards is a grid of projects rather than a
                 grid of buttons. Focus reveals it too, or it would be a control
                 only a mouse could find. */
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] outline-none group-hover/card:opacity-100 hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground aria-expanded:opacity-100"
              onClick={(event) => event.stopPropagation()}
            >
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onSelect={onPin}>
                <Pin />
                {project.pinnedAt ? "Unpin" : "Pin to the top"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRename}>
                <PencilLine />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onArchive}>
                <Archive />
                {project.archivedAt ? "Bring back" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRemove} variant="destructive">
                <Trash2 />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Two lines, then clipped. The goal is what the agent teaches against,
            so it is worth more than one line — and a card that grows to fit the
            longest goal in the list makes every other card wrong. */}
        <p className="line-clamp-2 min-h-[2.25rem] text-ui leading-[1.4] text-muted-foreground">{project.goal}</p>

        <div className="mt-auto flex flex-col gap-1.5">
          <MasteryStrip levels={levels} />
          <div className="flex items-baseline justify-between gap-2 text-ui-sm text-muted-foreground">
            <span>{levels.length === 0 ? "Nothing learned yet" : `${levels.length} ${levels.length === 1 ? "concept" : "concepts"}`}</span>
            <span className="shrink-0">{relativeTime(project.openedAt ?? project.createdAt)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

/** Renaming is the one edit that is only a name, so it gets a field and not a
 *  form. The directory is untouched — this is what Construct calls the project,
 *  not what the disk does. */
function RenameDialog({
  api,
  onChanged,
  onClose,
  onError,
  project,
}: {
  api: ConstructApi | undefined;
  onChanged(): Promise<void>;
  onClose(): void;
  onError(message: string): void;
  project: ProjectSummary | null;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(project?.name ?? ""); }, [project]);

  const save = async () => {
    if (!api || !project || !name.trim()) return;
    setBusy(true);
    try {
      await api.renameProject({ projectId: project.id, name: name.trim() });
      await onChanged();
      onClose();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Construct could not rename that project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={(next) => { if (!next && !busy) onClose(); }} open={!!project}>
      <DialogContent className="sm:max-w-[24rem]">
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>The folder on disk keeps its own name.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="project-rename">Name</FieldLabel>
          <Input
            autoFocus
            id="project-rename"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void save(); }}
            value={name}
          />
        </Field>
        <DialogFooter>
          <Button disabled={busy} onClick={onClose} variant="secondary">Cancel</Button>
          <Button disabled={busy || !name.trim()} onClick={() => void save()}>Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportButton({
  api,
  onChanged,
  onError,
  /* Small in the page header beside the other control, full size on the empty
     screen where it is one of the two things the page is for. */
  size = "sm",
}: {
  api: ConstructApi | undefined;
  onChanged(): Promise<void>;
  onError(message: string): void;
  size?: "sm" | "lg";
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      className={size === "lg" ? "px-4" : undefined}
      size={size}
      variant="outline"
      disabled={busy}
      onClick={async () => {
        const directory = await constructHost.chooseDirectory();
        if (!directory || !api) return;
        setBusy(true);
        try {
          /* An imported project has no stated goal yet. Rather than block the
             import behind a form, it adopts a placeholder the learner can
             replace — the agent asks for the real one on the first turn. */
          await api.importProject({ directory, goal: "Understand and extend this codebase" });
          await onChanged();
        } catch (error) {
          onError(error instanceof Error ? error.message : "Construct could not open that folder.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Import className="size-4" /> Open a folder
    </Button>
  );
}

/**
 * Turns a stated goal into a project name.
 *
 * The dialog used to ask for both, which made naming the first thing a learner
 * had to do and the least interesting thing they had to say. The name is a label
 * for a folder; the goal is the thing the agent teaches against. Only one of
 * those is worth a field.
 *
 * Deliberately literal rather than clever. It takes the front of the goal and
 * trims the scaffolding off it, so the name is always visibly a piece of what
 * you typed — a derivation you can predict beats a summary you cannot, and the
 * name is shown live while you type so it is never a surprise. Renaming lives on
 * the project card for the cases this gets wrong.
 */
const GOAL_PREFIX = /^(?:i\s+want\s+to\s+|i'd\s+like\s+to\s+|help\s+me\s+|teach\s+me\s+|let's\s+|how\s+to\s+|how\s+)/i;
const TRAILING = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "from", "with", "that", "how", "into", "at", "by", "its"]);

export function nameFromGoal(goal: string): string {
  const cleaned = goal.trim().replace(/\s+/g, " ").replace(GOAL_PREFIX, "");
  if (!cleaned) return "";
  const words: string[] = [];
  let length = 0;
  for (const word of cleaned.split(" ")) {
    const stripped = word.replace(/[^\p{L}\p{N}+#.-]/gu, "");
    if (!stripped) continue;
    if (words.length >= 6 || length + stripped.length > 38) break;
    words.push(stripped);
    length += stripped.length + 1;
  }
  while (words.length > 1 && TRAILING.has(words[words.length - 1]!.toLowerCase())) words.pop();
  if (words.length === 0) return "";
  const name = words.join(" ");
  return name[0]!.toUpperCase() + name.slice(1);
}

/**
 * Making a project.
 *
 * Two things changed the shape of this. The name is derived rather than asked
 * for, so the form opens on the only question that matters — what do you want to
 * understand. And it can be given a foundation: concepts the learner already
 * holds, picked out of their own atlas, which go into `learner.md` so the first
 * turn knows what not to re-teach.
 *
 * That second part is why the dialog now scrolls. A picker over every concept
 * you have ever met is a lot of content to put in front of someone who mostly
 * wants to type one sentence and press a button — so it is collapsed by default,
 * says how many are selected when it is shut, and the button stays reachable
 * because the footer does not scroll with the body.
 */
function NewProjectDialog({
  api,
  defaults,
  open,
  onOpenChange,
  onChanged,
  onCreated,
  onError,
}: {
  api: ConstructApi | undefined;
  defaults: ProjectDefaults;
  open: boolean;
  onOpenChange(open: boolean): void;
  onChanged(): Promise<void>;
  /** Opens the project that was just made. */
  onCreated(project: ProjectSummary): void;
  onError(message: string): void;
}) {
  const [goal, setGoal] = useState("");
  /* Both start from the learner's defaults. `parent` stays null unless they pick
     somewhere else for this one project, so the main process keeps using the
     configured folder — and a project made now still lands in the right place if
     the default changes before the dialog is submitted. */
  const [language, setLanguage] = useState<Language>(defaults.language);
  const [parent, setParent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [atlas, setAtlas] = useState<AtlasConcept[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  /* Loaded when the dialog opens rather than with the page: most projects are
     made without touching this, and the atlas is the one call here that grows
     with everything the learner has ever learned. */
  useEffect(() => {
    if (!open || !api || atlas) return;
    void api.conceptAtlas().then(setAtlas).catch(() => setAtlas([]));
  }, [api, atlas, open]);

  useEffect(() => {
    if (open) return;
    /* Reset on close, not on open: clearing as it opens is visible. */
    setGoal(""); setParent(null); setPicking(false); setQuery(""); setChosen(new Set());
  }, [open]);

  /* The name the project is created under. A literal cut from the goal, and
     deliberately not shown: it is a placeholder the model replaces within
     seconds of entering the project, so putting it in the dialog would show the
     learner a name that is about to change. */
  const name = nameFromGoal(goal);
  const ready = name.length > 0 && goal.trim().length >= 3;

  /* Strongest first, so what you already hold best is what you are offered
     first — and deduplicated by title, because the same idea met in two projects
     is one thing to build on, not two. */
  const offered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const seen = new Map<string, AtlasConcept>();
    for (const concept of atlas ?? []) {
      const key = concept.title.trim().toLocaleLowerCase();
      const held = seen.get(key);
      if (!held || concept.masteryLevel > held.masteryLevel) seen.set(key, concept);
    }
    return [...seen.values()]
      .filter((concept) => !needle || concept.title.toLocaleLowerCase().includes(needle) || concept.projectName.toLocaleLowerCase().includes(needle))
      .sort((a, b) => b.masteryLevel - a.masteryLevel || a.title.localeCompare(b.title));
  }, [atlas, query]);

  const byId = useMemo(() => new Map((atlas ?? []).map((concept) => [concept.conceptId, concept])), [atlas]);

  const toggle = (conceptId: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(conceptId)) next.delete(conceptId);
      else if (next.size < 24) next.add(conceptId);
      return next;
    });
  };

  const submit = async () => {
    if (!api || !ready) return;
    setBusy(true);
    try {
      const foundation = [...chosen]
        .map((conceptId) => byId.get(conceptId))
        .filter((concept): concept is AtlasConcept => !!concept)
        .map((concept) => ({ title: concept.title, level: concept.masteryLevel }));
      /* `parentDirectory` is only sent when the learner picked one: omitting it
         is what tells the main process to use the folder from Settings, and
         creating it if it is not there yet. */
      const created = await api.createProject({
        name,
        goal: goal.trim(),
        language,
        ...(parent ? { parentDirectory: parent } : {}),
        ...(foundation.length ? { foundation } : {}),
      });
      await onChanged();
      onOpenChange(false);
      /* Straight into the project, because Construct is already working on it:
         creating one starts a research pass and then the first teaching turn, and
         leaving the learner on the project list means all of that happens
         somewhere they cannot see — which reads exactly like nothing happening. */
      onCreated(created);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Construct could not create that project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Title only. The paragraph under it explained what a New Project
            button does to someone who had just pressed one. */}
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>

        {/* The body scrolls; the header and footer do not. With the picker open
            this is easily taller than a short window, and a Create button you
            have to scroll to find is a button people do not find. */}
        <div className="app-scroll -mx-1 max-h-[min(26rem,55vh)] space-y-4 overflow-y-auto px-1">
          <Field>
            <FieldLabel className="text-ui font-medium text-muted-foreground" htmlFor="project-goal">
              What do you want to build or understand?
            </FieldLabel>
            <Textarea
              autoFocus
              id="project-goal"
              onChange={(event) => setGoal(event.target.value)}
              placeholder="How a triangle gets from three points to lit pixels on screen"
              rows={3}
              value={goal}
            />
          </Field>

          {/* Ten languages, each with a mark you already know. A dropdown makes
              that two clicks and hides nine of them behind the first; laid out
              they are picked by shape in one. The name is spelled out beside the
              label so the row is never a logo-memory test — the glyph's own rule.

              Every mark keeps its colour. Draining the unselected ones made nine
              of the ten look disabled, which is the one thing they are not — the
              row exists to be chosen from. Selection is carried by the tile
              instead: a filled, ringed box under the mark you picked. */}
          <Field>
            <div className="flex items-baseline justify-between gap-2">
              <FieldLabel className="text-ui font-medium text-muted-foreground">Language</FieldLabel>
              <span className="text-ui text-foreground/80">{LANGUAGE_LABEL[language]}</span>
            </div>
            <div className="flex flex-wrap gap-1" role="radiogroup">
              {LANGUAGES.map((value) => (
                <button
                  aria-checked={language === value}
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-lg border transition-colors outline-none",
                    "",
                    language === value
                      ? "border-[var(--border-strong)] bg-accent ring-1 ring-[var(--border-strong)]"
                      : "border-transparent opacity-80 hover:bg-accent/50 hover:opacity-100",
                  )}
                  key={value}
                  onClick={() => setLanguage(value)}
                  role="radio"
                  title={LANGUAGE_LABEL[value]}
                  type="button"
                >
                  <LanguageGlyph className="size-5" language={value} />
                </button>
              ))}
            </div>
          </Field>

          {/* Optional, and shut by default. Most projects start from nothing in
              particular, and a list of everything you have ever learned is a wall
              to put in front of that. */}
          {atlas !== null && atlas.length > 0 && (
            <Field>
              <button
                aria-expanded={picking}
                className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-ui font-medium text-muted-foreground transition-colors outline-none hover:text-foreground"
                onClick={() => setPicking((value) => !value)}
                type="button"
              >
                <ChevronRight className={cn("size-3.5 transition-transform", picking && "rotate-90")} />
                Build on what you already know
                <span className="ml-auto font-normal text-muted-foreground/70">
                  {chosen.size > 0 ? `${chosen.size} selected` : "optional"}
                </span>
              </button>

              {picking && (
                <div className="mt-1.5 overflow-hidden rounded-xl border border-border">
                  <InputGroup className="h-8 rounded-none border-0 border-b border-border">
                    <InputGroupAddon align="inline-start">
                      <Search className="size-3.5" />
                    </InputGroupAddon>
                    <InputGroupInput
                      aria-label="Search concepts"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search your concepts…"
                      value={query}
                    />
                  </InputGroup>
                  <ul className="app-scroll max-h-44 overflow-y-auto">
                    {offered.map((concept) => {
                      const on = chosen.has(concept.conceptId);
                      return (
                        <li key={concept.conceptId}>
                          <button
                            aria-pressed={on}
                            className={cn(
                              "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors outline-none",
                              on ? "bg-accent/60" : "hover:bg-accent/35",
                            )}
                            onClick={() => toggle(concept.conceptId)}
                            type="button"
                          >
                            <span
                              className={cn(
                                "grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
                                on ? "border-transparent bg-foreground text-background" : "border-[var(--border-strong)]",
                              )}
                            >
                              {on && <Check className="size-3" />}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-ui text-foreground">{concept.title}</span>
                            {/* The level is the reason to pick one, so it is the
                                one number on the row. */}
                            <span className="shrink-0 text-ui-sm text-muted-foreground">L{concept.masteryLevel}</span>
                            <span className="max-w-24 shrink-0 truncate text-ui-sm text-muted-foreground/60">{concept.projectName}</span>
                          </button>
                        </li>
                      );
                    })}
                    {offered.length === 0 && (
                      <li className="px-2.5 py-6 text-center text-ui text-muted-foreground">Nothing matches that.</li>
                    )}
                  </ul>
                </div>
              )}
            </Field>
          )}

          {/* Where it lands, stated rather than asked. A line of text and a way to
              change your mind: the folder is a decision nobody has an opinion
              about after the first time, and it used to stand between the learner
              and a project as a mandatory trip through the OS dialog. */}
          <p className="flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground">
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{parent ?? defaults.directory}</span>
            <button
              className="shrink-0 rounded-sm text-foreground/70 underline underline-offset-2 outline-none hover:text-foreground"
              onClick={async () => {
                const chosenDirectory = await constructHost.chooseDirectory();
                if (chosenDirectory) setParent(chosenDirectory);
              }}
              type="button"
            >
              Change
            </button>
            {parent && (
              <button
                className="shrink-0 rounded-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground"
                onClick={() => setParent(null)}
                type="button"
              >
                Reset
              </button>
            )}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ready || busy} onClick={() => void submit()}>
            {busy && <Orb invert label="Working" px={15} state="working" />}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
