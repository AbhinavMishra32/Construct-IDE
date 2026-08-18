import keytar from "keytar";
import type { AuthCodePurpose, AuthRequest, AuthResult } from "../shared/api.js";

const service = "cc.construct.desktop";
let reportedCredentialReadFailure = false;

export class CredentialStoreError extends Error {
  constructor(operation: "read" | "write" | "delete", cause: unknown) {
    const store = process.platform === "darwin" ? "macOS Keychain" : "the operating system credential store";
    const recovery = process.platform === "darwin" ? " Unlock the login keychain in Keychain Access and try again." : " Unlock it and try again.";
    super(`Construct could not ${operation} credentials in ${store}.${recovery}`, { cause });
    this.name = "CredentialStoreError";
  }
}

/** Reading the credential store is part of deciding which screen to show, but
 *  it must never be part of deciding whether Construct gets a window at all. macOS
 *  Keychain can reject a read while the login keychain is locked or unhealthy;
 *  in that case the safe bootstrap state is signed out. Writes still reject so
 *  the UI cannot claim a credential was saved when it was not. */
async function readPassword(account: string): Promise<string | null> {
  try {
    return await keytar.getPassword(service, account);
  } catch (cause) {
    if (!reportedCredentialReadFailure) {
      reportedCredentialReadFailure = true;
      console.error("Credential store unavailable; starting Construct signed out:", cause);
    }
    return null;
  }
}

async function writePassword(account: string, password: string): Promise<void> {
  try {
    await keytar.setPassword(service, account, password);
  } catch (cause) {
    throw new CredentialStoreError("write", cause);
  }
}

async function removePassword(account: string): Promise<boolean> {
  try {
    return await keytar.deletePassword(service, account);
  } catch (cause) {
    throw new CredentialStoreError("delete", cause);
  }
}
/** Where the session token lives. The fifteen-minute JWT this replaced was held
 *  under "access-token"; that entry is cleared whenever a token is written or
 *  dropped, so no install is left holding a credential nothing will accept. */
const TOKEN = "session-token";
const LEGACY_TOKEN = "access-token";

/** What this app calls itself when it talks to the API.
 *
 *  Node's fetch stamps `sec-fetch-mode: cors` on everything it sends, and Better
 *  Auth reads that as a browser calling and then refuses a request that brings no
 *  Origin with it. So the app sends one. The scheme is deliberately not http:
 *  nothing can serve a page from it, which means the value cannot be forged by
 *  one. The API must trust exactly this string: it has to appear in the cloud
 *  backend's `corsOrigins`, which is where Better Auth reads `trustedOrigins`
 *  from. Change neither without the other. */
const DESKTOP_ORIGIN = "construct://desktop";

/** Where Better Auth is mounted on the cloud backend — see `app.all("/api/auth/*")`
 *  in the backend's server.ts. */
const AUTH_BASE = "/api/auth";

/**
 * Flows the desktop draws but the backend cannot serve yet.
 *
 * Construct's backend runs Better Auth with email and password only. The
 * emailed one-time code flows need its `emailOTP` plugin, which is a backend
 * change rather than a desktop one. Refusing them here — by name, with a
 * sentence a person can act on — is better than letting the request 404 and
 * surfacing as "Sign-in failed (404)".
 */
const UNSUPPORTED = "Emailed sign-in codes are not switched on for this account yet. Sign in with your password instead.";

type Account = { id: string; displayName: string; email: string };
/** What Better Auth answers with. `token` is absent when a deployment wants an
 *  address confirmed before it hands out a session. */
type AuthPayload = { token?: string | null; user?: { id: string; email: string; name?: string | null }; message?: string; code?: string };

/** Better Auth's error codes, said the way the window should say them. Anything
 *  not listed falls back to the server's own message, which is written for a
 *  developer but is at least accurate. */
const REASON: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password do not match an account.",
  INVALID_EMAIL: "Check the email address.",
  USER_ALREADY_EXISTS: "An account already exists for this email — sign in instead.",
  USER_NOT_FOUND: "There is no account for that email.",
  PASSWORD_TOO_SHORT: "Passwords are at least 8 characters.",
  PASSWORD_TOO_LONG: "That password is too long.",
  INVALID_OTP: "That code is not right. Check it, or ask for a new one.",
  OTP_EXPIRED: "That code has expired. Ask for a new one.",
  TOO_MANY_ATTEMPTS: "Too many tries with that code. Ask for a new one.",
};

export class AuthService {
  constructor(private readonly apiOrigin: string) {}
  /** Whether the account signed in on this run of the app was created on it.
   *
   *  It decides one thing: whether signing in waits for a restore before the
   *  window moves on. A brand-new account has nothing in the cloud to pull, and
   *  it cannot be recognised from the sign-in alone — with verification on, the
   *  account is created by `sign-up` and the session arrives later from
   *  `verify-email`, so the fact has to be remembered across the two calls. */
  private freshAccount = false;
  signedUpThisSession() { return this.freshAccount; }
  async account() { const raw = await readPassword("account"); return raw ? JSON.parse(raw) as Account : null; }
  /** The bearer token every authenticated request carries. */
  async accessToken() { return readPassword(TOKEN); }

  /** One entry point for every step of signing in. Each case is one call to
   *  Better Auth and, on success, one of two outcomes: the device is signed in,
   *  or a code is in the post. Nothing else is reported back — the window has no
   *  business knowing which endpoint answered. */
  async request(input: AuthRequest): Promise<AuthResult> {
    switch (input.action) {
      case "sign-up": {
        const payload = await this.post("sign-up/email", { email: input.email, password: input.password, name: input.email.split("@")[0] ?? "Learner" });
        /* Set only once the account exists — a failed sign-up throws above this
           line, and claiming a fresh account there would make the next sign-in
           skip the restore it needs. */
        this.freshAccount = true;
        /* No token means this deployment sends a code before it sends a session,
           and Better Auth has already sent it as part of the sign-up. */
        return payload.token ? this.persist(payload) : { status: "code-sent", purpose: "email-verification" };
      }
      case "sign-in":
        return this.persist(await this.post("sign-in/email", { email: input.email, password: input.password }));
      /* Every code-carrying flow needs Better Auth's emailOTP plugin, which the
         backend does not load. They stay in the union because the sign-in window
         already draws them and the backend is expected to grow the plugin; until
         it does they fail by name rather than as a bare 404. */
      case "send-code":
      case "verify-email":
      case "sign-in-code":
      case "reset-password":
        throw new AuthError(UNSUPPORTED, "OTP_UNAVAILABLE");
    }
  }

  /** POSTs to Better Auth and normalises the failure.
   *
   *  The session can arrive two ways. With the `bearer` plugin loaded it comes
   *  back on `set-auth-token`; without it — which is how Construct's backend is
   *  configured today — Better Auth sets a session cookie instead. Both are
   *  accepted, and `authorization` header carries whichever one was stored, so
   *  the desktop keeps working if the plugin is added later. */
  private async post(path: string, body: Record<string, unknown>): Promise<AuthPayload> {
    let response: Response;
    try {
      response = await fetch(`${this.apiOrigin}${AUTH_BASE}/${path}`, { method: "POST", headers: { "content-type": "application/json", origin: DESKTOP_ORIGIN }, body: JSON.stringify(body) });
    } catch {
      /* A refused connection is the one failure that is not about the credentials,
         and reporting it as one sends people to reset a password that was fine. */
      throw new AuthError("Construct cannot reach its server. Check your connection and try again.", "UNREACHABLE");
    }
    /* `?? {}` because a failure is allowed to have no body at all, and JSON `null`
       parses to null rather than to nothing — reading a code off that is how an
       error about a password becomes an error about reading a property of null. */
    const payload = (await response.json().catch(() => null) as AuthPayload | null) ?? {};
    if (response.status === 429) throw new AuthError("Too many attempts. Wait a minute, then try again.", "RATE_LIMITED");
    if (response.status >= 500) throw new AuthError("Construct's server could not complete that. Its log will say why.", "SERVER_ERROR");
    if (!response.ok) throw new AuthError(REASON[payload.code ?? ""] ?? payload.message ?? `Sign-in failed (${response.status})`, payload.code);
    return { ...payload, token: response.headers.get("set-auth-token") ?? sessionCookie(response) ?? payload.token ?? null };
  }

  /** Writes the credential to the keychain. The account is stored beside it
   *  because the bootstrap reads it before anything has been online. */
  private async persist(payload: AuthPayload): Promise<AuthResult> {
    if (!payload.token || !payload.user) throw new AuthError("The server did not return a session. Try signing in again.");
    const account: Account = { id: payload.user.id, email: payload.user.email, displayName: payload.user.name ?? payload.user.email.split("@")[0] ?? "Learner" };
    await writePassword(TOKEN, payload.token);
    await writePassword("account", JSON.stringify(account));
    await removePassword(LEGACY_TOKEN).catch(() => undefined);
    return { status: "signed-in" };
  }

  async signOut() {
    /* Told to the server first, so the row goes with the keychain entry and a
       stolen copy of the token is worth nothing. It is allowed to fail: signing
       out of a device has to work on a plane. */
    const token = await this.accessToken();
    if (token) await fetch(`${this.apiOrigin}${AUTH_BASE}/sign-out`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: DESKTOP_ORIGIN }, body: "{}" }).catch(() => undefined);
    await removePassword(TOKEN);
    await removePassword(LEGACY_TOKEN).catch(() => undefined);
    await removePassword("account");
    /* Whoever signs in next is not the account that was just created here, so the
       next sign-in must restore rather than assume there is nothing to pull. */
    this.freshAccount = false;
  }
  async deleteAccount() {
    const token = await this.accessToken();
    if (!token) throw new Error("Sign in before deleting your account");
    const response = await fetch(`${this.apiOrigin}/v1/account`, { method: "DELETE", headers: { authorization: `Bearer ${token}`, origin: DESKTOP_ORIGIN } });
    /* The backend has no account-deletion route yet. Saying so is the point:
       silently signing the device out would look like the account was deleted
       while it still exists on the server. */
    if (response.status === 404) throw new Error("Deleting an account is not available yet. Contact support@construct.cc and it will be removed for you.");
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error ?? `Account deletion failed (${response.status})`);
    }
    await this.signOut();
    await Promise.all([
      // `exa` is not a model provider, but it is a key held under the same
      // prefix, and deleting the account has to empty the keychain rather than
      // most of it.
      "openai-codex", "claude-code", "github-copilot", "openai", "anthropic", "google", "xai", "openrouter", "cline", "opencode", "opencode-go", "deepseek", "minimax", "moonshotai", "kimi-coding", "zai", "vercel-ai-gateway", "cloudflare-ai-gateway", "ollama", "lm-studio", "custom", "exa",
    ].flatMap((provider) => [this.deleteSecret(provider), this.deleteProviderOAuth(provider)]));
  }
  saveSecret(account: string, secret: string) { return writePassword(`provider:${account}`, secret); }
  readSecret(account: string) { return readPassword(`provider:${account}`); }
  deleteSecret(account: string) { return removePassword(`provider:${account}`).then(() => undefined); }
  saveProviderOAuth(provider: string, credentials: unknown) { return writePassword(`provider-oauth:${provider}`, JSON.stringify(credentials)); }
  async readProviderOAuth<T>(provider: string): Promise<T | null> {
    const raw = await readPassword(`provider-oauth:${provider}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  deleteProviderOAuth(provider: string) { return removePassword(`provider-oauth:${provider}`).then(() => undefined); }
}

/**
 * The session cookie Better Auth sets when the bearer plugin is not loaded.
 *
 * Only the cookie's value is kept, never its attributes — Path, SameSite and
 * the rest govern a browser jar the desktop does not have. What is stored is a
 * credential to present, and it is presented the same way a bearer token is.
 * Returns null rather than an empty string when no session cookie is present,
 * so `persist` refuses instead of writing a credential that authenticates
 * nothing.
 */
function sessionCookie(response: Response): string | null {
  const header = response.headers.getSetCookie?.() ?? [];
  for (const cookie of header) {
    const match = /^(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(cookie);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

/** A failure with a sentence in it that can be shown as-is, and the server's own
 *  code kept alongside for the one case the flow branches on. */
export class AuthError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = "AuthError"; }
}
