export function normalizeWorkspacePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

export function normalizeOptionalWorkspacePath(path: string | null | undefined, workspacePath?: string): string | null {
  if (!path) {
    return null;
  }

  const withoutFileScheme = path.replace(/^file:\/\//, "");
  if (isAbsoluteFilesystemPath(withoutFileScheme)) {
    if (!workspacePath) {
      return null;
    }

    const relative = relativeWorkspacePath(workspacePath, withoutFileScheme);
    if (!relative) {
      console.warn("[construct] Ignoring absolute path outside workspace", {
        path,
        workspacePath
      });
      return null;
    }

    return relative;
  }

  const normalized = normalizeWorkspacePath(withoutFileScheme);
  return normalized || null;
}

export function isAbsoluteFilesystemPath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

export function relativeWorkspacePath(workspacePath: string, absolutePath: string): string | null {
  const normalizedWorkspace = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedAbsolute = absolutePath.replace(/\\/g, "/");
  if (normalizedAbsolute === normalizedWorkspace) {
    return "";
  }

  if (!normalizedAbsolute.startsWith(`${normalizedWorkspace}/`)) {
    return null;
  }

  return normalizeWorkspacePath(normalizedAbsolute.slice(normalizedWorkspace.length + 1));
}

export function generateCopyPath(srcPath: string): string {
  const lastDot = srcPath.lastIndexOf(".");
  const lastSlash = srcPath.lastIndexOf("/");
  if (lastDot > lastSlash) {
    return `${srcPath.slice(0, lastDot)}_copy${srcPath.slice(lastDot)}`;
  }
  return `${srcPath}_copy`;
}
