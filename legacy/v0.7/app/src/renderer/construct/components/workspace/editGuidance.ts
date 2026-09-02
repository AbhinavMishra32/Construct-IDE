import type { EditBlock } from "../../types";

export function lineNumberForOffset(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

export function isGuidedEditReady(
  edit: EditBlock,
  editAnchors: Record<string, string>
): boolean {
  return edit.mode !== "append" || Object.prototype.hasOwnProperty.call(editAnchors, edit.id);
}

export function deriveEditAnchor({
  edit,
  existing,
  progress
}: {
  edit: EditBlock;
  existing: string;
  progress: number;
}): string {
  if (edit.mode !== "append") {
    return "";
  }

  const materializedLength = longestMaterializedEditPrefixLength(existing, edit.content, progress);
  const base = materializedLength > 0 ? existing.slice(0, existing.length - materializedLength) : existing;

  if (!base) {
    return "";
  }

  return base.endsWith("\n") ? base : `${base}\n`;
}

function longestMaterializedEditPrefixLength(
  existing: string,
  editContent: string,
  progress: number
): number {
  const max = Math.min(existing.length, editContent.length, progress);

  for (let length = max; length > 0; length -= 1) {
    if (existing.endsWith(editContent.slice(0, length))) {
      return length;
    }
  }

  return 0;
}
