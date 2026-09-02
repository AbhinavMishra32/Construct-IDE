export const CONSTRUCT_CLOUD_PRODUCTION_BASE_URL = "https://api.tryconstruct.cc";
export const CONSTRUCT_CLOUD_ENDPOINT_ENV_VAR = "CONSTRUCT_CLOUD_ENDPOINT";

export function normalizeConstructCloudEndpoint(
  value: string | null | undefined,
  fallback: string = CONSTRUCT_CLOUD_PRODUCTION_BASE_URL
): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function resolveConstructCloudEndpoint(
  env: Record<string, string | undefined> | NodeJS.ProcessEnv | undefined = typeof process !== "undefined" ? process.env : undefined
): string {
  return normalizeConstructCloudEndpoint(env?.[CONSTRUCT_CLOUD_ENDPOINT_ENV_VAR], CONSTRUCT_CLOUD_PRODUCTION_BASE_URL);
}

export function endpointFromRuntimeInfo(runtimeInfo: { constructCloudEndpoint?: string | null } | null | undefined): string {
  return normalizeConstructCloudEndpoint(runtimeInfo?.constructCloudEndpoint, CONSTRUCT_CLOUD_PRODUCTION_BASE_URL);
}

export function isConstructCloudLocalDevelopmentUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname === "::1";
  } catch {
    return false;
  }
}
