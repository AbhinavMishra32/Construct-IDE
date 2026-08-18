import { monaco } from "../monaco";
import {
  getActiveCodeThemeDefinition,
  monacoThemeData,
  setActiveCodeThemeDefinition,
  type CodeThemeDefinition
} from "./codeThemes";

export const CONSTRUCT_LIGHT = "construct-light";
export const CONSTRUCT_DARK = "construct-dark";

export function registerConstructThemes(definition: CodeThemeDefinition = getActiveCodeThemeDefinition()) {
  setActiveCodeThemeDefinition(definition);
  monaco.editor.defineTheme(CONSTRUCT_LIGHT, monacoThemeData(definition, "light"));
  monaco.editor.defineTheme(CONSTRUCT_DARK, monacoThemeData(definition, "dark"));
}
