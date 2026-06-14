export type ParsedTapeSpec = {
  major: number;
  minor: number;
  patch: number;
};

export function normalizeTapeSpec(value: string | undefined | null): string {
  const trimmed = String(value ?? "tape-0.1").trim();
  return /^0\.(?:1|2|3|4)(?:\.\d+)?$/.test(trimmed) ? `tape-${trimmed}` : trimmed;
}

export function isSupportedTapeSpec(spec: string): boolean {
  const parsed = parseTapeSpec(spec);
  if (!parsed || parsed.major !== 0) {
    return false;
  }

  if (parsed.minor === 1 || parsed.minor === 2) {
    return parsed.patch === 0;
  }

  if (parsed.minor === 3) {
    return parsed.patch === 0 || parsed.patch === 1;
  }

  if (parsed.minor === 4) {
    return parsed.patch === 0 || parsed.patch === 1;
  }

  return false;
}

export function supportsConstructInteract(spec: string): boolean {
  const parsed = parseTapeSpec(spec);
  return Boolean(parsed && parsed.major === 0 && parsed.minor === 4 && parsed.patch >= 0);
}

export function supportsGeneratedLiveSteps(spec: string): boolean {
  const parsed = parseTapeSpec(spec);
  return Boolean(parsed && parsed.major === 0 && parsed.minor === 4 && parsed.patch >= 1);
}

export function parseTapeSpec(spec: string): ParsedTapeSpec | null {
  const normalized = normalizeTapeSpec(spec);
  const match = normalized.match(/^tape-(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0)
  };
}
