import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Language } from "@construct/domain";
import { LanguageGlyph, LANGUAGE_LABEL } from "./LanguageGlyph";

const LANGUAGES: Language[] = ["javascript", "typescript", "python", "java", "c", "cpp", "go", "rust", "swift", "ruby"];
const FULL_COLOR_ASSETS = new Set<Language>(["python", "java"]);

describe("language glyphs", () => {
  it.each(LANGUAGES)("renders the real %s mark rather than a text monogram", (language) => {
    const markup = renderToStaticMarkup(<LanguageGlyph language={language} />);

    expect(markup).toContain(`<svg`);
    expect(markup).toContain(`aria-label="${LANGUAGE_LABEL[language]}"`);
    expect(markup).toContain(FULL_COLOR_ASSETS.has(language) ? "<image" : "<path");
    if (FULL_COLOR_ASSETS.has(language)) expect(markup).toContain("data:image/svg+xml");
    expect(markup).not.toContain("<text");
  });

});
