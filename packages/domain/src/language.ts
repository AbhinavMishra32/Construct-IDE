import { z } from "zod";

/**
 * The languages Construct can name in the interface — a file glyph, a code
 * fence, the label on a project.
 *
 * Nothing to do with language servers. This list used to be paired with a
 * narrower one saying which of them got real intelligence; which languages
 * Construct can analyse is the catalog's business now, it is keyed on file
 * extensions rather than on this enum, and it is far longer than this list
 * — see `shared/languageServers.ts` in the desktop app.
 */
export const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "java",
  "c",
  "cpp",
  "go",
  "rust",
  "swift",
  "ruby",
] as const;

export const languageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof languageSchema>;

const EXTENSION_LANGUAGE: Record<string, Language> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  pyi: "python",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  go: "go",
  rs: "rust",
  swift: "swift",
  rb: "ruby",
};

/** The language of a path, or null when Construct has no name for it. Null is a
 *  real answer here — a README or a lockfile is not a language failure. */
export function languageForPath(filePath: string): Language | null {
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (!extension) return null;
  return EXTENSION_LANGUAGE[extension] ?? null;
}
