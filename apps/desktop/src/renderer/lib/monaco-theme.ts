import { SCOPE_MAP, type CodeTheme } from "../../shared/codeTheme";

/**
 * The editor's half of the shared code theme.
 *
 * The palette used to live here as two hard-coded literals, which is how the
 * editor and the agent transcript came to disagree about what a keyword looks
 * like. It lives in `shared/codeTheme.ts` now; this file only turns a palette
 * into the shape the editor wants and hands it over.
 *
 * That shape changed with the move to the VSCode editor API. There is no
 * `defineTheme` any more — colouring is TextMate's, driven by a real VSCode
 * colour theme — so a palette is expressed the way a learner would express it
 * in `settings.json`: pick one of the two built-in themes for the appearance,
 * then override its chrome and its token colours. The result is the same
 * palette applied to grammars for every language Construct knows, rather than
 * the four Monarch grammars the old build shipped.
 */

/** Which built-in theme the customizations sit on top of. Modern rather than
 *  Plus: its defaults for anything Construct does not name — widgets, rulers,
 *  the peek view — are the quieter set. */
const BASE_THEME = { light: "Default Light Modern", dark: "Default Dark Modern" } as const;

/**
 * A palette as user configuration.
 *
 * Returned as JSON text because that is what the configuration service takes;
 * it is written once before the services start and again whenever the palette
 * or the appearance changes.
 */
export function codeThemeConfiguration(theme: CodeTheme): string {
  const palette = theme.slots;

  return JSON.stringify({
    "workbench.colorTheme": BASE_THEME[theme.appearance],
    /* Unscoped on purpose. Scoping these to the base theme's name would mean
       re-emitting them under a different key every time the appearance flips,
       and there is only ever one theme active here anyway. */
    "editor.tokenColorCustomizations": {
      textMateRules: SCOPE_MAP.map(([slot, scopes]) => ({
        scope: scopes,
        settings: { foreground: palette[slot], ...(slot === "comment" ? { fontStyle: "italic" } : {}) },
      })),
    },
    "workbench.colorCustomizations": {
      "editor.background": palette.background,
      "editor.foreground": palette.foreground,
      "editorGutter.background": palette.background,
      "editor.lineHighlightBackground": palette.lineHighlight,
      "editor.selectionBackground": palette.selection,
      "editorLineNumber.foreground": palette.lineNumber,
      "editorLineNumber.activeForeground": palette.lineNumberActive,
      "editorIndentGuide.background1": palette.border,
      "editorWidget.background": palette.surface,
      "editorWidget.border": palette.border,
      "editorSuggestWidget.background": palette.surface,
      "editorHoverWidget.background": palette.surface,
      "editorHoverWidget.border": palette.border,
      "scrollbarSlider.background": `${palette.border}cc`,
      "scrollbarSlider.hoverBackground": palette.selection,
      "editorOverviewRuler.border": palette.background,
    },
    /* Editor options that used to be constructor arguments. They belong in
       configuration now so the settings the language client contributes —
       suggestions, hovers, formatting — read the same values. */
    "editor.fontSize": 13,
    "editor.fontFamily": "ui-monospace, SFMono-Regular, Menlo, monospace",
    "editor.minimap.enabled": false,
    "editor.scrollBeyondLastLine": false,
    "editor.renderLineHighlight": "line",
    "editor.smoothScrolling": true,
    "editor.guides.indentation": true,
  });
}
