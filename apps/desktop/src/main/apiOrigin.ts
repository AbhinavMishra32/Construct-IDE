import { app } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Where this copy of Construct talks to the Construct API.
 *
 *  A packaged build cannot default to localhost. Someone who downloads Construct has
 *  no API running on their machine, so every sign-in fails with a refused
 *  connection that reads as the app being broken. Release builds are therefore
 *  stamped with the deployed origin.
 *
 *  The stamp is `constructHostedApiOrigin` in this package's own manifest, not a
 *  build-time environment variable: a packaged app does not inherit the
 *  environment of the machine that built it, so a `process.env` value set in CI
 *  would simply be undefined by the time anyone ran the app. Being in the source
 *  manifest rather than injected at package time, it is also what development
 *  reads — `electron .` runs with this directory as the app path — so a checkout
 *  talks to the same deployed API a release does, and sign-in works on a clone
 *  with nothing configured.
 *
 *  Precedence is override, then stamp, then localhost. Which makes running
 *  against a local backend one environment variable — `CONSTRUCT_API_ORIGIN`,
 *  the only way to reach `pnpm dev` in the cloud-backend repo now that the
 *  hosted origin is the default. */

/** Where @construct/cloud-backend listens by default — see PORT in its
 *  config.ts. Inherited as 4318 from Spar, whose API listened somewhere else
 *  entirely, which made every local sign-in fail with a refused connection. */
const DEV_API_ORIGIN = "http://localhost:8787";

let cached: string | undefined;

export function apiOrigin(): string {
  if (cached) return cached;
  cached = resolve();
  return cached;
}

function resolve(): string {
  const override = process.env.CONSTRUCT_API_ORIGIN?.trim();
  if (override) return trimSlash(override);
  const stamped = stampedOrigin();
  if (stamped) return trimSlash(stamped);
  return DEV_API_ORIGIN;
}

function stampedOrigin(): string | null {
  try {
    // Readable inside the asar as well as beside an unpackaged checkout.
    const manifest = readFileSync(path.join(app.getAppPath(), "package.json"), "utf8");
    const value = (JSON.parse(manifest) as { constructHostedApiOrigin?: unknown }).constructHostedApiOrigin;
    if (typeof value !== "string" || !value.trim()) return null;
    // A malformed stamp must not take the app down on launch.
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** True when a packaged build has nowhere real to talk to, so sign-in can explain
 *  that rather than reporting a refused connection. */
export function apiOriginIsUnconfigured(): boolean {
  return app.isPackaged && apiOrigin() === DEV_API_ORIGIN;
}

function trimSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
