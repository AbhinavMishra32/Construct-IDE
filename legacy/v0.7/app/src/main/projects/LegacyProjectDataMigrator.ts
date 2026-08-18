import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";

import type { ConstructDataPaths } from "../config/constructConfig";

export class LegacyProjectDataMigrator {
  constructor(private readonly paths: ConstructDataPaths) {}

  async migrateIfNeeded(): Promise<void> {
    if (existsSync(path.join(this.paths.projectsRoot, "projects.json"))) {
      return;
    }

    const legacy = this.legacyConstructProjectsRoot();
    if (!legacy) {
      return;
    }

    console.log("[construct] migrating project data from legacy location", { from: legacy, to: this.paths.projectsRoot });
    await mkdir(this.paths.projectsRoot, { recursive: true });
    try {
      const entries = await readdir(legacy, { withFileTypes: true });
      for (const entry of entries) {
        const src = path.join(legacy, entry.name);
        const dst = path.join(this.paths.projectsRoot, entry.name);
        if (entry.isDirectory()) {
          await cp(src, dst, { recursive: true, force: false });
        } else {
          await cp(src, dst, { force: false });
        }
      }
      console.log("[construct] migration complete");
    } catch (error) {
      console.error("[construct] migration failed", error);
    }
  }

  private legacyConstructProjectsRoot(): string | null {
    if (process.platform === "darwin") {
      const candidate = path.join(homedir(), "Library", "Application Support", "@construct", "app", "construct-projects");
      if (existsSync(path.join(candidate, "projects.json"))) {
        return candidate;
      }
    }
    return null;
  }
}
