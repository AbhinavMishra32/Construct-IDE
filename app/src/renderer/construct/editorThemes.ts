import { monaco } from "../monaco";

/**
 * Custom Monaco themes for Construct.
 *
 * Designed to feel extremely premium, using color palettes inspired by
 * Atom's One Dark and One Light themes, customized to blend seamlessly
 * with the Construct app's native background colors and typography.
 */

let registered = false;

export const CONSTRUCT_LIGHT = "construct-light";
export const CONSTRUCT_DARK = "construct-dark";

export function registerConstructThemes() {
  if (registered) return;
  registered = true;

  // Premium One Light Inspired Theme
  monaco.editor.defineTheme(CONSTRUCT_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "383a42" },
      { token: "comment", foreground: "a0a1a7", fontStyle: "italic" },
      { token: "keyword", foreground: "a626a4", fontStyle: "bold" },
      { token: "keyword.control", foreground: "a626a4", fontStyle: "bold" },
      { token: "storage", foreground: "a626a4" },
      { token: "storage.type", foreground: "a626a4" },
      { token: "string", foreground: "50a14f" },
      { token: "string.escape", foreground: "0184bc" },
      { token: "number", foreground: "986801" },
      { token: "constant", foreground: "986801" },
      { token: "constant.language", foreground: "986801" },
      { token: "regexp", foreground: "0184bc" },
      { token: "type", foreground: "c18401" },
      { token: "type.identifier", foreground: "c18401" },
      { token: "namespace", foreground: "c18401" },
      { token: "interface", foreground: "c18401" },
      { token: "function", foreground: "4078f2" },
      { token: "support.function", foreground: "4078f2" },
      { token: "variable", foreground: "383a42" },
      { token: "variable.parameter", foreground: "986801" },
      { token: "variable.predefined", foreground: "986801" },
      { token: "attribute.name", foreground: "e45649" },
      { token: "tag", foreground: "e45649" },
      { token: "delimiter", foreground: "a0a1a7" },
      { token: "operator", foreground: "0184bc" },
      { token: "key", foreground: "4078f2" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#383a42",
      "editorLineNumber.foreground": "#a0a1a7",
      "editorLineNumber.activeForeground": "#4078f2",
      "editor.lineHighlightBackground": "#f0f0f077",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#e5e5e6",
      "editor.inactiveSelectionBackground": "#e5e5e6aa",
      "editor.selectionHighlightBackground": "#e5e5e6aa",
      "editor.wordHighlightBackground": "#4078f222",
      "editorCursor.foreground": "#4078f2",
      "editorIndentGuide.background1": "#e5e5e6",
      "editorIndentGuide.activeBackground1": "#a0a1a7",
      "editorWhitespace.foreground": "#e5e5e6",
      "editorBracketMatch.background": "#0184bc22",
      "editorBracketMatch.border": "#0184bc66",
      "editorGutter.background": "#ffffff",
      "scrollbarSlider.background": "#00000010",
      "scrollbarSlider.hoverBackground": "#00000020",
      "scrollbarSlider.activeBackground": "#00000030",
    },
  });

  // Premium One Dark Inspired Theme
  monaco.editor.defineTheme(CONSTRUCT_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "abb2bf" },
      { token: "comment", foreground: "7f848e", fontStyle: "italic" },
      { token: "keyword", foreground: "c678dd" },
      { token: "keyword.control", foreground: "c678dd" },
      { token: "storage", foreground: "c678dd" },
      { token: "storage.type", foreground: "c678dd" },
      { token: "string", foreground: "98c379" },
      { token: "string.escape", foreground: "56b6c2" },
      { token: "number", foreground: "d19a66" },
      { token: "constant", foreground: "d19a66" },
      { token: "constant.language", foreground: "d19a66" },
      { token: "regexp", foreground: "56b6c2" },
      { token: "type", foreground: "e5c07b" },
      { token: "type.identifier", foreground: "e5c07b" },
      { token: "namespace", foreground: "e5c07b" },
      { token: "interface", foreground: "e5c07b" },
      { token: "function", foreground: "61afef" },
      { token: "support.function", foreground: "61afef" },
      { token: "variable", foreground: "abb2bf" },
      { token: "variable.parameter", foreground: "d19a66" },
      { token: "variable.predefined", foreground: "d19a66" },
      { token: "attribute.name", foreground: "e5c07b" },
      { token: "tag", foreground: "e06c75" },
      { token: "delimiter", foreground: "abb2bf" },
      { token: "operator", foreground: "56b6c2" },
      { token: "key", foreground: "61afef" },
    ],
    colors: {
      "editor.background": "#181818",
      "editor.foreground": "#abb2bf",
      "editorLineNumber.foreground": "#4b5263",
      "editorLineNumber.activeForeground": "#61afef",
      "editor.lineHighlightBackground": "#2c313c33",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#3e445177",
      "editor.inactiveSelectionBackground": "#3e445144",
      "editor.selectionHighlightBackground": "#3e445155",
      "editor.wordHighlightBackground": "#61afef22",
      "editorCursor.foreground": "#61afef",
      "editorIndentGuide.background1": "#2c313c",
      "editorIndentGuide.activeBackground1": "#3e4451",
      "editorWhitespace.foreground": "#3b4048",
      "editorBracketMatch.background": "#56b6c233",
      "editorBracketMatch.border": "#56b6c266",
      "editorGutter.background": "#181818",
      "scrollbarSlider.background": "#ffffff10",
      "scrollbarSlider.hoverBackground": "#ffffff20",
      "scrollbarSlider.activeBackground": "#ffffff30",
    },
  });
}
