import type { editor } from "monaco-editor";

export type CodeThemeId = "construct" | "github" | "solarized" | "custom";
export type CodeThemeMode = "light" | "dark";

export type CodeThemeTokens = {
  background: string;
  header: string;
  foreground: string;
  comment: string;
  keyword: string;
  type: string;
  function: string;
  property: string;
  variable: string;
  operator: string;
  number: string;
  string: string;
  constant: string;
  punctuation: string;
  inlineBackground: string;
  inlineBorder: string;
  selection: string;
  inactiveSelection: string;
  lineHighlight: string;
  cursor: string;
};

export type CodeThemeDefinition = {
  name: string;
  light: Partial<CodeThemeTokens>;
  dark: Partial<CodeThemeTokens>;
};

export type CodeThemePreset = {
  id: Exclude<CodeThemeId, "custom">;
  label: string;
  description: string;
  definition: CodeThemeDefinition;
};

const constructDefinition: CodeThemeDefinition = {
  name: "Construct",
  light: {
    background: "color-mix(in srgb, var(--muted) 30%, transparent)",
    header: "color-mix(in srgb, var(--muted) 50%, transparent)",
    foreground: "#33363b",
    comment: "#727780",
    keyword: "#ce2734",
    type: "#7b4bd2",
    function: "#1a6fc9",
    property: "#a45317",
    variable: "#a45317",
    operator: "#c73541",
    number: "#1660b5",
    string: "#185a96",
    constant: "#1660b5",
    punctuation: "#6f747c",
    inlineBackground: "color-mix(in srgb, var(--muted) 88%, transparent)",
    inlineBorder: "color-mix(in srgb, var(--border) 82%, var(--foreground) 8%)",
    selection: "#d9e6f2",
    inactiveSelection: "#d9e6f2aa",
    lineHighlight: "#f3f4f677",
    cursor: "#1a6fc9"
  },
  dark: {
    background: "color-mix(in srgb, var(--muted) 30%, transparent)",
    header: "color-mix(in srgb, var(--muted) 50%, transparent)",
    foreground: "#c9d1d9",
    comment: "#8b949e",
    keyword: "#ff8177",
    type: "#d2a8ff",
    function: "#66b8ff",
    property: "#ffad66",
    variable: "#ffad66",
    operator: "#ff8177",
    number: "#79c0ff",
    string: "#8bd891",
    constant: "#79c0ff",
    punctuation: "#b3bac2",
    inlineBackground: "color-mix(in srgb, var(--muted) 78%, transparent)",
    inlineBorder: "color-mix(in srgb, var(--border) 82%, var(--foreground) 8%)",
    selection: "#27496d",
    inactiveSelection: "#27496d88",
    lineHighlight: "#2a2a2a66",
    cursor: "#66b8ff"
  }
};

export const codeThemePresets: CodeThemePreset[] = [
  {
    id: "construct",
    label: "Construct",
    description: "Construct-native surfaces with a tuned GitHub-like syntax palette.",
    definition: constructDefinition
  },
  {
    id: "github",
    label: "GitHub",
    description: "Primer-inspired syntax colors while preserving Construct code surfaces.",
    definition: {
      name: "GitHub",
      light: {
        keyword: "#cf222e",
        type: "#8250df",
        function: "#8250df",
        property: "#953800",
        variable: "#953800",
        operator: "#cf222e",
        number: "#0550ae",
        string: "#0a3069",
        constant: "#0550ae",
        punctuation: "#57606a",
        comment: "#6e7781",
        cursor: "#0969da",
        selection: "#0969da33",
        inactiveSelection: "#0969da22"
      },
      dark: {
        keyword: "#ff7b72",
        type: "#d2a8ff",
        function: "#d2a8ff",
        property: "#ffa657",
        variable: "#ffa657",
        operator: "#ff7b72",
        number: "#79c0ff",
        string: "#a5d6ff",
        constant: "#79c0ff",
        punctuation: "#8b949e",
        comment: "#8b949e",
        cursor: "#58a6ff",
        selection: "#58a6ff33",
        inactiveSelection: "#58a6ff22"
      }
    }
  },
  {
    id: "solarized",
    label: "Solarized",
    description: "Lower-contrast, warm/cool syntax colors for longer reading sessions.",
    definition: {
      name: "Solarized",
      light: {
        foreground: "#586e75",
        comment: "#93a1a1",
        keyword: "#859900",
        type: "#b58900",
        function: "#268bd2",
        property: "#cb4b16",
        variable: "#657b83",
        operator: "#2aa198",
        number: "#d33682",
        string: "#2aa198",
        constant: "#6c71c4",
        punctuation: "#657b83",
        cursor: "#268bd2",
        selection: "#eee8d5",
        inactiveSelection: "#eee8d5aa"
      },
      dark: {
        foreground: "#93a1a1",
        comment: "#657b83",
        keyword: "#859900",
        type: "#b58900",
        function: "#268bd2",
        property: "#cb4b16",
        variable: "#93a1a1",
        operator: "#2aa198",
        number: "#d33682",
        string: "#2aa198",
        constant: "#6c71c4",
        punctuation: "#839496",
        cursor: "#268bd2",
        selection: "#073642",
        inactiveSelection: "#073642aa"
      }
    }
  }
];

const presetMap = new Map<CodeThemeId, CodeThemePreset>(codeThemePresets.map((preset) => [preset.id, preset]));
let activeCodeThemeDefinition = constructDefinition;

export function normalizeCodeThemeId(value: string | undefined): CodeThemeId {
  return value === "github" || value === "solarized" || value === "custom" ? value : "construct";
}

export function getCodeThemePreset(id: CodeThemeId): CodeThemePreset {
  return presetMap.get(id) ?? codeThemePresets[0];
}

export function presetCodeThemeJson(id: Exclude<CodeThemeId, "custom">): string {
  return `${JSON.stringify(getCodeThemePreset(id).definition, null, 2)}\n`;
}

export function resolveCodeThemeDefinition(id: CodeThemeId, customJson?: string): CodeThemeDefinition {
  if (id !== "custom") return getCodeThemePreset(id).definition;
  const custom = parseCodeThemeJson(customJson);
  return mergeCodeThemeDefinitions(constructDefinition, custom ?? { name: "Custom", light: {}, dark: {} });
}

export function parseCodeThemeJson(json: string | undefined): CodeThemeDefinition | null {
  if (!json?.trim()) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    return {
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Custom",
      light: readTokenObject(record.light),
      dark: readTokenObject(record.dark)
    };
  } catch {
    return null;
  }
}

export function getActiveCodeThemeDefinition(): CodeThemeDefinition {
  return activeCodeThemeDefinition;
}

export function setActiveCodeThemeDefinition(definition: CodeThemeDefinition): void {
  activeCodeThemeDefinition = mergeCodeThemeDefinitions(constructDefinition, definition);
}

export function applyCodeThemeToDocument(definition: CodeThemeDefinition, mode: CodeThemeMode): void {
  if (typeof document === "undefined") return;
  const tokens = completeTokens(definition, mode);
  const root = document.documentElement;
  root.style.setProperty("--construct-code-background", tokens.background);
  root.style.setProperty("--construct-code-header", tokens.header);
  root.style.setProperty("--construct-code-foreground", tokens.foreground);
  root.style.setProperty("--construct-code-comment", tokens.comment);
  root.style.setProperty("--construct-code-keyword", tokens.keyword);
  root.style.setProperty("--construct-code-type", tokens.type);
  root.style.setProperty("--construct-code-function", tokens.function);
  root.style.setProperty("--construct-code-property", tokens.property);
  root.style.setProperty("--construct-code-variable", tokens.variable);
  root.style.setProperty("--construct-code-operator", tokens.operator);
  root.style.setProperty("--construct-code-number", tokens.number);
  root.style.setProperty("--construct-code-string", tokens.string);
  root.style.setProperty("--construct-code-constant", tokens.constant);
  root.style.setProperty("--construct-code-punctuation", tokens.punctuation);
  root.style.setProperty("--construct-code-inline-background", tokens.inlineBackground);
  root.style.setProperty("--construct-code-inline-border", tokens.inlineBorder);
}

export function monacoThemeData(definition: CodeThemeDefinition, mode: CodeThemeMode): editor.IStandaloneThemeData {
  const tokens = completeTokens(definition, mode);
  const dark = mode === "dark";
  const background = dark ? "#181818" : "#ffffff";
  const lineNumber = dark ? "#5f666f" : "#9aa0a8";
  const indentGuide = dark ? "#2d3035" : "#e1e4e8";

  return {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: stripHash(tokens.foreground) },
      { token: "comment", foreground: stripHash(tokens.comment), fontStyle: "italic" },
      { token: "keyword", foreground: stripHash(tokens.keyword) },
      { token: "keyword.control", foreground: stripHash(tokens.keyword) },
      { token: "storage", foreground: stripHash(tokens.keyword) },
      { token: "storage.type", foreground: stripHash(tokens.keyword) },
      { token: "string", foreground: stripHash(tokens.string) },
      { token: "string.escape", foreground: stripHash(tokens.function) },
      { token: "number", foreground: stripHash(tokens.number) },
      { token: "constant", foreground: stripHash(tokens.constant) },
      { token: "constant.language", foreground: stripHash(tokens.constant) },
      { token: "regexp", foreground: stripHash(tokens.string) },
      { token: "type", foreground: stripHash(tokens.type) },
      { token: "type.identifier", foreground: stripHash(tokens.type) },
      { token: "namespace", foreground: stripHash(tokens.type) },
      { token: "interface", foreground: stripHash(tokens.type) },
      { token: "function", foreground: stripHash(tokens.function) },
      { token: "support.function", foreground: stripHash(tokens.function) },
      { token: "variable", foreground: stripHash(tokens.foreground) },
      { token: "variable.parameter", foreground: stripHash(tokens.variable) },
      { token: "variable.predefined", foreground: stripHash(tokens.variable) },
      { token: "attribute.name", foreground: stripHash(tokens.property) },
      { token: "tag", foreground: stripHash(tokens.keyword) },
      { token: "delimiter", foreground: stripHash(tokens.punctuation) },
      { token: "operator", foreground: stripHash(tokens.operator) },
      { token: "key", foreground: stripHash(tokens.property) }
    ],
    colors: {
      "editor.background": background,
      "editor.foreground": tokens.foreground,
      "editorLineNumber.foreground": lineNumber,
      "editorLineNumber.activeForeground": tokens.function,
      "editor.lineHighlightBackground": tokens.lineHighlight,
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": tokens.selection,
      "editor.inactiveSelectionBackground": tokens.inactiveSelection,
      "editor.selectionHighlightBackground": tokens.inactiveSelection,
      "editor.wordHighlightBackground": `${hexOnly(tokens.function)}22`,
      "editorCursor.foreground": tokens.cursor,
      "editorIndentGuide.background1": indentGuide,
      "editorIndentGuide.activeBackground1": lineNumber,
      "editorWhitespace.foreground": indentGuide,
      "editorBracketMatch.background": `${hexOnly(tokens.function)}22`,
      "editorBracketMatch.border": `${hexOnly(tokens.function)}66`,
      "editorGutter.background": background,
      "editorBracketHighlight.foreground1": tokens.keyword,
      "editorBracketHighlight.foreground2": tokens.type,
      "editorBracketHighlight.foreground3": tokens.function,
      "editorBracketHighlight.foreground4": tokens.property,
      "editorBracketHighlight.foreground5": tokens.number,
      "editorBracketHighlight.foreground6": tokens.string,
      "scrollbarSlider.background": dark ? "#ffffff10" : "#00000010",
      "scrollbarSlider.hoverBackground": dark ? "#ffffff20" : "#00000020",
      "scrollbarSlider.activeBackground": dark ? "#ffffff30" : "#00000030",
      "editorHoverWidget.background": `${background}00`,
      "editorHoverWidget.foreground": tokens.foreground,
      "editorHoverWidget.border": dark ? "#32343a66" : "#d0d0ca66"
    }
  };
}

function completeTokens(definition: CodeThemeDefinition, mode: CodeThemeMode): CodeThemeTokens {
  return {
    ...constructDefinition[mode],
    ...definition[mode]
  } as CodeThemeTokens;
}

function mergeCodeThemeDefinitions(base: CodeThemeDefinition, next: CodeThemeDefinition): CodeThemeDefinition {
  return {
    name: next.name || base.name,
    light: { ...base.light, ...next.light },
    dark: { ...base.dark, ...next.dark }
  };
}

function readTokenObject(value: unknown): Partial<CodeThemeTokens> {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const output: Partial<CodeThemeTokens> = {};
  for (const key of Object.keys(constructDefinition.light) as Array<keyof CodeThemeTokens>) {
    if (typeof input[key] === "string" && input[key].trim()) {
      output[key] = input[key].trim();
    }
  }
  return output;
}

function stripHash(value: string): string {
  return hexOnly(value).replace(/^#/, "");
}

function hexOnly(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#66b8ff";
}
