import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Language } from "@construct/domain";
import type { ProjectDetail, ProjectSummary } from "../../shared/api.js";
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

const SEED: Record<Language, { file: string; content: string } | null> = {
  typescript: { file: "main.ts", content: 'export function main(): void {\n  console.log("Construct");\n}\n\nmain();\n' },
  javascript: { file: "main.js", content: 'function main() {\n  console.log("Construct");\n}\n\nmain();\n' },
  python: { file: "main.py", content: 'def main() -> None:\n    print("Construct")\n\n\nif __name__ == "__main__":\n    main()\n' },
  java: null,
  c: null,
  cpp: null,
  go: null,
  rust: null,
  swift: null,
  ruby: null,
};

/**
 * Projects as directories on the learner's disk.
 *
 * Construct does not own a project's files. Creating one makes a directory and
 * a single entry point; importing one adopts a directory that already has
 * files in it. Everything after that is the learner's, which is why the store
 * records only where a project is and deleting one never removes it.
 */
export class ProjectService {
  constructor(private readonly store: ProjectStore) {}

  list(): ProjectSummary[] {
    return this.store.listProjects();
  }

  async create(input: { name: string; goal: string; parentDirectory: string; language: Language }): Promise<ProjectSummary> {
    if (!existsSync(input.parentDirectory)) throw new Error("That folder no longer exists. Pick another one.");

    const directory = availableDirectory(input.parentDirectory, directorySlug(input.name));
    await mkdir(directory, { recursive: true });

    const seed = SEED[input.language];
    if (seed) await writeFile(path.join(directory, seed.file), seed.content, "utf8");
    /* The goal is written into the project rather than kept only in Construct's
       database. A learner who opens the directory in another editor, or comes
       back to it in a year, should still find what they set out to build. */
    await writeFile(path.join(directory, "GOAL.md"), `# ${input.name}\n\n${input.goal}\n`, "utf8");

    return this.store.createProject({ name: input.name, goal: input.goal, directory, language: input.language });
  }

  async import(input: { directory: string; goal: string }): Promise<ProjectSummary> {
    if (!existsSync(input.directory)) throw new Error("That folder no longer exists. Pick another one.");

    const existing = this.store.readProjectAt(input.directory);
    if (existing) return existing;

    return this.store.createProject({
      name: path.basename(input.directory) || "Project",
      goal: input.goal,
      directory: input.directory,
      language: await dominantLanguage(input.directory),
    });
  }

  /** Opens a project and stamps it, which is also what orders the project list. */
  open(projectId: string): ProjectDetail {
    const summary = this.store.readProject(projectId);
    if (!summary) throw new Error("That project is no longer in Construct.");
    if (!summary.present) throw new Error(`Construct cannot find ${summary.directory}. It may have been moved or deleted.`);

    this.store.markOpened(projectId);
    /* Messages and the pending question are the agent's, and the agent lands in
       M3. An empty thread is the honest answer for a project nobody has talked
       to yet, and it is the same shape one with history will have. */
    return { summary: this.store.readProject(projectId) ?? summary, messages: [], pendingLearnerQuestion: null };
  }

  rename(projectId: string, name: string): void {
    this.store.renameProject(projectId, name);
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
