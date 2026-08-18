import { useState } from "react";
import { FolderOpen, FolderPlus, Import, TriangleAlert } from "lucide-react";
import { LANGUAGES, type Language } from "@construct/domain";
import type { ConstructApi, ProjectSummary } from "../../../shared/api";
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
  projects: ProjectSummary[];
  creating: boolean;
  onCreatingChange(open: boolean): void;
  onOpen(project: ProjectSummary): void;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

export function ProjectsPage({ api, projects, creating, onCreatingChange, onOpen, onChanged, onError }: Props) {
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

      <NewProjectDialog api={api} open={creating} onOpenChange={onCreatingChange} onChanged={onChanged} onError={onError} />
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
  open,
  onOpenChange,
  onChanged,
  onError,
}: {
  api: ConstructApi | undefined;
  open: boolean;
  onOpenChange(open: boolean): void;
  onChanged(): Promise<void>;
  onError(message: string): void;
}) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [language, setLanguage] = useState<Language>("typescript");
  const [parent, setParent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = name.trim().length > 0 && goal.trim().length >= 3 && Boolean(parent);

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

        <Field>
          <FieldLabel>Location</FieldLabel>
          <Button variant="outline" className="justify-start font-normal" onClick={async () => setParent(await constructHost.chooseDirectory())}>
            <FolderOpen className="size-4" />
            <span className="truncate">{parent ?? "Choose a folder…"}</span>
          </Button>
        </Field>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!ready || busy}
            onClick={async () => {
              if (!api || !parent) return;
              setBusy(true);
              try {
                await api.createProject({ name: name.trim(), goal: goal.trim(), parentDirectory: parent, language });
                await onChanged();
                onOpenChange(false);
                setName("");
                setGoal("");
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
