export const CONSTRUCT_CLOUD_PRODUCTION_BASE_URL = "https://api.tryconstruct.cc";

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
