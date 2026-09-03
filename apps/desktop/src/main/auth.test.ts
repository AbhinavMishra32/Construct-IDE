import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* keytar talks to the OS keychain, which a test has no business writing to, so
   it is replaced by a map. The assertions below care about what ends up in it —
   which key holds the token, and which keys are cleared. */
const keychain = new Map<string, string>();
vi.mock("keytar", () => ({
  default: {
    getPassword: vi.fn(async (_service: string, account: string) => keychain.get(account) ?? null),
    setPassword: vi.fn(async (_service: string, account: string, secret: string) => void keychain.set(account, secret)),
    deletePassword: vi.fn(async (_service: string, account: string) => keychain.delete(account)),
  },
}));

const { AuthService, AuthError } = await import("./auth.js");
const keytar = (await import("keytar")).default;

type Handler = (body: Record<string, unknown>) => Response;
let routes: Record<string, Handler>;
let calls: string[];
let origins: Array<string | undefined>;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

const user = { id: "8f1c", email: "learner@example.com", name: "learner" };
/** How a deployment without the bearer plugin answers: the session is a cookie. */
const cookieSession = (token: string) =>
  new Response(JSON.stringify({ user }), {
    headers: { "content-type": "application/json", "set-cookie": `better-auth.session_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax` },
  });
/** How the backend answers today, with Better Auth's bearer plugin loaded. */
const bearerSession = (token: string) =>
  json({ token, user }, { headers: { "set-auth-token": token } });

beforeEach(() => {
  keychain.clear();
  vi.mocked(keytar.getPassword).mockImplementation(async (_service: string, account: string) => keychain.get(account) ?? null);
  vi.mocked(keytar.setPassword).mockImplementation(async (_service: string, account: string, secret: string) => void keychain.set(account, secret));
  vi.mocked(keytar.deletePassword).mockImplementation(async (_service: string, account: string) => keychain.delete(account));
  calls = [];
  origins = [];
  routes = {};
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = String(url).replace("https://api.test/api/auth/", "");
    calls.push(path);
    origins.push((init.headers as Record<string, string> | undefined)?.origin);
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected request to ${path}`);
    return handler(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const auth = () => new AuthService("https://api.test");
const credentials = { email: "learner@example.com", password: "correct-horse" } as const;

describe("talking to the cloud backend", () => {
  it("calls Better Auth where the backend actually mounts it", async () => {
    routes["sign-in/email"] = () => cookieSession("session-value");
    await auth().request({ action: "sign-in", ...credentials });

    expect(calls).toEqual(["sign-in/email"]);
  });

  it("sends an Origin the backend can trust, since Node's fetch reads as CORS", async () => {
    routes["sign-in/email"] = () => cookieSession("session-value");
    await auth().request({ action: "sign-in", ...credentials });

    expect(origins).toEqual(["construct://desktop"]);
  });
});

describe("holding on to a session", () => {
  it("stores the session cookie's value as the credential", async () => {
    routes["sign-in/email"] = () => cookieSession("session-value");
    const result = await auth().request({ action: "sign-in", ...credentials });

    expect(result).toEqual({ status: "signed-in" });
    expect(keychain.get("session-token")).toBe("session-value");
  });

  /* Better Auth's session cookie is `<token>.<base64 signature>`, so the value
     is full of + / and = and arrives percent-encoded. It is handed straight
     back in a Cookie header, so it must be stored exactly as sent — decoding
     here would corrupt nearly every real token. */
  it("stores the cookie value verbatim, encoding included", async () => {
    routes["sign-in/email"] = () => cookieSession("tok.KQNaYMBib+F8R5/NQZ11NU=");
    await auth().request({ action: "sign-in", ...credentials });

    expect(keychain.get("session-token")).toBe(encodeURIComponent("tok.KQNaYMBib+F8R5/NQZ11NU="));
  });

  it("prefers the cookie over a body token, since only the cookie authenticates", async () => {
    routes["sign-in/email"] = () =>
      new Response(JSON.stringify({ token: "body-only", user }), {
        headers: { "content-type": "application/json", "set-cookie": "better-auth.session_token=cookie-value; Path=/" },
      });
    await auth().request({ action: "sign-in", ...credentials });

    expect(keychain.get("session-token")).toBe("cookie-value");
  });

  it("prefers set-auth-token, so adding the bearer plugin needs no desktop change", async () => {
    routes["sign-in/email"] = () => bearerSession("bearer-value");
    await auth().request({ action: "sign-in", ...credentials });

    expect(keychain.get("session-token")).toBe("bearer-value");
  });

  it("refuses a response carrying no session at all", async () => {
    routes["sign-in/email"] = () => json({ user });
    await expect(auth().request({ action: "sign-in", ...credentials })).rejects.toThrow(/did not return a session/);
    expect(keychain.has("session-token")).toBe(false);
  });

  it("keeps the account beside the token, so bootstrap can read it offline", async () => {
    routes["sign-in/email"] = () => cookieSession("session-value");
    await auth().request({ action: "sign-in", ...credentials });

    expect(JSON.parse(keychain.get("account") ?? "{}")).toMatchObject({ id: "8f1c", email: "learner@example.com" });
  });
});

describe("creating an account", () => {
  it("signs the device in when the backend hands back a session immediately", async () => {
    routes["sign-up/email"] = () => cookieSession("fresh");
    const result = await auth().request({ action: "sign-up", ...credentials });

    expect(result).toEqual({ status: "signed-in" });
    expect(keychain.get("session-token")).toBe("fresh");
  });
});

describe("confirming a new address", () => {
  /* With verification on, sign-up answers with an account and no session. That is
     not a failure — the code is already in the post — so the window has to be
     sent to the step that collects it rather than shown an error. */
  it("asks for the code when sign-up hands back no session", async () => {
    routes["sign-up/email"] = () => json({ user });
    const result = await auth().request({ action: "sign-up", ...credentials });

    expect(result).toEqual({ status: "code-sent", purpose: "email-verification" });
    expect(keychain.has("session-token")).toBe(false);
  });

  it("signs the device in once the code is confirmed", async () => {
    routes["email-otp/verify-email"] = () => bearerSession("verified");
    const result = await auth().request({ action: "verify-email", email: credentials.email, code: "123456" });

    expect(result).toEqual({ status: "signed-in" });
    expect(keychain.get("session-token")).toBe("verified");
  });

  /* Someone who closed the window mid-sign-up comes back and types their
     password. Better Auth refuses it with EMAIL_NOT_VERIFIED and sends nothing,
     so the app asks for the code itself and resumes the step that was skipped —
     otherwise a correct password reads as a wrong one, forever. */
  it("resumes an unfinished sign-up instead of reporting a bad password", async () => {
    routes["sign-in/email"] = () => json({ code: "EMAIL_NOT_VERIFIED" }, { status: 403 });
    routes["email-otp/send-verification-otp"] = () => json({ success: true });
    const result = await auth().request({ action: "sign-in", ...credentials });

    expect(result).toEqual({ status: "code-sent", purpose: "email-verification" });
    expect(calls).toEqual(["sign-in/email", "email-otp/send-verification-otp"]);
  });
});

describe("codes instead of a password", () => {
  it("asks for a code and reports which one is coming", async () => {
    routes["email-otp/send-verification-otp"] = () => json({ success: true });
    const result = await auth().request({ action: "send-code", email: credentials.email, purpose: "sign-in" });

    expect(result).toEqual({ status: "code-sent", purpose: "sign-in" });
  });

  it("signs in on a code alone", async () => {
    routes["sign-in/email-otp"] = () => bearerSession("by-code");
    const result = await auth().request({ action: "sign-in-code", email: credentials.email, code: "123456" });

    expect(result).toEqual({ status: "signed-in" });
    expect(keychain.get("session-token")).toBe("by-code");
  });

  it("says a wrong code is a wrong code", async () => {
    routes["sign-in/email-otp"] = () => json({ code: "INVALID_OTP" }, { status: 400 });
    await expect(auth().request({ action: "sign-in-code", email: credentials.email, code: "123456" })).rejects.toThrow(/not right/);
  });
});

describe("resetting a password", () => {
  /* The reset revokes every session server-side and returns none, so the new
     password is spent immediately on a fresh sign-in. Without that second call
     the learner types a new password and lands back on the sign-in form. */
  it("spends the new password on a session rather than ending signed out", async () => {
    routes["email-otp/reset-password"] = () => json({ success: true });
    routes["sign-in/email"] = () => bearerSession("after-reset");
    const result = await auth().request({ action: "reset-password", email: credentials.email, code: "123456", password: "correct-horse" });

    expect(result).toEqual({ status: "signed-in" });
    expect(calls).toEqual(["email-otp/reset-password", "sign-in/email"]);
    expect(keychain.get("session-token")).toBe("after-reset");
  });

  it("does not sign in when the reset itself is refused", async () => {
    routes["email-otp/reset-password"] = () => json({ code: "OTP_EXPIRED" }, { status: 400 });
    await expect(auth().request({ action: "reset-password", email: credentials.email, code: "123456", password: "correct-horse" })).rejects.toThrow(/expired/);
    expect(calls).toEqual(["email-otp/reset-password"]);
  });
});

describe("reporting failure", () => {
  it("says a wrong password is a wrong password", async () => {
    routes["sign-in/email"] = () => json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 });
    await expect(auth().request({ action: "sign-in", ...credentials })).rejects.toThrow(/do not match an account/);
  });

  it("distinguishes an unreachable server from a rejected credential", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const error = await auth().request({ action: "sign-in", ...credentials }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as InstanceType<typeof AuthError>).code).toBe("UNREACHABLE");
  });

  it("survives a failure with no body, rather than reading a code off null", async () => {
    routes["sign-in/email"] = () => new Response("", { status: 500 });
    await expect(auth().request({ action: "sign-in", ...credentials })).rejects.toThrow(/could not complete that/);
  });
});

describe("presenting the credential", () => {
  it("sends it as a cookie, because Better Auth without the bearer plugin reads nothing else", async () => {
    routes["sign-in/email"] = () => cookieSession("session-value");
    const service = auth();
    await service.request({ action: "sign-in", ...credentials });

    let headers: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response("{}", { status: 200 });
    });
    await service.signOut();

    expect(headers.cookie).toBe("better-auth.session_token=session-value");
    expect(headers.authorization).toBe("Bearer session-value");
  });
});

describe("signing out", () => {
  it("clears every credential even when the server cannot be told", async () => {
    routes["sign-in/email"] = () => cookieSession("session-value");
    const service = auth();
    await service.request({ action: "sign-in", ...credentials });

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await service.signOut();

    expect(keychain.has("session-token")).toBe(false);
    expect(keychain.has("account")).toBe(false);
  });
});
