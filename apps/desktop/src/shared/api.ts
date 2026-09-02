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
  projectsPin: "projects:pin",
  projectsArchive: "projects:archive",
  projectsDelete: "projects:delete",

  /* Files inside the open project. */
  filesList: "files:list",
  filesCreate: "files:create",
  filesCreateDirectory: "files:create-directory",
  filesRename: "files:rename",
  filesRemove: "files:remove",
  filesRead: "files:read",
  filesWrite: "files:write",

  /* Source files anywhere on disk — see `sourcePathInput`. */
  sourceStat: "source:stat",
  sourceRead: "source:read",
  sourceList: "source:list",

  /* Terminals inside the open project. */
  terminalCreate: "terminal:create",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalDispose: "terminal:dispose",

  /* Language servers for the open project. */
  lspStart: "lsp:start",
  lspSend: "lsp:send",
  lspStop: "lsp:stop",
  lspCatalog: "lsp:catalog",
  lspInstall: "lsp:install",
  lspUninstall: "lsp:uninstall",

  /* The Construct agent. */
  agentMessages: "agent:messages",
  agentStatus: "agent:status",
  agentSend: "agent:send",
  agentStop: "agent:stop",
  agentEdit: "agent:edit",
  agentSteer: "agent:steer",
  agentUndoable: "agent:undoable",
  agentAnswer: "agent:answer",

  /* What the learner understands, per project — and across all of them, for the
     atlas. */
  conceptsList: "concepts:list",
  conceptsAtlas: "concepts:atlas",
  conceptsDelete: "concepts:delete",

  /* What Construct remembers about a project: four Markdown files in the
     project's own `.construct`, and the ordered steps it plans to teach. */
  memoryRead: "memory:read",
  pathRead: "path:read",

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
  showContextMenu: "app:context-menu",
  suggestProjectName: "projects:suggest-name",
  syncNow: "sync:now",
  syncStatus: "sync:status-read",
  tasksList: "tasks:list",
  tasksSubmit: "tasks:submit",
  settingsTheme: "settings:theme",
  settingsProjectDefaults: "settings:project-defaults",
  /* Who Construct is teaching. Read on the way in, written by the intake, and
     editable afterwards from Settings. */
  learnerRead: "learner:read",
  learnerSave: "learner:save",
  learnerQuestion: "learner:question",
  learnerPortrait: "learner:portrait",
  /** Moves the window to the size the stage it has reached wants. The renderer
   *  owns which screen is showing, so it is what tells the main process. */
  windowStage: "app:stage",
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
   *  the renderer never composes a filesystem path itself.
   *
   *  Optional, and that is the point: the main process falls back to the
   *  learner's projects folder from Settings, so making a project asks for a
   *  name, a goal and nothing else. Naming a folder here overrides that for one
   *  project without changing the default. */
  parentDirectory: z.string().min(1).max(4000).optional(),
  language: languageSchema,
  /** Concepts the learner already holds and wants this project to build on,
   *  chosen from the atlas when they made it.
   *
   *  Carried into `learner.md` rather than into the goal. The goal is what the
   *  agent teaches *towards*; this is what it can teach *from*, and folding the
   *  two together loses the distinction the whole memory layer is built on —
   *  the agent would re-teach a thing the learner already holds at level four
   *  because it read it as part of the objective. */
  foundation: z
    .array(z.object({ title: z.string().trim().min(1).max(160), level: z.number().int().min(0).max(5) }))
    .max(24)
    .optional(),
});
export const projectImportInput = z.object({
  directory: z.string().min(1).max(4000),
  goal: projectGoalField,
});
export const projectIdInput = z.object({ projectId: z.string().uuid() });
export const projectRenameInput = projectIdInput.extend({ name: z.string().trim().min(1).max(80) });
export const projectFlagInput = projectIdInput.extend({ value: z.boolean() });
/** A concept, identified by the project that taught it: concept ids are the
 *  agent's own slugs, so they are only unique within a project. */
export const conceptDeleteInput = projectIdInput.extend({ conceptId: z.string().trim().min(1).max(200) });

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
  /** Set while the learner keeps this project at the top of the list. */
  pinnedAt: string | null;
  /** Set once they have filed it away. Archiving is not deleting: Construct
   *  still knows the project, it just stops offering it. */
  archivedAt: string | null;
  /** False once the directory has been moved or deleted underneath us. The row
   *  stays listed so it can be repaired or removed deliberately. */
  present: boolean;
};

export type ProjectDetail = {
  summary: ProjectSummary;
  messages: AgentMessage[];
  pendingLearnerQuestion: AskUserQuestionRequest | null;
};

/** One entry in a project's file tree. Listing is one level deep, so a
 *  directory carries no children until the learner opens it. */
export type WorkspaceEntry = {
  name: string;
  /** Project-relative, POSIX separators on every host. */
  path: string;
  type: "file" | "directory";
};

/* ---- Files --------------------------------------------------------------
   Paths crossing this boundary are canonicalised before validation, so a
   renderer cannot address anything outside the project it names. */
const workspacePath = z.string().min(1).max(500).transform(canonicalWorkspacePath);
export const workspacePathInput = projectIdInput.extend({ path: workspacePath });
export const workspaceWriteInput = workspacePathInput.extend({ content: z.string().max(2_000_000) });
/* ---- Source files -------------------------------------------------------
   Definitions land outside the project as often as inside it: `console.log`
   is declared in a `.d.ts` under node_modules, and Python's `json.loads` is in
   the interpreter's own standard library. Following one there is what makes
   go-to-definition mean anything, so these three paths are absolute rather
   than project-relative.

   They are also read-only, which is what keeps that safe. Nothing outside the
   project is the learner's to edit from here, so no absolute path ever reaches
   a write — the editor's own saving still goes through `files:write` and the
   containment check that comes with it. */
const absolutePath = z
  .string()
  .min(1)
  .max(4_000)
  /* Windows drive letters as well as POSIX roots: the renderer builds these
     from URIs a language server produced, and a server on Windows produces
     `C:\...`. */
  .refine((value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value), "Not an absolute path.");
export const sourcePathInput = z.object({ path: absolutePath });

/** What the editor needs to know about a path before it reads it. `mtime` is
 *  epoch milliseconds; `size` is bytes, and zero for a directory. */
export type SourceStat = {
  type: "file" | "directory";
  size: number;
  mtime: number;
};

/** One entry of a directory listing, named absolutely so the caller does not
 *  have to join paths the way the host writes them. */
export type SourceEntry = { path: string; name: string; type: "file" | "directory" };

/** Listing the project root is the empty path, which `workspacePath` would
 *  reject — so the directory is optional rather than defaulted to ".". */
export const workspaceListInput = projectIdInput.extend({ directory: workspacePath.optional() });
/** Renaming is two paths, and both are canonicalised the same way: a rename is
 *  the one file operation that can leave the project by way of its destination. */
export const workspaceRenameInput = projectIdInput.extend({ from: workspacePath, to: workspacePath });

/* ---- Terminals ----------------------------------------------------------
   A terminal is a real shell in the project's directory. The renderer names
   it; the main process owns the process. */
const terminalId = z.string().uuid();
export const terminalCreateInput = projectIdInput.extend({
  terminalId,
  cols: z.number().int().min(1).max(1000).optional(),
  rows: z.number().int().min(1).max(1000).optional(),
});
export const terminalWriteInput = z.object({ terminalId, data: z.string().max(100_000) });
export const terminalResizeInput = z.object({ terminalId, cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000) });
export const terminalIdInput = z.object({ terminalId });

/* ---- Language servers ---------------------------------------------------
   The main process frames the protocol and passes messages through; what a
   message means is decided in the renderer, beside the editor it concerns. */
const lspSessionId = z.string().min(1).max(200);
export const lspStartInput = projectIdInput.extend({
  sessionId: lspSessionId,
  /* A catalog id rather than a language. Which languages a server covers is the
     catalog's business — see `languageServers.ts` — and naming a language here
     meant the contract had to be widened every time one was added. */
  serverId: z.string().min(1).max(60),
});
export const lspSendInput = z.object({ sessionId: lspSessionId, message: z.unknown() });
export const lspStopInput = z.object({ sessionId: lspSessionId });
export const lspServerIdInput = z.object({ serverId: z.string().min(1).max(60) });

export type LspEvent = { sessionId: string; kind: "message"; message: unknown } | { sessionId: string; kind: "exit"; code: number | null };

/** One row of Settings → Languages: the catalog entry, and where this machine
 *  stands with it. */
export type LanguageServerStatus = {
  id: string;
  name: string;
  blurb: string;
  extensions: readonly string[];
  /** How it is obtained, so the row can say "bundled" rather than offer an
   *  install button for something already there. */
  via: "bundled" | "npm" | "release" | "toolchain";
  state: "bundled" | "installed" | "available" | "unavailable";
  /** Why it cannot be installed here, when it cannot. */
  reason?: string;
  /** Whether an install is running for it right now. */
  installing: boolean;
};

/** Progress on one install, pushed while it runs. */
export type LanguageServerInstallEvent = { id: string; phase: "installing" | "done" | "failed"; detail: string };

export const agentSendInput = projectIdInput.extend({ body: z.string().trim().min(1).max(20_000) });
export const agentEditInput = agentSendInput.extend({ messageId: z.string().min(1).max(120) });
export const agentAnswerInput = projectIdInput.extend({ answer: z.string().trim().min(1).max(5_000) });

/** A file the agent touched, with the size of the change. Shown on a tool row
 *  so an edit says how much it moved without opening the diff. */
export type AgentActivityFile = { path: string; added: number; removed: number };

/**
 * One event from a turn in flight, as the transcript consumes it.
 *
 * Ported from Spar, because the transcript components were written against this
 * exact shape. `callId` is what lets a tool row update in place rather than
 * appearing twice — once starting, once finished.
 */
export type AgentStreamEvent = {
  runId: string;
  /** Which project this turn is working on. Stamped in the main process, since
   *  the utility process only knows its own request id. */
  projectId?: string;
  type: "text" | "reasoning" | "tool" | "status" | "error" | "done";
  text?: string;
  tool?: string;
  detail?: string;
  /** Correlates a tool's start and end events so a row updates in place. */
  callId?: string;
  phase?: "start" | "end";
  ok?: boolean;
  /** Short human summary of the tool's input — host-generated, and distinct
   *  from `actionTitle`, which is the agent's own caption for the step. */
  label?: string;
  actionTitle?: string;
  /** Arguments and result as formatted JSON: what the learner opens a call to
   *  read. */
  input?: string;
  output?: string;
  files?: AgentActivityFile[];
};

/** One concept the agent has taught in this project, and how far the learner
 *  has got with it. `masteryLevel` indexes MASTERY_RUBRIC — level 3 is the
 *  boundary the concept firewall cares about, since that is where a scoped task
 *  becomes fair to set. */
/** A concept plus where it was learned. The atlas spans projects, so a node
 *  has to be able to say which one it came from. */
export type AtlasConcept = ConceptSummary & { projectId: string; projectName: string };

/** One of the four memory files, as the window shows it. */
export type MemoryFileState = {
  file: "research.md" | "project.md" | "path.md" | "learner.md";
  path: string;
  content: string;
  exists: boolean;
  updatedAt: string | null;
};

/** One step of the teaching path. */
export type PathStep = {
  id: string;
  title: string;
  summary: string;
  status: "planned" | "active" | "completed" | "blocked" | "revising";
  order: number;
  kind: "profile" | "foundation" | "build" | "connect" | "polish" | "ship" | "custom";
  concepts: string[];
  exitCriteria: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectPath = { reason: string; currentNodeId: string | null; nodes: PathStep[] };

/**
 * One context menu, as data.
 *
 * Deliberately generic rather than a menu per surface: the renderer describes
 * what it wants and reads back which item was picked, so the main process needs
 * no knowledge of the tree, the transcript, or anything else that grows a menu
 * later.
 */
export const contextMenuInput = z.object({
  items: z
    .array(
      z.object({
        /* Absent on a separator, which is the one item that cannot be chosen. */
        id: z.string().max(80).optional(),
        label: z.string().max(200).optional(),
        type: z.enum(["normal", "separator"]).optional(),
        enabled: z.boolean().optional(),
        /* Destructive items are not styled differently by either platform's
           menus, so this exists only to keep the caller's intent readable. */
        danger: z.boolean().optional(),
      }),
    )
    .max(30),
});

/**
 * A practice task, as the window sees it.
 *
 * `status` is the learner's side and `outcome` is the agent's: a task goes open
 * → submitted when they say they have done it, and comes back either passed or
 * open again with a note saying what is still missing. The card reads "in
 * review" from exactly that gap.
 */
export type TaskSummary = {
  taskId: string;
  title: string;
  /** What to build and why, as Markdown. */
  brief: string;
  /** What "done" means, one line each — a checklist, not a paragraph. */
  criteria: string[];
  concepts: string[];
  /** Project-relative paths the work belongs in. */
  files: string[];
  status: "open" | "submitted" | "passed";
  outcome: string;
  createdAt: string;
  updatedAt: string;
};

export const taskSubmitInput = projectIdInput.extend({ taskId: z.string().min(1).max(120) });

export type { SyncResult, SyncStatus } from "./sync.js";
import type { SyncResult, SyncStatus } from "./sync.js";

export type ConceptSummary = {
  conceptId: string;
  /** The concept this one sits under. Null for a root, and for a parent that no
   *  longer exists — readers must not assume it resolves. */
  parentId: string | null;
  title: string;
  masteryLevel: 0 | 1 | 2 | 3 | 4 | 5;
  confidence: string;
  /** The evidence behind the current level. */
  note: string;
  /** The note the learner reads: what the idea is, why it matters, a worked
   *  example, and references. A concept with a level and nothing else is a card
   *  with no content, which is what the first cut of this shipped. */
  /** One line for the rail and the cards. */
  summary: string;
  /** The whole note, as Markdown — the encyclopedia entry the learner reads.
   *  One field rather than a set of titled ones: the agent writes prose, and
   *  asking it to fill six boxes produced six stubs instead of one entry. */
  content: string;
  docs: Array<{ title: string; url: string }>;
  tags: string[];
  firstSeenAt: string;
  updatedAt: string;
};

export type AgentEvent =
  /** A turn has begun, and what kind it is. Emitted for every turn, including
   *  the ones Construct starts itself — research and the opening turn — because
   *  the window cannot otherwise tell that it is working. */
  | { projectId: string; kind: "started"; phase: "research" | "opening" | "reply" }
  | { projectId: string; kind: "step"; text: string }
  /** A mastery reading landed. The window re-reads concepts rather than being
   *  handed them, because the store is what resolved the level. */
  | { projectId: string; kind: "concepts" }
  | { projectId: string; kind: "tasks" }
  /* History was rewound to an earlier message: the turns after it, and
     everything they wrote, have been undone. The transcript re-reads. */
  | { projectId: string; kind: "rewound" }
  /* The project named itself. It is created under a literal name cut from the
     goal so the folder exists immediately; the model writes the real one behind
     the window, and this is how the window hears about it. */
  | { projectId: string; kind: "renamed"; name: string }
  /** Flow Memory or the path changed. Both are shown, so a silent write would
   *  leave the window describing a project state that has moved on. */
  | { projectId: string; kind: "memory" }
  | { projectId: string; kind: "path" }
  | { projectId: string; kind: "question"; request: AskUserQuestionRequest }
  | { projectId: string; kind: "message"; message: AgentMessage }
  | { projectId: string; kind: "error"; message: string }
  | { projectId: string; kind: "done" };

export type TerminalEvent =
  | { terminalId: string; kind: "data"; data: string }
  | { terminalId: string; kind: "exit"; exitCode: number };

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
/** What a new project inherits when the learner does not say otherwise. Both
 *  live in Settings; both can still be overridden per project in the dialog. */
export const projectDefaultsInput = z.object({
  directory: z.string().min(1).max(4000).optional(),
  language: languageSchema.optional(),
});
export type ProjectDefaults = { directory: string; language: Language };

/* ---- The learner --------------------------------------------------------
   Who Construct is teaching, held once for the whole application rather than
   once per project.

   Every project already keeps a `learner.md`, and that is the right place for
   what this particular project revealed about them. But the things that do not
   change between projects — that they have written Go for a decade, that they
   want to be shown the shape before the syntax, that they are coming back to
   code after eight years away — were being rediscovered from scratch every
   time, which meant the first turn of every project was spent asking questions
   the learner had already answered.

   So it is collected once, on the way in, and handed to the agent as part of
   its prompt. Not behind a tool: a mentor who has to decide to look you up is a
   mentor who sometimes does not.
*/

/** Where someone is with code, in the coarsest terms that still change how you
 *  would teach them. Four, because a slider from 1 to 10 asks for a precision
 *  nobody has about themselves. */
export const learnerFootingSchema = z.enum(["new", "some", "working", "returning"]);
export type LearnerFooting = z.infer<typeof learnerFootingSchema>;

/** What makes an explanation land for this person. Several may be true at once,
 *  which is why it is a set rather than a choice. */
export const learnerLeaningSchema = z.enum(["shape-first", "hands-first", "first-principles", "by-example"]);
export type LearnerLeaning = z.infer<typeof learnerLeaningSchema>;

/** How much ground to cover per sitting. */
export const learnerPaceSchema = z.enum(["deep", "brisk"]);
export type LearnerPace = z.infer<typeof learnerPaceSchema>;

/** The one question Construct wrote for this person alone, and their answer.
 *  Null when no model was connected to write one, which must never be the
 *  reason the intake cannot finish. */
export const learnerFollowUpSchema = z.object({
  question: z.string().max(400),
  answer: z.string().max(2000),
});

export const learnerProfileInput = z.object({
  name: z.string().max(80),
  footing: learnerFootingSchema,
  language: languageSchema,
  ambition: z.string().max(2000),
  leanings: z.array(learnerLeaningSchema).max(4),
  pace: learnerPaceSchema,
  followUp: learnerFollowUpSchema.nullable(),
  /** Second person, and the learner's to edit. Construct writes a draft from
   *  everything above; what is stored is whatever they let stand. */
  portrait: z.string().max(4000),
});

export type LearnerProfile = z.infer<typeof learnerProfileInput> & {
  /** Absent until the intake has been finished once. */
  updatedAt: string | null;
};

/** What the intake sends when it wants Construct to write something for it.
 *  Partial, because it is asked mid-flow when only the first answers exist. */
export const learnerDraftInput = z.object({
  name: z.string().max(80),
  footing: learnerFootingSchema,
  language: languageSchema,
  ambition: z.string().max(2000),
  leanings: z.array(learnerLeaningSchema).max(4),
  pace: learnerPaceSchema,
  followUp: learnerFollowUpSchema.nullable(),
});

/** The three sizes the window has before it is a workspace, and the workspace
 *  itself. Mirrors the main process's own type; declared here because the
 *  renderer is what decides which one is showing. */
export const windowStageSchema = z.enum(["sign-in", "onboarding", "app"]);
export type WindowStage = z.infer<typeof windowStageSchema>;

export const themePreferenceSchema = z.enum(["system", "light", "dark"]);
/** Mirrors pi-ai's `ModelThinkingLevel`: "off" sends no reasoning directive at all. */
/**
 * How hard the model should think.
 *
 * `off` is the provider's own default and not "no thinking" — pi-ai's request
 * option is `ThinkingLevel`, which has no off. A model that reasons by default
 * keeps reasoning when no directive is sent, so labelling that "Off" promised
 * something the API cannot do. It is presented as "Default" now, and `minimal`
 * is the real floor: the lowest level the provider actually accepts.
 */
export const reasoningEffortSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);
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
  /** Where new projects go, and what they are written in, unless the learner
   *  says otherwise for one of them. */
  projectDefaults: ProjectDefaults;
  /** Who Construct is teaching, and whether they have been through the intake.
   *  Both are here rather than behind a call because the first thing the window
   *  has to decide is which of the two screens to draw. */
  learner: LearnerProfile;
  onboarded: boolean;
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
  setProjectPinned(input: z.infer<typeof projectFlagInput>): Promise<void>;
  setProjectArchived(input: z.infer<typeof projectFlagInput>): Promise<void>;
  /** Removes Construct's record of the project. Never deletes the directory —
   *  the files are the learner's, and Construct did not create most of them. */
  deleteProject(input: z.infer<typeof projectIdInput>): Promise<void>;

  /* Files. Every path is project-relative; the main process resolves it inside
     the project and refuses anything that leaves, symlinks included. */
  listFiles(input: z.infer<typeof workspaceListInput>): Promise<WorkspaceEntry[]>;
  readFile(input: z.infer<typeof workspacePathInput>): Promise<string>;
  writeFile(input: z.infer<typeof workspaceWriteInput>): Promise<void>;
  /** Creates an empty file, and any directories above it. Refuses to overwrite:
   *  the tree's "new file" affordance must never be a way to blank one. */
  createFile(input: z.infer<typeof workspacePathInput>): Promise<void>;
  createDirectory(input: z.infer<typeof workspacePathInput>): Promise<void>;
  renameFile(input: z.infer<typeof workspaceRenameInput>): Promise<void>;
  /** Deletes a file, or a directory and everything in it. This one really does
   *  remove the learner's work, so the window confirms before calling it. */
  removeFile(input: z.infer<typeof workspacePathInput>): Promise<void>;

  /* Source files, by absolute path and read-only. The editor's file system
     reads through these so a definition in node_modules — or in a language's
     own standard library — opens like any other file. */
  statSource(input: z.infer<typeof sourcePathInput>): Promise<SourceStat>;
  readSource(input: z.infer<typeof sourcePathInput>): Promise<string>;
  listSource(input: z.infer<typeof sourcePathInput>): Promise<SourceEntry[]>;

  /* Terminals. Output arrives on `onTerminalEvent` rather than as a return
     value, because a shell produces output for as long as it lives. */
  createTerminal(input: z.infer<typeof terminalCreateInput>): Promise<void>;
  writeTerminal(input: z.infer<typeof terminalWriteInput>): Promise<void>;
  resizeTerminal(input: z.infer<typeof terminalResizeInput>): Promise<void>;
  disposeTerminal(input: z.infer<typeof terminalIdInput>): Promise<void>;
  onTerminalEvent(listener: (event: TerminalEvent) => void): () => void;

  /* Language servers. */
  startLanguageServer(input: z.infer<typeof lspStartInput>): Promise<void>;
  sendToLanguageServer(input: z.infer<typeof lspSendInput>): Promise<void>;
  stopLanguageServer(input: z.infer<typeof lspStopInput>): Promise<void>;
  onLanguageServerEvent(listener: (event: LspEvent) => void): () => void;
  /* The catalog, and getting a server onto this machine. */
  listLanguageServers(): Promise<LanguageServerStatus[]>;
  installLanguageServer(input: z.infer<typeof lspServerIdInput>): Promise<void>;
  uninstallLanguageServer(input: z.infer<typeof lspServerIdInput>): Promise<void>;
  onLanguageServerInstall(listener: (event: LanguageServerInstallEvent) => void): () => void;

  /* The agent. Replies arrive on `onAgentEvent` rather than as a return value:
     a turn runs for as long as it needs and reports progress while it does. */
  agentMessages(input: z.infer<typeof projectIdInput>): Promise<AgentMessage[]>;
  /** Whether a turn is in flight for this project right now, and what kind.
   *  Asked on arrival, because `started` is an event and a window that was not
   *  mounted when it fired has no other way to know. */
  agentStatus(input: z.infer<typeof projectIdInput>): Promise<{
    running: boolean;
    phase: "research" | "opening" | "reply" | null;
    /** The question the agent is blocked on, if it asked one and is still
     *  waiting. Carried here so closing and reopening the chat pane puts the
     *  card back rather than losing it. */
    question: AskUserQuestionRequest | null;
  }>;
  sendToAgent(input: z.infer<typeof agentSendInput>): Promise<void>;
  /** Stops the turn in flight. What the agent already said is kept. */
  stopAgent(input: z.infer<typeof projectIdInput>): Promise<void>;
  /**
   * Rewrites one of the learner's earlier messages and runs from there again.
   *
   * Everything the turns after it did is undone first — the files the agent
   * wrote, the concepts, tasks and path it recorded, and the messages — from a
   * snapshot taken before that turn.
   */
  editMessage(input: z.infer<typeof agentEditInput>): Promise<void>;
  /** Redirects the turn in flight: stops it, keeps what it said, and sends this
   *  as the next thing the agent answers. */
  steerAgent(input: z.infer<typeof agentSendInput>): Promise<void>;
  /** Which of this project's messages can be edited — the ones with an undo
   *  point behind them. */
  undoableMessages(input: z.infer<typeof projectIdInput>): Promise<string[]>;
  answerAgent(input: z.infer<typeof agentAnswerInput>): Promise<void>;
  /** The concepts this project has covered. Re-read after a turn, because a
   *  turn is exactly when mastery moves. */
  listConcepts(input: z.infer<typeof projectIdInput>): Promise<ConceptSummary[]>;
  /** Every concept the learner has met, in any project. What the atlas draws:
   *  understanding is the learner's, not the repository's, so the page that
   *  shows it whole cannot be scoped to one project. */
  conceptAtlas(): Promise<AtlasConcept[]>;
  /** A model-written name for a stated goal, or null when no model is connected
   *  or it could not produce one. Never throws: the dialog keeps a literal
   *  fallback, and naming must not be what stops a project being created. */
  suggestProjectName(input: { goal: string }): Promise<string | null>;
  /** Runs a sync now, or joins the one already running. Null when nobody is
   *  signed in — the app is fully usable without an account. */
  syncNow(): Promise<SyncResult | null>;
  syncStatus(): Promise<SyncStatus>;
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
  listTasks(input: z.infer<typeof projectIdInput>): Promise<TaskSummary[]>;
  /** Says the learner believes the task is done. Moves it to "submitted" and
   *  asks the agent to review it against its own criteria. */
  submitTask(input: z.infer<typeof taskSubmitInput>): Promise<void>;
  /** Forgets a concept. The learner's correction for a concept the agent filed
   *  wrongly — an atlas that cannot be corrected is one they stop trusting. */
  deleteConcept(input: z.infer<typeof conceptDeleteInput>): Promise<void>;
  /** Flow Memory, as the learner would read it. Shown rather than hidden: memory
   *  that only the agent can see is memory nobody can correct. */
  readMemory(input: z.infer<typeof projectIdInput>): Promise<MemoryFileState[]>;
  /** The teaching path: what Construct plans to teach next, in order. */
  readPath(input: z.infer<typeof projectIdInput>): Promise<ProjectPath>;
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  /** The live transcript stream. Separate from `onAgentEvent`, which carries
   *  settled messages and lifecycle, because the transcript is redrawn many
   *  times per second and the two have different consumers. */
  onAgentStream(listener: (event: AgentStreamEvent) => void): () => void;

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
  /**
   * Pops the OS's own context menu and resolves to the chosen item's id, or
   * null if it was dismissed.
   *
   * The menu is built and shown by the main process, so it is a real NSMenu on
   * macOS and a real popup menu on Windows: it takes the platform's metrics,
   * its keyboard handling, its scrolling near a screen edge, and its
   * appearance, none of which an HTML menu gets right for free.
   */
  showContextMenu(input: z.infer<typeof contextMenuInput>): Promise<string | null>;
  setTheme(theme: ThemePreference): Promise<void>;
  /** Changes what new projects inherit. Returns the settled defaults, because
   *  the main process is what knows whether the folder could be made. */
  setProjectDefaults(input: z.infer<typeof projectDefaultsInput>): Promise<ProjectDefaults>;

  /* Who Construct is teaching. */
  readLearner(): Promise<LearnerProfile>;
  /** Stores the profile and marks the intake finished. Also writes the home
   *  language through to the project defaults, because a learner who names
   *  their language on the way in has already answered that question. */
  saveLearner(input: z.infer<typeof learnerProfileInput>): Promise<LearnerProfile>;
  /** The one question Construct writes for this person, from what they have
   *  said so far. Null when no model can be reached — the intake carries on
   *  without it rather than stalling on it. */
  learnerQuestion(input: z.infer<typeof learnerDraftInput>): Promise<string | null>;
  /** The portrait, in Construct's words and the second person. Falls back to a
   *  written-here summary when no model answers, so this never returns empty. */
  learnerPortrait(input: z.infer<typeof learnerDraftInput>): Promise<string>;
  /** Grows or shrinks the window for the screen now showing. */
  setWindowStage(stage: WindowStage): Promise<void>;
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
