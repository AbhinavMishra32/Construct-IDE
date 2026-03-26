const SANITIZED_JSON_PATH = /(^|\/)(package\.json|turbo\.json|tsconfig(?:\.[^/]+)?\.json)$/i;

export function sanitizeMaterializedFileContent(
  relativePath: string,
  contents: string
): string {
  const normalizedPath = relativePath.replace(/\\/g, "/");

  if (!SANITIZED_JSON_PATH.test(normalizedPath)) {
    return contents;
  }

  const withoutTaskComments = contents.replace(/\n[ \t]*\/\/\s*TASK:[^\n]*/g, "");
  return withoutTaskComments.endsWith("\n") ? withoutTaskComments : `${withoutTaskComments}\n`;
}

export function sanitizeMaterializedFiles(
  files: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([relativePath, contents]) => [
      relativePath,
      sanitizeMaterializedFileContent(relativePath, contents)
    ])
  );
}
