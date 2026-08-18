import { z } from "zod";

/**
 * The languages Construct can name in the interface — a file glyph, a code
 * fence, an editor mode. This is deliberately wider than the set Construct has
 * language-server support for: the IDE opens files in languages it cannot yet
 * analyse, and refusing to label them would make the file tree read as broken.
 *
 * See `LSP_LANGUAGES` for the narrower set that gets real intelligence.
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

/** The languages a language server is shipped for. Everything else falls back
 *  to syntax highlighting alone. */
export const LSP_LANGUAGES = ["typescript", "javascript", "python"] as const satisfies readonly Language[];
export type LspLanguage = (typeof LSP_LANGUAGES)[number];

export function isLspLanguage(value: Language): value is LspLanguage {
  return (LSP_LANGUAGES as readonly Language[]).includes(value);
}

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
