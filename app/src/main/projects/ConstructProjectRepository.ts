import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import type { ConstructDataPaths } from "../config/constructConfig";
import type { StoredProject } from "./ConstructProjectTypes";

export class ConstructProjectRepository {
  constructor(private readonly paths: ConstructDataPaths) {}

  async readAll(): Promise<StoredProject[]> {
    await mkdir(this.paths.projectsRoot, { recursive: true });

    if (!existsSync(this.paths.projectsManifestPath)) {
      return [];
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return (JSON.parse(await readFile(this.paths.projectsManifestPath, "utf8")) as StoredProject[])
          .map((project) => this.normalize(project));
      } catch (error) {
        if (attempt === 2) {
          console.error("[construct-projects] Failed to read project manifest.", error);
          return [];
        }

        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    return [];
  }

  async writeAll(projects: StoredProject[]): Promise<void> {
    await mkdir(this.paths.projectsRoot, { recursive: true });
    const target = this.paths.projectsManifestPath;
    const temporary = `${target}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  find(projects: StoredProject[], id: string): StoredProject {
    const project = projects.find((candidate) => candidate.id === id);

    if (!project) {
      throw new Error(`Unknown Construct project: ${id}`);
    }

    return project;
  }

  normalize(project: StoredProject): StoredProject {
    return {
      ...project,
      program: {
        ...project.program,
        references: project.program.references ?? [],
        targets: project.program.targets ?? []
      },
      assistance: project.assistance ?? {},
      verificationResults: project.verificationResults ?? {},
      fileTreeExpanded: project.fileTreeExpanded ?? [],
      typingProgress: project.typingProgress ?? {},
      editAnchors: project.editAnchors ?? {},
      completedBlocks: project.completedBlocks ?? {},
      completedAt: project.completedAt ?? null
    };
  }
}
