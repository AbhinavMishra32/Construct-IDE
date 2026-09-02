/**
 * One palette for every surface that shows code.
 *
 * Three places render code and, until this existed, all three decided their own
 * colours: the editor from a hard-coded pair of palettes in `monaco-theme.ts`,
 * the agent transcript from `--code-*` CSS tokens, and inline code from
 * `--muted` — which is not a code colour at all. A snippet in chat and the same
 * snippet in the editor were different pictures of the same text.
 *
 * So the palette is data, and both consumers derive from it. Monaco is fed a
 * theme built from these slots; the renderer writes the same slots onto the
 * document as CSS variables. Neither holds its own copy, which is the only way
 * they stay in step.
 *
 * The slot names are ours, not TextMate's. A VSCode theme carries hundreds of
 * scopes; mapping them down to this many is a deliberate narrowing — see
 * `fromVsCodeTheme`.
 */
export type CodeSlots = {
  /** The editor canvas, and the fill behind a code block in chat. */
  background: string;
  foreground: string;
  /** Chrome the editor needs and chat does not. */
  selection: string;
  lineHighlight: string;
  lineNumber: string;
  lineNumberActive: string;
  border: string;
  /** The raised surface Monaco's own menus and hovers sit on. */
  surface: string;

  comment: string;
  keyword: string;
  type: string;
  entity: string;
  string: string;
  number: string;
  punctuation: string;
  variable: string;
  constant: string;
  operator: string;
};

export type CodeTheme = {
  id: string;
  name: string;
  /** Which app appearance this palette belongs under. A theme is only offered
   *  for the appearance it was built for: a light palette on a dark window is
   *  not a preference, it is a mistake. */
  appearance: "light" | "dark";
  /** Absent for the two that ship with Construct, set for anything imported, so
   *  the settings list can say where a theme came from and offer to remove it. */
  source?: string;
  slots: CodeSlots;
};

/* The built-ins are the palettes the app already used, moved here verbatim so
   that introducing the theme layer changed nothing about how Construct looks.
   The dark background is `--popover` — the editor shares a surface with the
   panel holding it, and a seam inside a panel is the thing that arrangement
   exists to avoid. */
export const CONSTRUCT_LIGHT: CodeTheme = {
  id: "construct-light",
  name: "Construct Light",
  appearance: "light",
  slots: {
    background: "#fcfcfc",
    foreground: "#33363b",
    selection: "#dcdcdc",
    lineHighlight: "#f5f5f5",
    lineNumber: "#a3a3a3",
    lineNumberActive: "#0a0a0a",
    border: "#e4e4e4",
    surface: "#ffffff",
    comment: "#727780",
    keyword: "#ce2734",
    type: "#7b4bd2",
    entity: "#1a6fc9",
    string: "#185a96",
    number: "#1660b5",
    punctuation: "#6f747c",
    variable: "#33363b",
    constant: "#1660b5",
    operator: "#6f747c",
  },
};

export const CONSTRUCT_DARK: CodeTheme = {
  id: "construct-dark",
  name: "Construct Dark",
  appearance: "dark",
  slots: {
    background: "#191919",
    foreground: "#c9d1d9",
    selection: "#2e2e2e",
    lineHighlight: "#212121",
    lineNumber: "#555555",
    lineNumberActive: "#fafafa",
    border: "#2b2b2b",
    surface: "#222222",
    comment: "#8b949e",
    keyword: "#ff8177",
    type: "#d2a8ff",
    entity: "#66b8ff",
    string: "#8bd891",
    number: "#79c0ff",
    punctuation: "#b3bac2",
    variable: "#c9d1d9",
    constant: "#79c0ff",
    operator: "#b3bac2",
  },
};

export const BUILT_IN_CODE_THEMES: readonly CodeTheme[] = [CONSTRUCT_LIGHT, CONSTRUCT_DARK];

export const DEFAULT_CODE_THEMES: { light: string; dark: string } = {
  light: CONSTRUCT_LIGHT.id,
  dark: CONSTRUCT_DARK.id,
};

/** Which theme each appearance uses, plus whatever has been imported. Held in
 *  settings so it survives a restart and follows the account, not the window. */
export type CodeThemeSettings = {
  light: string;
  dark: string;
  imported: CodeTheme[];
};

export const EMPTY_CODE_THEME_SETTINGS: CodeThemeSettings = {
  ...DEFAULT_CODE_THEMES,
  imported: [],
};

export function codeThemesFor(settings: CodeThemeSettings, appearance: "light" | "dark"): CodeTheme[] {
  return [...BUILT_IN_CODE_THEMES, ...settings.imported].filter((theme) => theme.appearance === appearance);
}

/** The theme to draw with, falling back to the built-in for that appearance —
 *  a removed or malformed import must never leave the editor unpainted. */
export function resolveCodeTheme(settings: CodeThemeSettings, appearance: "light" | "dark"): CodeTheme {
  const wanted = appearance === "dark" ? settings.dark : settings.light;
  const fallback = appearance === "dark" ? CONSTRUCT_DARK : CONSTRUCT_LIGHT;
  return codeThemesFor(settings, appearance).find((theme) => theme.id === wanted) ?? fallback;
}

/* ---- VSCode import -------------------------------------------------------
   A `.json` theme carries `colors` (the chrome) and `tokenColors` (an ordered
   list of TextMate rules). Later rules win, so the scan runs forwards and keeps
   overwriting: that is the same precedence VSCode itself applies. */

type VsCodeTokenColor = { scope?: string | string[]; settings?: { foreground?: string } };
export type VsCodeTheme = {
  name?: string;
  type?: string;
  colors?: Record<string, string>;
  tokenColors?: VsCodeTokenColor[];
};

/** Our slots, and the TextMate scopes each one answers to. First match wins per
 *  rule, so the more specific scope is listed first within a slot. */
export const SCOPE_MAP: Array<[keyof CodeSlots, string[]]> = [
  ["comment", ["comment", "punctuation.definition.comment"]],
  ["keyword", ["keyword", "keyword.control", "storage", "storage.type", "keyword.operator.new"]],
  ["type", ["entity.name.type", "support.type", "support.class", "entity.name.class"]],
  ["entity", ["entity.name.function", "support.function", "meta.function-call"]],
  ["string", ["string", "string.quoted"]],
  ["number", ["constant.numeric"]],
  ["constant", ["constant.language", "constant.other", "variable.other.constant"]],
  ["variable", ["variable", "variable.other", "variable.parameter"]],
  ["operator", ["keyword.operator"]],
  ["punctuation", ["punctuation", "meta.brace"]],
];

const hex = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  /* Alpha is dropped rather than blended: Monaco's token rules take opaque hex,
     and a colour that arrives half-transparent would otherwise be applied at
     full strength and read as a different colour entirely. */
  const match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(trimmed);
  return match ? `#${match[1]!.toLowerCase()}` : null;
};

/**
 * Turns a parsed VSCode theme into one of ours.
 *
 * Lossy on purpose. VSCode themes address hundreds of scopes and Construct
 * paints ten; a faithful import would mean shipping a TextMate grammar engine to
 * render a chat bubble. What comes across is the chrome and the ten token
 * families that carry a snippet's shape, and anything unmatched inherits the
 * foreground — which is what an unstyled scope does in VSCode too.
 */
export function fromVsCodeTheme(raw: VsCodeTheme, id: string, source: string): CodeTheme {
  const appearance: "light" | "dark" = raw.type === "light" ? "light" : "dark";
  const base = appearance === "dark" ? CONSTRUCT_DARK : CONSTRUCT_LIGHT;
  const colors = raw.colors ?? {};
  const slots: CodeSlots = { ...base.slots };

  const chrome: Array<[keyof CodeSlots, string]> = [
    ["background", "editor.background"],
    ["foreground", "editor.foreground"],
    ["selection", "editor.selectionBackground"],
    ["lineHighlight", "editor.lineHighlightBackground"],
    ["lineNumber", "editorLineNumber.foreground"],
    ["lineNumberActive", "editorLineNumber.activeForeground"],
    ["border", "editorGroup.border"],
    ["surface", "editorWidget.background"],
  ];
  for (const [slot, key] of chrome) {
    const value = hex(colors[key]);
    if (value) slots[slot] = value;
  }

  for (const rule of raw.tokenColors ?? []) {
    const foreground = hex(rule.settings?.foreground);
    if (!foreground) continue;
    const scopes = (Array.isArray(rule.scope) ? rule.scope : (rule.scope ?? "").split(","))
      .map((scope) => scope.trim())
      .filter(Boolean);

    for (const [slot, wanted] of SCOPE_MAP) {
      /* Prefix match, because a theme may style `string.quoted.double.js` and
         mean every string. */
      if (scopes.some((scope) => wanted.some((target) => scope === target || scope.startsWith(`${target}.`)))) {
        slots[slot] = foreground;
      }
    }
  }

  return {
    id,
    name: raw.name?.trim() || "Imported theme",
    appearance,
    source,
    slots,
  };
}
