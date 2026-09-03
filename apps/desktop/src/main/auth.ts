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
      case "sign-in": {
        const payload = await this.post("sign-in/email", { email: input.email, password: input.password }).catch(async (error: unknown) => {
          /* An unconfirmed address is not a failed sign-in, it is an unfinished
             sign-up. Better Auth refuses the password without sending anything,
             so the code is asked for here and the window moves to the step that
             was skipped rather than showing a dead end. */
          if (!(error instanceof AuthError) || error.code !== "EMAIL_NOT_VERIFIED") throw error;
          await this.post("email-otp/send-verification-otp", { email: input.email, type: "email-verification" });
          return null;
        });
        return payload ? this.persist(payload) : { status: "code-sent", purpose: "email-verification" };
      }
      case "send-code":
        /* Answers the same way whether or not the address has an account, so this
           is not a way to ask the server who has signed up. */
        await this.post("email-otp/send-verification-otp", { email: input.email, type: input.purpose });
        return { status: "code-sent", purpose: input.purpose };
      case "verify-email":
        return this.persist(await this.post("email-otp/verify-email", { email: input.email, otp: input.code }));
      case "sign-in-code":
        return this.persist(await this.post("sign-in/email-otp", { email: input.email, otp: input.code }));
      case "reset-password":
        /* Resetting revokes every other session server-side and hands back none,
           so the new password is spent immediately on a fresh one — otherwise the
           learner would type a new password and land back on the sign-in form. */
        await this.post("email-otp/reset-password", { email: input.email, otp: input.code, password: input.password });
        return this.persist(await this.post("sign-in/email", { email: input.email, password: input.password }));
    }
  }

  /** POSTs to Better Auth and normalises the failure.
   *
   *  The session can arrive two ways. With the `bearer` plugin loaded — which is
   *  how Construct's backend is configured — it comes back on `set-auth-token`;
   *  without it Better Auth sets a session cookie instead. Both are still
   *  accepted, because a desktop build outlives the deployment it was made
   *  against and an older backend must not lock a newer app out. */
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
    if (token) await fetch(`${this.apiOrigin}${AUTH_BASE}/sign-out`, { method: "POST", headers: { ...credentialHeaders(token), "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
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
    const response = await fetch(`${this.apiOrigin}/v1/account`, { method: "DELETE", headers: credentialHeaders(token) });
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
    /* Kept exactly as sent, percent-encoding and all, because it is handed
       straight back in a Cookie header. Decoding it here would corrupt every
       token containing a + or a / — which is most of them, the value being
       base64. */
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * How a stored credential is presented on an authenticated request.
 *
 * Both headers, deliberately. `authorization` is what the backend's bearer
 * plugin reads, and the cookie is what authenticates against a deployment
 * without it. Whichever credential was stored is presented both ways, which
 * costs one header and means this app works against either backend.
 */
function credentialHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    cookie: `better-auth.session_token=${token}`,
    origin: DESKTOP_ORIGIN,
  };
}

/** A failure with a sentence in it that can be shown as-is, and the server's own
 *  code kept alongside for the one case the flow branches on. */
export class AuthError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = "AuthError"; }
}
