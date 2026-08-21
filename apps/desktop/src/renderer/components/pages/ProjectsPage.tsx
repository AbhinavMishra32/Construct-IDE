import { useState } from "react";
import { FolderOpen, FolderPlus, Import, TriangleAlert } from "lucide-react";
import { LANGUAGES, type Language } from "@construct/domain";
import type { ConstructApi, ProjectDefaults, ProjectSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/common/EmptyState";
import { LanguageGlyph } from "@/components/common/LanguageGlyph";

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

export function ProjectsPage({ api, defaults, projects, creating, onCreatingChange, onOpen, onChanged, onError }: Props) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="A Construct project is a folder on your disk. Start a new one, or bring in something you are already working on."
          action={
            <div className="flex gap-2">
              <Button onClick={() => onCreatingChange(true)}>
                <FolderPlus className="size-4" /> New project
              </Button>
              <ImportButton api={api} onChanged={onChanged} onError={onError} />
            </div>
          }
        />
      ) : (
        <>
          <header className="mb-4 flex items-center justify-between">
            <h1 className="text-title font-semibold">Projects</h1>
            <div className="flex gap-2">
              <ImportButton api={api} onChanged={onChanged} onError={onError} />
              <Button size="sm" onClick={() => onCreatingChange(true)}>
                <FolderPlus className="size-4" /> New project
              </Button>
            </div>
          </header>

          <ul className="flex flex-col gap-1.5">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => onOpen(project)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-3.5 py-3 text-left",
                    "hover:border-border hover:bg-card/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                >
                  <LanguageGlyph language={project.language} className="size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-content font-medium">{project.name}</p>
                    <p className="truncate text-ui text-muted-foreground">{project.goal}</p>
                  </div>
                  {!project.present && (
                    <span className="flex shrink-0 items-center gap-1 text-ui text-warning">
                      <TriangleAlert className="size-3.5" /> Missing
                    </span>
                  )}
                  <span className="shrink-0 text-ui text-muted-foreground">
                    {project.openedAt ? relativeTime(project.openedAt) : relativeTime(project.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

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

function ImportButton({ api, onChanged, onError }: { api: ConstructApi | undefined; onChanged(): Promise<void>; onError(message: string): void }) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
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
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  /* Both start from the learner's defaults. `parent` stays null unless they pick
     somewhere else for this one project, so the main process keeps using the
     configured folder — and a project made now still lands in the right place if
     the default changes before the dialog is submitted. */
  const [language, setLanguage] = useState<Language>(defaults.language);
  const [parent, setParent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* No folder to choose, so the form is ready as soon as it has been told what
     to build and what to understand. */
  const ready = name.trim().length > 0 && goal.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            {/* The goal is not decoration. It is what the agent teaches against,
                so the form asks for it in the same breath as the name. */}
            Construct makes a folder and teaches you the project you describe.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="project-name">Name</FieldLabel>
          <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Software renderer" autoFocus />
        </Field>

        <Field>
          <FieldLabel htmlFor="project-goal">What do you want to understand?</FieldLabel>
          <Textarea
            id="project-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="How a triangle gets from three points to lit pixels on screen"
            rows={3}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="project-language">Language</FieldLabel>
          <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
            <SelectTrigger id="project-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Where it lands, stated rather than asked. A line of text and a way to
            change your mind: the folder is a decision nobody has an opinion
            about after the first time, and it used to stand between the learner
            and a project as a mandatory trip through the OS dialog. */}
        <p className="flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground">
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{parent ?? defaults.directory}</span>
          <button
            className="shrink-0 rounded-sm text-foreground/70 underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={async () => {
              const chosen = await constructHost.chooseDirectory();
              if (chosen) setParent(chosen);
            }}
            type="button"
          >
            Change
          </button>
          {parent && (
            <button
              className="shrink-0 rounded-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setParent(null)}
              type="button"
            >
              Reset
            </button>
          )}
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!ready || busy}
            onClick={async () => {
              if (!api) return;
              setBusy(true);
              try {
                /* `parentDirectory` is only sent when the learner picked one:
                   omitting it is what tells the main process to use the folder
                   from Settings, and creating it if it is not there yet. */
                const created = await api.createProject({
                  name: name.trim(),
                  goal: goal.trim(),
                  language,
                  ...(parent ? { parentDirectory: parent } : {}),
                });
                await onChanged();
                onOpenChange(false);
                /* Straight into the project, because Construct is already
                   working on it: creating one starts a research pass and then
                   the first teaching turn, and leaving the learner on the
                   project list means all of that happens somewhere they cannot
                   see — which reads exactly like nothing happening at all. */
                onCreated(created);
                setName("");
                setGoal("");
                setParent(null);
              } catch (error) {
                onError(error instanceof Error ? error.message : "Construct could not create that project.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
