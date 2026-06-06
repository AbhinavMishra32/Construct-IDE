import { monaco } from "../monaco";

/**
 * Custom Monaco themes for Construct.
 *
 * Stock `vs` / `vs-dark` look flat and washed-out against the app's warm
 * neutral palette. These themes give the editor a higher-contrast, more
 * deliberate syntax scheme that matches the codex token colors (accent green
 * #10a37f, warm grays) and reads well at 13–14px.
 */

let registered = false;

export const CONSTRUCT_LIGHT = "construct-light";
export const CONSTRUCT_DARK = "construct-dark";

export function registerConstructThemes() {
  if (registered) return;
  registered = true;

  monaco.editor.defineTheme(CONSTRUCT_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "1f1f1c" },
      { token: "comment", foreground: "9a958a", fontStyle: "italic" },
      { token: "keyword", foreground: "9b2393" },
      { token: "keyword.control", foreground: "9b2393" },
      { token: "storage", foreground: "9b2393" },
      { token: "storage.type", foreground: "9b2393" },
      { token: "string", foreground: "1a7f37" },
      { token: "string.escape", foreground: "0a7d6e" },
      { token: "number", foreground: "b05a00" },
      { token: "constant", foreground: "b05a00" },
      { token: "constant.language", foreground: "b05a00" },
      { token: "regexp", foreground: "0a7d6e" },
      { token: "type", foreground: "0a6b8a" },
      { token: "type.identifier", foreground: "0a6b8a" },
      { token: "namespace", foreground: "0a6b8a" },
      { token: "interface", foreground: "0a6b8a" },
      { token: "function", foreground: "8250df" },
      { token: "support.function", foreground: "8250df" },
      { token: "variable", foreground: "1f1f1c" },
      { token: "variable.parameter", foreground: "953800" },
      { token: "variable.predefined", foreground: "b05a00" },
      { token: "attribute.name", foreground: "0a6b8a" },
      { token: "tag", foreground: "116329" },
      { token: "delimiter", foreground: "57534e" },
      { token: "operator", foreground: "9b2393" },
      { token: "key", foreground: "0a6b8a" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#1f1f1c",
      "editorLineNumber.foreground": "#c4c0b6",
      "editorLineNumber.activeForeground": "#5f5f5a",
      "editor.lineHighlightBackground": "#f6f5f2",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#10a37f33",
      "editor.inactiveSelectionBackground": "#10a37f1f",
      "editor.selectionHighlightBackground": "#10a37f22",
      "editor.wordHighlightBackground": "#10a37f1a",
      "editorCursor.foreground": "#10a37f",
      "editorIndentGuide.background1": "#eceae4",
      "editorIndentGuide.activeBackground1": "#d6d3ca",
      "editorWhitespace.foreground": "#dedbd3",
      "editorBracketMatch.background": "#10a37f22",
      "editorBracketMatch.border": "#10a37f66",
      "editorGutter.background": "#ffffff",
      "scrollbarSlider.background": "#0000001f",
      "scrollbarSlider.hoverBackground": "#0000002e",
      "scrollbarSlider.activeBackground": "#0000003d",
    },
  });

  monaco.editor.defineTheme(CONSTRUCT_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e7e5df" },
      { token: "comment", foreground: "6f6b62", fontStyle: "italic" },
      { token: "keyword", foreground: "d98ad6" },
      { token: "keyword.control", foreground: "d98ad6" },
      { token: "storage", foreground: "d98ad6" },
      { token: "storage.type", foreground: "d98ad6" },
      { token: "string", foreground: "8fd694" },
      { token: "string.escape", foreground: "5fd0bf" },
      { token: "number", foreground: "f0a868" },
      { token: "constant", foreground: "f0a868" },
      { token: "constant.language", foreground: "f0a868" },
      { token: "regexp", foreground: "5fd0bf" },
      { token: "type", foreground: "6cc5e8" },
      { token: "type.identifier", foreground: "6cc5e8" },
      { token: "namespace", foreground: "6cc5e8" },
      { token: "interface", foreground: "6cc5e8" },
      { token: "function", foreground: "c4a7f5" },
      { token: "support.function", foreground: "c4a7f5" },
      { token: "variable", foreground: "e7e5df" },
      { token: "variable.parameter", foreground: "e8a87c" },
      { token: "variable.predefined", foreground: "f0a868" },
      { token: "attribute.name", foreground: "6cc5e8" },
      { token: "tag", foreground: "7ee787" },
      { token: "delimiter", foreground: "9a958a" },
      { token: "operator", foreground: "d98ad6" },
      { token: "key", foreground: "6cc5e8" },
    ],
    colors: {
      "editor.background": "#181818",
      "editor.foreground": "#e7e5df",
      "editorLineNumber.foreground": "#52504a",
      "editorLineNumber.activeForeground": "#b4b4b4",
      "editor.lineHighlightBackground": "#202020",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#10a37f4d",
      "editor.inactiveSelectionBackground": "#10a37f2e",
      "editor.selectionHighlightBackground": "#10a37f33",
      "editor.wordHighlightBackground": "#10a37f26",
      "editorCursor.foreground": "#19c89c",
      "editorIndentGuide.background1": "#2a2a2a",
      "editorIndentGuide.activeBackground1": "#3d3d3d",
      "editorWhitespace.foreground": "#2e2e2e",
      "editorBracketMatch.background": "#10a37f33",
      "editorBracketMatch.border": "#10a37f88",
      "editorGutter.background": "#181818",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff24",
      "scrollbarSlider.activeBackground": "#ffffff33",
    },
  });
}
