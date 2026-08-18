import type { ConstructPatch, ConstructTextEdit } from "./types";

export function applyConstructPatch(source: string, patch: ConstructPatch): string {
  const edits = normalizeEdits(patch.edits);
  let result = source;
  for (const edit of edits) {
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
  }
  return result;
}

export function applyConstructPatches(source: string, patches: ConstructPatch[]): string {
  return patches.reduce((current, patch) => applyConstructPatch(current, patch), source);
}

function normalizeEdits(edits: ConstructTextEdit[]): ConstructTextEdit[] {
  const sorted = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].start < sorted[index].end) {
      throw new Error("Construct patch contains overlapping edits.");
    }
  }
  return sorted;
}
