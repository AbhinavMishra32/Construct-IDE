import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  EMPTY_CODE_THEME_SETTINGS,
  codeThemesFor,
  fromVsCodeTheme,
  resolveCodeTheme,
  type CodeSlots,
  type CodeTheme,
  type CodeThemeSettings,
  type VsCodeTheme,
} from "../../shared/codeTheme";
import { codeThemeConfiguration } from "@/lib/monaco-theme";
import { applyEditorConfiguration } from "@/lib/monaco/services";
import { useDark } from "./use-dark";

/**
 * The active code palette, applied everywhere code is drawn.
 *
 * Two consumers, one source. Monaco is handed a theme built from the palette;
 * the document gets the same palette as `--code-*` variables, which is what the
 * agent transcript and concept cards paint from. Neither keeps its own copy, so
 * a snippet in chat and the same snippet in the editor cannot drift apart —
 * which they had, because the editor's colours were hard-coded in one file and
 * chat's in another.
 *
 * Kept in `localStorage` rather than in the account, for the same reason the
 * workspace layout is: which palette you like and which themes you have
 * imported are properties of the machine you are sitting at, and a theme that
 * followed you onto a different screen with different calibration would be a
 * worse default than the one built for it. It also must never be the reason the
 * editor fails to paint — every read is guarded and falls back to the built-in.
 */
const KEY = "construct.codeTheme";

type CodeThemeContext = {
  settings: CodeThemeSettings;
  /** The palette in force for the current appearance. */
  theme: CodeTheme;
  /** Everything selectable for the current appearance. */
  available: CodeTheme[];
  appearance: "light" | "dark";
  select(id: string): void;
  /** Parses a VSCode theme's JSON. Returns the failure as a string rather than
   *  throwing, because the caller is a settings row that has to say what went
   *  wrong next to the button that caused it. */
  importTheme(json: string, source: string): string | null;
  remove(id: string): void;
};

const Context = createContext<CodeThemeContext | null>(null);

export function readCodeThemeSettings(): CodeThemeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_CODE_THEME_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CodeThemeSettings>;
    return {
      light: typeof parsed.light === "string" ? parsed.light : EMPTY_CODE_THEME_SETTINGS.light,
      dark: typeof parsed.dark === "string" ? parsed.dark : EMPTY_CODE_THEME_SETTINGS.dark,
      imported: Array.isArray(parsed.imported) ? parsed.imported.filter(isTheme) : [],
    };
  } catch {
    return EMPTY_CODE_THEME_SETTINGS;
  }
}

/** Structural, not exhaustive: an import written by an older version should be
 *  usable if it still has the shape the renderer reads. */
function isTheme(value: unknown): value is CodeTheme {
  if (!value || typeof value !== "object") return false;
  const theme = value as Partial<CodeTheme>;
  return typeof theme.id === "string" && typeof theme.name === "string" && !!theme.slots && typeof theme.slots === "object";
}

function write(settings: CodeThemeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* Quota or storage disabled. The palette still applies for this session. */
  }
}

/** camelCase slot to the `--code-*` variable the stylesheet reads. */
const variableFor = (slot: string) => `--code-${slot.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

export function CodeThemeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<CodeThemeSettings>(readCodeThemeSettings);
  const dark = useDark();
  const appearance: "light" | "dark" = dark ? "dark" : "light";
  const theme = useMemo(() => resolveCodeTheme(settings, appearance), [settings, appearance]);

  useEffect(() => {
    /* The editor first: it repaints when its configuration changes, and doing
       it before the variables means one frame rather than two with the editor
       and the chat disagreeing. */
    applyEditorConfiguration(codeThemeConfiguration(theme));

    const root = document.documentElement;
    for (const [slot, value] of Object.entries(theme.slots) as Array<[keyof CodeSlots, string]>) {
      root.style.setProperty(variableFor(slot), value);
    }
  }, [theme]);

  const update = useCallback((next: CodeThemeSettings) => {
    setSettings(next);
    write(next);
  }, []);

  const value = useMemo<CodeThemeContext>(
    () => ({
      settings,
      theme,
      appearance,
      available: codeThemesFor(settings, appearance),
      select: (id) => update({ ...settings, [appearance]: id }),
      remove: (id) => {
        const imported = settings.imported.filter((entry) => entry.id !== id);
        /* Selecting a theme and then deleting it must not leave the editor
           pointing at nothing, so the slot falls back with it. */
        const next: CodeThemeSettings = { ...settings, imported };
        if (next.light === id) next.light = EMPTY_CODE_THEME_SETTINGS.light;
        if (next.dark === id) next.dark = EMPTY_CODE_THEME_SETTINGS.dark;
        update(next);
      },
      importTheme: (json, source) => {
        let parsed: VsCodeTheme;
        try {
          parsed = JSON.parse(json) as VsCodeTheme;
        } catch {
          return "That file is not valid JSON.";
        }
        if (!parsed || typeof parsed !== "object" || (!parsed.colors && !parsed.tokenColors)) {
          return "That does not look like a VS Code colour theme.";
        }
        /* Keyed by source so re-importing the same file replaces it rather than
           stacking a second copy under a new id. */
        const id = `imported:${source}`;
        const next = fromVsCodeTheme(parsed, id, source);
        update({
          ...settings,
          imported: [...settings.imported.filter((entry) => entry.id !== id), next],
          [next.appearance]: id,
        });
        return null;
      },
    }),
    [appearance, settings, theme, update],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCodeTheme(): CodeThemeContext {
  const value = useContext(Context);
  if (!value) throw new Error("useCodeTheme must be used inside CodeThemeProvider");
  return value;
}
