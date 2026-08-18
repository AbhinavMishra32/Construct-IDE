export const RUST_ANALYZER_EXCLUDED_PATHS = [
  "target",
  ".git",
  ".construct",
  "node_modules",
  "dist"
] as const;

export const RUST_ANALYZER_SAFE_CONFIGURATION = {
  cachePriming: {
    enable: false,
    numThreads: 1
  },
  cargo: {
    allTargets: false,
    autoreload: false,
    buildScripts: {
      enable: false,
      rebuildOnSave: false,
      useRustcWrapper: false
    }
  },
  check: {
    allTargets: false,
    workspace: false
  },
  checkOnSave: false,
  completion: {
    limit: 200
  },
  diagnostics: {
    experimental: {
      enable: false
    },
    styleLints: {
      enable: false
    }
  },
  files: {
    exclude: [...RUST_ANALYZER_EXCLUDED_PATHS]
  },
  hover: {
    actions: {
      debug: {
        enable: false
      },
      run: {
        enable: false
      }
    }
  },
  numThreads: 2,
  procMacro: {
    attributes: {
      enable: true
    },
    enable: true,
    processes: 1
  }
} as const;

export function rustAnalyzerConfigurationForWorkspace(workspacePath?: string | null): Record<string, unknown> {
  const cargoTomlPath = workspacePath ? `${workspacePath.replace(/[\\/]+$/, "")}/Cargo.toml` : null;
  return {
    ...RUST_ANALYZER_SAFE_CONFIGURATION,
    ...(cargoTomlPath ? { linkedProjects: [cargoTomlPath] } : {})
  };
}

export function rustAnalyzerConfigurationForSection(section?: string | null, workspacePath?: string | null): unknown {
  const configuration = rustAnalyzerConfigurationForWorkspace(workspacePath);
  if (!section || section === "rust-analyzer") {
    return configuration;
  }

  const prefix = "rust-analyzer.";
  if (!section.startsWith(prefix)) {
    return null;
  }

  return valueAtPath(
    configuration,
    section.slice(prefix.length).split(".").filter(Boolean)
  );
}

function valueAtPath(value: unknown, path: string[]): unknown {
  let cursor = value;

  for (const segment of path) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
}
