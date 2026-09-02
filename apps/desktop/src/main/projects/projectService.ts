import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Language } from "@construct/domain";
import type { ProjectDefaults, ProjectDetail, ProjectSummary } from "../../shared/api.js";
import type { MemoryService } from "../memory/memoryService.js";
import type { ProjectStore } from "../store/projectStore.js";

/** Turns a name a person typed into a directory name. Falls back rather than
 *  failing: a name of only punctuation is a strange project name, not a reason
 *  to refuse to create one. */
export function directorySlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "project";
}

/** The first free `name`, `name-2`, `name-3`… under `parent`.
 *
 *  Creating two projects called the same thing is ordinary — a second attempt
 *  at an idea usually has the first one's name. Refusing the second, or worse
 *  writing into the first one's directory, are both worse answers than a
 *  suffix. */
export function availableDirectory(parent: string, slug: string): string {
  const first = path.join(parent, slug);
  if (!existsSync(first)) return first;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = path.join(parent, `${slug}-${suffix}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`There are already too many projects named "${slug}" in that folder.`);
}

/**
 * Projects as directories on the learner's disk.
 *
 * Construct does not own a project's files. Creating one makes an empty
 * directory; importing one adopts a directory that already has files in it. Everything after that is the learner's, which is why the store
 * records only where a project is and deleting one never removes it.
 */
export class ProjectService {
  constructor(
    private readonly store: ProjectStore,
    /** Flow Memory is written when the project is made, not when an agent first
     *  runs: the four files are part of what a Construct project *is*, and a
     *  learner with no model connected should still find them there. */
    private readonly memory: MemoryService,
    /** What the learner said about themselves on the way into Construct, as
     *  Markdown lines. A function rather than the profile itself because it is
     *  read at the moment a project is made, and the learner may have edited it
     *  since the application started. Empty when they have not been through the
     *  intake, which is the case every project was written for before it
     *  existed. */
    private readonly intake: () => readonly string[] = () => [],
  ) {}

  list(): ProjectSummary[] {
    return this.store.listProjects();
  }

  /**
   * Where new projects go, and what they are written in.
   *
   * Defaulted rather than asked for. Making a project used to require picking a
   * folder through the OS dialog every single time — a decision nobody has an
   * opinion about after the first one, standing between the learner and the only
   * two things that matter, which are what they want to build and what they want
   * to understand.
   *
   * `~/Construct` because it is where somebody would look for their Construct
   * projects without being told, and it stays out of Documents, which belongs to
   * the learner rather than to us.
   */
  defaults(): ProjectDefaults {
    return {
      directory: this.store.getSetting<string>("projects-directory", path.join(homedir(), "Construct")),
      language: this.store.getSetting<Language>("projects-language", "typescript"),
    };
  }

  /**
   * Changes what new projects inherit, and answers with what actually settled.
   *
   * The folder is created here rather than at the next project, so a path that
   * cannot be made fails while the learner is still looking at the setting that
   * caused it — not minutes later, in a dialog about something else.
   */
  async setDefaults(input: { directory?: string | undefined; language?: Language | undefined }): Promise<ProjectDefaults> {
    if (input.directory !== undefined) {
      const directory = path.resolve(input.directory);
      if (!path.isAbsolute(directory)) throw new Error("A projects folder has to be an absolute path.");
      await mkdir(directory, { recursive: true });
      this.store.setSetting("projects-directory", directory);
    }
    if (input.language !== undefined) this.store.setSetting("projects-language", input.language);
    return this.defaults();
  }

  async create(input: {
    name: string;
    goal: string;
    parentDirectory?: string | undefined;
    language: Language;
    /** What the learner already holds, chosen from the atlas. Seeds `learner.md`
     *  so the first turn knows what not to re-teach. */
    foundation?: Array<{ title: string; level: number }> | undefined;
  }): Promise<ProjectSummary> {
    const parent = input.parentDirectory ?? this.defaults().directory;
    /* The default folder is created on demand; one the learner named is not.
       A missing default is Construct's own housekeeping — it is the folder we
       chose — while a missing chosen folder means the path is wrong or the disk
       is gone, and silently making it somewhere unexpected is worse than saying
       so. */
    if (!input.parentDirectory) await mkdir(parent, { recursive: true });
    else if (!existsSync(parent)) throw new Error("That folder no longer exists. Pick another one.");

    const directory = availableDirectory(parent, directorySlug(input.name));
    await mkdir(directory, { recursive: true });

    /* Nothing is written into it but `.construct`.
       
       A new project used to arrive with a main.ts or a main.py in it, printing
       the word Construct. It was meant as somewhere to start and it is the
       opposite: the first thing the learner sees is code they did not write and
       did not ask for, in a file the agent is about to want to talk about, and
       the empty folder they were promised is already not empty. The first file
       is written when the first step calls for one, by whichever of them is
       writing it.
       
       No GOAL.md either. The goal is written into `.construct/project.md` along with
       everything else Construct remembers, which is where v0.7 kept it — one
       place the learner can read and edit, rather than a file at the top of
       their repository that only Construct writes and nothing reads back. */

    const project = this.store.createProject({ name: input.name, goal: input.goal, directory, language: input.language });
    await this.memory.ensure(project, input.foundation, this.intake());
    return project;
  }

  async import(input: { directory: string; goal: string }): Promise<ProjectSummary> {
    if (!existsSync(input.directory)) throw new Error("That folder no longer exists. Pick another one.");

    const existing = this.store.readProjectAt(input.directory);
    if (existing) return existing;

    const project = this.store.createProject({
      name: path.basename(input.directory) || "Project",
      goal: input.goal,
      directory: input.directory,
      language: await dominantLanguage(input.directory),
    });
    /* An imported project gets memory too. It is an existing codebase, so
       research and the path have more to work from, not less. */
    await this.memory.ensure(project, undefined, this.intake());
    return project;
  }

  /** Opens a project and stamps it, which is also what orders the project list. */
  open(projectId: string): ProjectDetail {
    const summary = this.store.readProject(projectId);
    if (!summary) throw new Error("That project is no longer in Construct.");
    if (!summary.present) throw new Error(`Construct cannot find ${summary.directory}. It may have been moved or deleted.`);

    this.store.markOpened(projectId);
    /* The thread, read back from the store.
       
       This returned an empty array with a note saying the agent had not landed
       yet. The agent landed; the note did not move. Every message has been
       written to `agent_messages` the whole time, so leaving a project and
       coming back threw away a conversation that was sitting on disk — the
       window simply never asked for it. */
    return {
      summary: this.store.readProject(projectId) ?? summary,
      messages: this.store.listMessages(projectId),
      /* Still the agent's to answer. A question is only pending while the run
         that asked it is alive, and runs do not outlive the process. */
      pendingLearnerQuestion: null,
    };
  }

  rename(projectId: string, name: string): void {
    this.store.renameProject(projectId, name);
  }

  setPinned(projectId: string, pinned: boolean): void {
    this.store.setPinned(projectId, pinned);
  }

  setArchived(projectId: string, archived: boolean): void {
    this.store.setArchived(projectId, archived);
  }

  /** Forgets the project. Never touches the directory — see ProjectStore. */
  delete(projectId: string): void {
    this.store.deleteProject(projectId);
  }
}

/** What language an imported directory is mostly written in.
 *
 *  A shallow count is deliberate. This decides which syntax mode and language
 *  server to start, and being wrong costs a menu change; walking a repository
 *  with a deep node_modules to be more certain would cost seconds of the
 *  learner's time on every import. */
async function dominantLanguage(directory: string): Promise<Language> {
  const { languageForPath } = await import("@construct/domain");
  const counts = new Map<Language, number>();

  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const language = languageForPath(entry.name);
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  if (!counts.size) {
    const nested = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules");
    for (const child of nested.slice(0, 5)) {
      const inner = await readdir(path.join(directory, child.name), { withFileTypes: true }).catch(() => []);
      for (const entry of inner) {
        const language = entry.isDirectory() ? null : languageForPath(entry.name);
        if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
      }
    }
  }

  let best: Language = "typescript";
  let bestCount = 0;
  for (const [language, count] of counts) {
    if (count > bestCount) {
      best = language;
      bestCount = count;
    }
  }
  return best;
}
