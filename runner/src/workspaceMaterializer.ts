import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ProjectBlueprintSchema,
  getBlueprintMaterializedFilePaths,
  type ProjectBlueprint
} from "@construct/shared";

import { sanitizeMaterializedFileContent, sanitizeMaterializedFiles } from "./materializedFiles";

export type PreparedWorkspace = {
  blueprint: ProjectBlueprint;
  canonicalBlueprintPath: string;
  learnerBlueprintPath: string;
  learnerWorkspaceRoot: string;
  sourceProjectRoot: string;
  materializedFilePaths: string[];
};

export async function prepareLearnerWorkspace(
  canonicalBlueprintPath: string
): Promise<PreparedWorkspace> {
  const resolvedBlueprintPath = path.resolve(canonicalBlueprintPath);
  const blueprint = await loadBlueprintFromDisk(resolvedBlueprintPath);
  const sourceProjectRoot = path.dirname(resolvedBlueprintPath);
  const learnerWorkspaceRoot = path.join(
    sourceProjectRoot,
    ".construct",
    "workspaces",
    toWorkspaceDirectoryName(blueprint.id)
  );
  const learnerBlueprintPath = path.join(
    learnerWorkspaceRoot,
    path.basename(resolvedBlueprintPath)
  );
  const materializedFilePaths = await collectMaterializedWorkspacePaths(
    blueprint,
    sourceProjectRoot
  );

  if (!existsSync(learnerBlueprintPath)) {
    await materializeWorkspace({
      blueprint,
      sourceProjectRoot,
      learnerWorkspaceRoot,
      learnerBlueprintPath,
      materializedFilePaths
    });
  } else {
    await syncMissingMaterializedFiles({
      blueprint,
      sourceProjectRoot,
      learnerWorkspaceRoot,
      materializedFilePaths
    });
  }

  return {
    blueprint,
    canonicalBlueprintPath: resolvedBlueprintPath,
    learnerBlueprintPath,
    learnerWorkspaceRoot,
    sourceProjectRoot,
    materializedFilePaths
  };
}

async function materializeWorkspace(input: {
  blueprint: ProjectBlueprint;
  sourceProjectRoot: string;
  learnerWorkspaceRoot: string;
  learnerBlueprintPath: string;
  materializedFilePaths: string[];
}): Promise<void> {
  const sanitizedFiles = sanitizeMaterializedFiles(input.blueprint.files);

  await rm(input.learnerWorkspaceRoot, { recursive: true, force: true });
  await mkdir(input.learnerWorkspaceRoot, { recursive: true });

  for (const relativePath of input.materializedFilePaths) {
    const sourcePath = path.join(input.sourceProjectRoot, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const destinationPath = path.join(input.learnerWorkspaceRoot, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, {
      recursive: true
    });
  }

  for (const [relativePath, contents] of Object.entries(sanitizedFiles)) {
    const destinationPath = path.join(input.learnerWorkspaceRoot, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(
      destinationPath,
      sanitizeMaterializedFileContent(relativePath, contents),
      "utf8"
    );
  }

  const learnerBlueprint = {
    ...input.blueprint,
    files: sanitizedFiles,
    projectRoot: input.learnerWorkspaceRoot
  };

  await writeFile(
    input.learnerBlueprintPath,
    `${JSON.stringify(learnerBlueprint, null, 2)}\n`,
    "utf8"
  );
}

async function syncMissingMaterializedFiles(input: {
  blueprint: ProjectBlueprint;
  sourceProjectRoot: string;
  learnerWorkspaceRoot: string;
  materializedFilePaths: string[];
}): Promise<void> {
  for (const relativePath of input.materializedFilePaths) {
    const sourcePath = path.join(input.sourceProjectRoot, relativePath);
    const destinationPath = path.join(input.learnerWorkspaceRoot, relativePath);
    if (!existsSync(sourcePath) || existsSync(destinationPath)) {
      continue;
    }

    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, {
      recursive: true
    });
  }
}

async function collectMaterializedWorkspacePaths(
  blueprint: Pick<ProjectBlueprint, "entrypoints" | "files" | "steps" | "frontier" | "spine">,
  sourceProjectRoot: string
): Promise<string[]> {
  const materializedPaths = new Set(getBlueprintMaterializedFilePaths(blueprint));
  const queue = [...materializedPaths];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const relativePath = queue.shift();
    if (!relativePath || visited.has(relativePath)) {
      continue;
    }
    visited.add(relativePath);

    if (!LOCAL_DEPENDENCY_SCAN_PATH_PATTERN.test(relativePath)) {
      continue;
    }

    const sourcePath = path.join(sourceProjectRoot, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const content = await readFile(sourcePath, "utf8");
    for (const specifier of extractLocalModuleSpecifiers(content)) {
      const resolvedRelativePath = resolveRelativeModuleSpecifierPath(
        sourceProjectRoot,
        relativePath,
        specifier
      );
      if (!resolvedRelativePath || materializedPaths.has(resolvedRelativePath)) {
        continue;
      }
      materializedPaths.add(resolvedRelativePath);
      queue.push(resolvedRelativePath);
    }
  }

  return Array.from(materializedPaths).filter(Boolean).sort();
}

function extractLocalModuleSpecifiers(source: string): string[] {
  const localSpecifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]?.trim();
      if (specifier && specifier.startsWith(".")) {
        localSpecifiers.add(specifier);
      }
    }
  }

  return Array.from(localSpecifiers);
}

function resolveRelativeModuleSpecifierPath(
  sourceProjectRoot: string,
  importerRelativePath: string,
  specifier: string
): string | null {
  const importerDirectory = path.dirname(path.join(sourceProjectRoot, importerRelativePath));
  const candidateBase = path.resolve(importerDirectory, specifier);
  const candidatePaths = specifierExtensionCandidates(candidateBase);

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    const relativePath = path.relative(sourceProjectRoot, candidatePath);
    if (relativePath.startsWith("..")) {
      continue;
    }
    return relativePath.split(path.sep).join("/");
  }

  return null;
}

function specifierExtensionCandidates(candidateBase: string): string[] {
  const extension = path.extname(candidateBase);
  if (extension) {
    return [candidateBase];
  }

  const candidates: string[] = [];
  for (const suffix of LOCAL_DEPENDENCY_FILE_SUFFIXES) {
    candidates.push(`${candidateBase}${suffix}`);
  }
  for (const suffix of LOCAL_DEPENDENCY_FILE_SUFFIXES) {
    candidates.push(path.join(candidateBase, `index${suffix}`));
  }
  return candidates;
}

const LOCAL_DEPENDENCY_SCAN_PATH_PATTERN = /\.(?:[cm]?[jt]sx?|mts|cts|json)$/i;
const LOCAL_DEPENDENCY_FILE_SUFFIXES = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".json"
];

async function loadBlueprintFromDisk(blueprintPath: string): Promise<ProjectBlueprint> {
  const rawBlueprint = await readFile(blueprintPath, "utf8");
  return ProjectBlueprintSchema.parse(JSON.parse(rawBlueprint));
}

function toWorkspaceDirectoryName(blueprintId: string): string {
  return blueprintId.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
