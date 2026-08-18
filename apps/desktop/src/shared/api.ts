import { z } from "zod";
import { canonicalWorkspacePath } from "./workspacePath.js";
import {
  agentActivityStepSchema,
  askUserQuestionRequestSchema,
  languageSchema,
  type AgentMessage,
  type AskUserQuestionRequest,
  type ConstructNotice,
  type Language,
} from "@construct/domain";

/**
 * Every channel the window may call, named once so neither side can invent one.
 *
 * Grouped by the surface that owns it. A channel appears here only once the
 * main process actually handles it — a declared-but-unhandled channel reads as
 * a feature that exists and fails at runtime instead of at build time.
 */
export const ipc = {
  bootstrap: "app:bootstrap",

  /* Projects — a Construct project is a real directory on disk with a flow
     session attached. Opening one is the only way into the workspace. */
  projectsList: "projects:list",
  projectsCreate: "projects:create",
  projectsOpen: "projects:open",
  projectsImport: "projects:import",
  projectsRename: "projects:rename",
  projectsDelete: "projects:delete",

  /* Signing in, and the account behind it. */
  authRequest: "auth:request",
  authSignOut: "auth:sign-out",
  authDeleteAccount: "auth:delete-account",

  /* Inference. Which provider, which model, how hard it thinks, and whether it
     may read the web. */
  settingsProviders: "settings:providers",
  settingsSaveSecret: "settings:save-secret",
  settingsProviderDisconnect: "settings:provider-disconnect",
  settingsProviderDefault: "settings:provider-default",
  settingsProviderUsage: "settings:provider-usage",
  settingsProviderOauthStart: "settings:provider-oauth-start",
  settingsProviderOauthSubmit: "settings:provider-oauth-submit",
  settingsProviderOauthCancel: "settings:provider-oauth-cancel",
  settingsReasoningEffort: "settings:reasoning-effort",
  settingsWebSearch: "settings:web-search",
  settingsWebSearchSave: "settings:web-search-save",
  settingsWebSearchClear: "settings:web-search-clear",
  settingsWebSearchEnabled: "settings:web-search-enabled",

  /* The application itself. */
  settingsOpenExternal: "settings:open-external",
  settingsTheme: "settings:theme",
  updateState: "update:state",
  updateCheck: "update:check",
  updateDownload: "update:download",
  updateDismissChangelog: "update:dismiss-changelog",
} as const;

/* ---- Signing in ---------------------------------------------------------
   Every flow the window offers arrives on one channel. They all carry an email
   and differ only in what else they carry, so a single validated union is what
   keeps the main process from having to trust six different shapes — and it is
   the same union the sign-in window switches on, which is why the two can never
   disagree about what a flow needs.

   Construct's cloud backend authenticates with email and password today. The
   code-carrying members are kept because the sign-in window already draws them
   and the backend is expected to grow email one-time codes; the main process
   rejects them with a clear message until it does, which is a better failure
   than a screen that cannot be reached. */
const emailField = z.string().trim().toLowerCase().email();
const passwordField = z.string().min(8).max(200);
const codeField = z.string().trim().regex(/^\d{6}$/);
/** Which email a code arrives in, and therefore what it can be spent on. */
export const authCodePurposeSchema = z.enum(["sign-in", "email-verification", "forget-password"]);
export type AuthCodePurpose = z.infer<typeof authCodePurposeSchema>;
export const authRequestInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sign-in"), email: emailField, password: passwordField }),
  z.object({ action: z.literal("sign-up"), email: emailField, password: passwordField }),
  /** Ask for a fresh code — the first one, or a replacement for one that expired. */
  z.object({ action: z.literal("send-code"), email: emailField, purpose: authCodePurposeSchema }),
  /** Confirm a new account's address. Signs in on success. */
  z.object({ action: z.literal("verify-email"), email: emailField, code: codeField }),
  /** Sign in with a code instead of a password. */
  z.object({ action: z.literal("sign-in-code"), email: emailField, code: codeField }),
  /** Spend a reset code on a new password, and sign in with it. */
  z.object({ action: z.literal("reset-password"), email: emailField, code: codeField, password: passwordField }),
]);
export type AuthRequest = z.infer<typeof authRequestInput>;
/** Where the window goes next. Only two things can happen: the device is signed
 *  in, or an email is on its way and six digits are wanted. */
export type AuthResult = { status: "signed-in" } | { status: "code-sent"; purpose: AuthCodePurpose };

/* ---- Projects -----------------------------------------------------------
   A project is a directory the learner owns, not a sandbox Construct manages.
   Creating one scaffolds a directory; importing one adopts a directory that is
   already there. Both end at the same place: a project row with a workspace
   path, which every later surface addresses by id. */
export const projectGoalField = z.string().trim().min(3).max(1000);
export const projectCreateInput = z.object({
  goal: projectGoalField,
  name: z.string().trim().min(1).max(80),
  /** Where the directory is made. Absolute, chosen through the OS picker, so
   *  the renderer never composes a filesystem path itself. */
  parentDirectory: z.string().min(1).max(4000),
  language: languageSchema,
});
export const projectImportInput = z.object({
  directory: z.string().min(1).max(4000),
  goal: projectGoalField,
});
export const projectIdInput = z.object({ projectId: z.string().uuid() });
export const projectRenameInput = projectIdInput.extend({ name: z.string().trim().min(1).max(80) });

export type ProjectSummary = {
  id: string;
  name: string;
  goal: string;
  /** Absolute path to the project directory. Shown to the learner, because a
   *  project that lives on their disk should say where. */
  directory: string;
  language: Language;
  createdAt: string;
  openedAt: string | null;
  /** False once the directory has been moved or deleted underneath us. The row
   *  stays listed so it can be repaired or removed deliberately. */
  present: boolean;
};

export type ProjectDetail = {
  summary: ProjectSummary;
  messages: AgentMessage[];
  pendingLearnerQuestion: AskUserQuestionRequest | null;
};

/* ---- Files --------------------------------------------------------------
   Paths crossing this boundary are canonicalised before validation, so a
   renderer cannot address anything outside the project it names. */
const workspacePath = z.string().min(1).max(500).transform(canonicalWorkspacePath);
export const workspacePathInput = projectIdInput.extend({ path: workspacePath });
export const workspaceWriteInput = workspacePathInput.extend({ content: z.string().max(2_000_000) });

/* ---- Inference ----------------------------------------------------------- */
export const providerSettingsInput = z.object({
  provider: z.enum([
    "openai", "anthropic", "google", "xai", "openrouter", "cline", "opencode",
    "opencode-go", "deepseek", "minimax", "moonshotai", "kimi-coding", "zai",
    "vercel-ai-gateway", "cloudflare-ai-gateway", "ollama", "lm-studio", "custom",
  ]),
  model: z.string().trim().min(1).max(200),
  baseUrl: z
    .string()
    .url()
    .refine(
      (value) => value.startsWith("https://") || value.startsWith("http://localhost:") || value.startsWith("http://127.0.0.1:"),
      "Provider URL must use HTTPS unless it is local",
    ),
  secret: z.string().max(20_000),
});
export const themePreferenceSchema = z.enum(["system", "light", "dark"]);
/** Mirrors pi-ai's `ModelThinkingLevel`: "off" sends no reasoning directive at all. */
export const reasoningEffortSchema = z.enum(["off", "low", "medium", "high", "xhigh"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

/** The translucent material the OS paints behind the window, if any. */
export type NativeSurface = "liquid-glass" | "vibrancy" | "mica" | "none";
/** Which edge must reserve room for the OS window buttons; "none" = native frame. */
export type WindowControls = "left" | "right" | "none";
/** `process.platform`, narrowed to what the renderer branches on. */
export type HostPlatform = "darwin" | "win32" | "linux" | (string & {});
/** Which copy of Construct this is. Resolved once in the main process. */
export type BuildInfo = {
  version: string;
  commit: string | null;
  branch: string | null;
  /** False when running from source, where the commit is the real identity. */
  packaged: boolean;
};

export type ProviderId = "openai-codex" | "claude-code" | "github-copilot" | z.infer<typeof providerSettingsInput>["provider"];
export type ProviderInventory = {
  providers: Array<{
    id: ProviderId;
    name: string;
    description: string;
    kind: "subscription" | "api-key" | "local" | "custom";
    state: "connected" | "disconnected" | "auth-expired";
    selectedModel: string;
    baseUrl: string;
    keyUrl?: string;
    models: Array<{ id: string; name: string; reasoning: boolean }>;
  }>;
  /** Whether a turn can run right now — decided the same way credentials are
   *  resolved, so the composer never infers runnability from `defaultModel`. */
  ready: boolean;
  defaultModel: { provider: ProviderId; model: string; reasoningEffort: ReasoningEffort };
};
/** One rate-limit window of a subscription. `usedPercent` is how much of the
 *  window has been spent (0–100), and `resetsAt` is epoch seconds or null. */
export type UsageWindow = { kind: "five-hour" | "weekly"; usedPercent: number; resetsAt: number | null };
export type SubscriptionUsage = { windows: UsageWindow[]; capturedAt: number };
export type ProviderOAuthEvent = {
  flowId: string;
  provider: ProviderId;
  status: "starting" | "waiting" | "prompt" | "connected" | "cancelled" | "error";
  message: string;
  url?: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

/* ---- Updates ------------------------------------------------------------- */
export type UpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "installing" | "current" | "error" | "unsupported";
  currentVersion: string;
  version: string | null;
  notes: string | null;
  percent: number | null;
  transferred: number | null;
  total: number | null;
  bytesPerSecond: number | null;
  message: string | null;
  checkedAt: string | null;
  /** Present only after an update was installed and this exact version launched. */
  changelog: { version: string; notes: string } | null;
};

export type MenuCommand = "new-project" | "open-project" | "settings" | "toggle-sidebar" | "command-palette";

/** What the window is handed the moment it opens: enough to decide which screen
 *  to draw without a second round trip. */
export type BootstrapData = {
  signedIn: boolean;
  email: string | null;
  theme: ThemePreference;
  projects: ProjectSummary[];
  providers: ProviderInventory;
  notices: ConstructNotice[];
};

export const agentActivitySchema = agentActivityStepSchema;
export const learnerQuestionSchema = askUserQuestionRequestSchema;

export interface ConstructApi {
  bootstrap(): Promise<BootstrapData>;

  /* Projects. */
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: z.infer<typeof projectCreateInput>): Promise<ProjectSummary>;
  importProject(input: z.infer<typeof projectImportInput>): Promise<ProjectSummary>;
  openProject(input: z.infer<typeof projectIdInput>): Promise<ProjectDetail>;
  renameProject(input: z.infer<typeof projectRenameInput>): Promise<void>;
  /** Removes Construct's record of the project. Never deletes the directory —
   *  the files are the learner's, and Construct did not create most of them. */
  deleteProject(input: z.infer<typeof projectIdInput>): Promise<void>;

  /* Account. The main process owns the keychain and the API, so the window only
     ever learns which of the two things happened — see `AuthResult`. */
  auth(request: AuthRequest): Promise<AuthResult>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;

  /* Inference. */
  listProviders(): Promise<ProviderInventory>;
  saveProviderSecret(input: z.infer<typeof providerSettingsInput>): Promise<void>;
  disconnectProvider(provider: ProviderId): Promise<void>;
  setDefaultProvider(provider: ProviderId, model: string): Promise<void>;
  providerUsage(provider: ProviderId): Promise<SubscriptionUsage | null>;
  setReasoningEffort(effort: ReasoningEffort): Promise<void>;
  startProviderOAuth(provider: Extract<ProviderId, "openai-codex" | "claude-code" | "github-copilot">): Promise<{ flowId: string }>;
  submitProviderOAuth(flowId: string, value: string): Promise<void>;
  cancelProviderOAuth(flowId: string): Promise<void>;
  /** Whether the agent can reach the web, and where its key came from. The key
   *  itself is never read back — Settings shows the state, not the secret. */
  webSearchStatus(): Promise<{ source: "keychain" | "env" | "none"; enabled: boolean }>;
  saveWebSearchKey(key: string): Promise<void>;
  clearWebSearchKey(): Promise<void>;
  setWebSearchEnabled(enabled: boolean): Promise<void>;

  /* Application. */
  openExternal(url: string): Promise<void>;
  setTheme(theme: ThemePreference): Promise<void>;
  updateState(): Promise<UpdateState>;
  checkForUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<void>;
  dismissUpdateChangelog(version: string): Promise<void>;

  onUpdateState(listener: (state: UpdateState) => void): () => void;
  onProviderOAuthEvent(listener: (event: ProviderOAuthEvent) => void): () => void;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  onNativeSurface(listener: (surface: NativeSurface) => void): () => void;

  /** Chrome the OS owns: the material behind us, and where its buttons sit. */
  chrome: { platform: HostPlatform; surface: NativeSurface; controls: WindowControls };
  /** Version and commit of this copy, fixed for the life of the window. */
  build: BuildInfo;
}
