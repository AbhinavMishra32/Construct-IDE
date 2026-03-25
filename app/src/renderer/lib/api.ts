import type {
  AgentEvent,
  BlueprintDeepDiveRequest,
  BlueprintDeepDiveResponse,
  BlueprintBuildDetailResponse,
  AuthSessionCreateResponse,
  AuthSessionView,
  BlueprintBuildEventRecord,
  BlueprintBuildListResponse,
  BlueprintBuildStage,
  AgentJobCreatedResponse,
  AgentJobSnapshot,
  BlueprintEnvelope,
  CheckReviewRequest,
  CheckReviewResponse,
  CurrentPlanningSessionResponse,
  LearnerProfileResponse,
  LearnerModel,
  ProjectSelectionResponse,
  ProjectsDashboardResponse,
  PlanningAnswer,
  PlanningSessionCompleteResponse,
  PlanningSessionStartResponse,
  RuntimeGuideRequest,
  RuntimeGuideResponse,
  RunnerHealth,
  ProviderConnectionsResponse,
  TaskProgress,
  TaskResult,
  TaskStartResponse,
  TaskSubmitResponse,
  TaskTelemetry,
  WorkspaceFileEnvelope,
  WorkspaceFilesEnvelope
} from "../types";

export const RUNNER_BASE_URL = "http://127.0.0.1:43110";
const RUNNER_SESSION_STORAGE_KEY = "construct.auth.sessionToken";

export function getStoredSessionToken(): string | null {
  const value = window.localStorage.getItem(RUNNER_SESSION_STORAGE_KEY)?.trim();
  return value && value.length > 0 ? value : null;
}

export function setStoredSessionToken(sessionToken: string | null): void {
  if (!sessionToken) {
    window.localStorage.removeItem(RUNNER_SESSION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(RUNNER_SESSION_STORAGE_KEY, sessionToken);
}

export async function fetchAuthSession(signal?: AbortSignal): Promise<AuthSessionView> {
  return getJson<AuthSessionView>("/auth/session", { signal });
}

export async function signUpWithPassword(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthSessionCreateResponse> {
  return postJson<AuthSessionCreateResponse>("/auth/signup", input, "creating your account", {
    withAuth: false
  });
}

export async function loginWithPassword(input: {
  email: string;
  password: string;
}): Promise<AuthSessionCreateResponse> {
  return postJson<AuthSessionCreateResponse>("/auth/login", input, "signing in", {
    withAuth: false
  });
}

export async function logoutCurrentSession(): Promise<void> {
  await postJson<{ ok: true }>("/auth/logout", {}, "signing out");
  setStoredSessionToken(null);
}

export async function updateAccount(input: {
  displayName: string;
}): Promise<AuthSessionView> {
  return postJson<AuthSessionView>("/auth/account", input, "updating your profile");
}

export async function fetchProviderConnections(
  signal?: AbortSignal
): Promise<ProviderConnectionsResponse> {
  return getJson<ProviderConnectionsResponse>("/auth/connections", { signal });
}

export async function saveProviderApiKey(input: {
  provider: "openai" | "codex" | "anthropic" | "tavily" | "langsmith" | "exa";
  label?: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<ProviderConnectionsResponse> {
  return postJson<ProviderConnectionsResponse>(
    "/auth/connections",
    {
      ...input,
      authType: "api-key"
    },
    `saving ${input.provider} credentials`
  );
}

export async function removeProviderConnection(input: {
  provider: "openai" | "codex" | "anthropic" | "tavily" | "langsmith" | "exa";
  authType: "api-key" | "oauth";
}): Promise<ProviderConnectionsResponse> {
  return postJson<ProviderConnectionsResponse>(
    "/auth/connections/remove",
    input,
    `removing ${input.provider} credentials`
  );
}

export async function fetchRunnerHealth(signal?: AbortSignal): Promise<RunnerHealth> {
  return getJson<RunnerHealth>("/health", { signal });
}

export async function fetchBlueprint(signal?: AbortSignal): Promise<BlueprintEnvelope> {
  return getJson<BlueprintEnvelope>("/blueprint/current", { signal });
}

export async function fetchProjectsDashboard(
  signal?: AbortSignal
): Promise<ProjectsDashboardResponse> {
  return getJson<ProjectsDashboardResponse>("/projects", { signal });
}

export async function selectProject(projectId: string): Promise<ProjectSelectionResponse> {
  return postJson<ProjectSelectionResponse>("/projects/select", { projectId }, "selecting project");
}

export async function syncCurrentProjectStep(stepId: string): Promise<void> {
  const response = await fetch(`${RUNNER_BASE_URL}/projects/current-step`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify({
      stepId
    })
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while syncing ${stepId}.`);
  }
}

export async function fetchCurrentPlanningState(
  signal?: AbortSignal
): Promise<CurrentPlanningSessionResponse> {
  return getJson<CurrentPlanningSessionResponse>("/agent/planning/current", { signal });
}

export async function fetchBlueprintBuilds(
  signal?: AbortSignal
): Promise<BlueprintBuildListResponse> {
  return getJson<BlueprintBuildListResponse>("/debug/blueprints", { signal });
}

export async function fetchBlueprintBuildDetail(
  buildId: string,
  signal?: AbortSignal
): Promise<BlueprintBuildDetailResponse> {
  return getJson<BlueprintBuildDetailResponse>(`/debug/blueprints/${encodeURIComponent(buildId)}`, {
    signal
  });
}

export function openBlueprintBuildStream(
  buildId: string,
  input: {
    onDetail: (detail: BlueprintBuildDetailResponse) => void;
    onStage: (stage: BlueprintBuildStage) => void;
    onEvent: (event: BlueprintBuildEventRecord) => void;
    onState?: (detail: BlueprintBuildDetailResponse["build"]) => void;
    onError?: (error: Error) => void;
  }
): () => void {
  const stream = new EventSource(
    withSessionTokenQuery(
      `${RUNNER_BASE_URL}/debug/blueprints/${encodeURIComponent(buildId)}/stream`
    )
  );
  let closed = false;

  stream.addEventListener("build-detail", (event) => {
    try {
      input.onDetail(JSON.parse(event.data) as BlueprintBuildDetailResponse);
    } catch (error) {
      input.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });

  stream.addEventListener("build-stage", (event) => {
    try {
      input.onStage(JSON.parse(event.data) as BlueprintBuildStage);
    } catch (error) {
      input.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });

  stream.addEventListener("build-event", (event) => {
    try {
      input.onEvent(JSON.parse(event.data) as BlueprintBuildEventRecord);
    } catch (error) {
      input.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });

  stream.addEventListener("build-state", (event) => {
    try {
      input.onState?.(JSON.parse(event.data) as BlueprintBuildDetailResponse["build"]);
    } catch (error) {
      input.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });

  stream.addEventListener("build-end", () => {
    closed = true;
    stream.close();
  });

  stream.addEventListener("error", () => {
    if (!closed) {
      input.onError?.(new Error(`Lost blueprint build stream for ${buildId}.`));
    }
  });

  return () => {
    closed = true;
    stream.close();
  };
}

export async function startPlanningSession(input: {
  goal: string;
  learningStyle: "concept-first" | "build-first" | "example-first";
}, onEvent?: (event: AgentEvent) => void): Promise<PlanningSessionStartResponse> {
  return runAgentJob<PlanningSessionStartResponse>(
    "/agent/planning/start-job",
    input,
    onEvent
  );
}

export async function completePlanningSession(input: {
  sessionId: string;
  answers: PlanningAnswer[];
}, onEvent?: (event: AgentEvent) => void): Promise<PlanningSessionCompleteResponse> {
  return runAgentJob<PlanningSessionCompleteResponse>(
    "/agent/planning/complete-job",
    input,
    onEvent
  );
}

export async function requestRuntimeGuide(
  input: RuntimeGuideRequest,
  onEvent?: (event: AgentEvent) => void
): Promise<RuntimeGuideResponse> {
  return runAgentJob<RuntimeGuideResponse>("/agent/runtime/guide-job", input, onEvent);
}

export async function requestBlueprintDeepDive(
  input: BlueprintDeepDiveRequest,
  onEvent?: (event: AgentEvent) => void
): Promise<BlueprintDeepDiveResponse> {
  return runAgentJob<BlueprintDeepDiveResponse>(
    "/agent/blueprint/deepen-job",
    input,
    onEvent
  );
}

export async function fetchWorkspaceFiles(
  signal?: AbortSignal
): Promise<WorkspaceFilesEnvelope> {
  return getJson<WorkspaceFilesEnvelope>("/workspace/files", { signal });
}

export async function fetchWorkspaceFile(
  filePath: string,
  signal?: AbortSignal
): Promise<WorkspaceFileEnvelope> {
  const encodedPath = encodeURIComponent(filePath);
  return getJson<WorkspaceFileEnvelope>(`/workspace/file?path=${encodedPath}`, { signal });
}

export async function saveWorkspaceFile(
  filePath: string,
  content: string
): Promise<void> {
  const response = await fetch(`${RUNNER_BASE_URL}/workspace/file`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify({
      path: filePath,
      content
    })
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while saving ${filePath}.`);
  }
}

export async function executeBlueprintTask(
  blueprintPath: string,
  stepId: string
): Promise<TaskResult> {
  const response = await fetch(`${RUNNER_BASE_URL}/tasks/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify({
      blueprintPath,
      stepId
    })
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while executing ${stepId}.`);
  }

  return parseJsonResponse<TaskResult>(response, `executing ${stepId}`);
}

export async function startBlueprintTask(
  blueprintPath: string,
  stepId: string
): Promise<TaskStartResponse> {
  const response = await fetch(`${RUNNER_BASE_URL}/tasks/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify({
      blueprintPath,
      stepId
    })
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while starting ${stepId}.`);
  }

  return parseJsonResponse<TaskStartResponse>(response, `starting ${stepId}`);
}

export async function submitBlueprintTask(input: {
  blueprintPath: string;
  stepId: string;
  sessionId: string;
  telemetry: TaskTelemetry;
  timeoutMs?: number;
}): Promise<TaskSubmitResponse> {
  const response = await fetch(`${RUNNER_BASE_URL}/tasks/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while submitting ${input.stepId}.`);
  }

  return parseJsonResponse<TaskSubmitResponse>(response, `submitting ${input.stepId}`);
}

export async function fetchTaskProgress(
  stepId: string,
  signal?: AbortSignal
): Promise<TaskProgress> {
  const encodedStepId = encodeURIComponent(stepId);
  return getJson<TaskProgress>(`/tasks/progress?stepId=${encodedStepId}`, { signal });
}

export async function fetchLearnerModel(signal?: AbortSignal): Promise<LearnerModel> {
  return getJson<LearnerModel>("/learner/model", { signal });
}

export async function fetchLearnerProfile(
  signal?: AbortSignal
): Promise<LearnerProfileResponse> {
  return getJson<LearnerProfileResponse>("/learner/profile", { signal });
}

export async function reviewStepCheck(
  input: CheckReviewRequest
): Promise<CheckReviewResponse> {
  return postJson<CheckReviewResponse>("/checks/review", input, `reviewing ${input.check.id}`);
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${RUNNER_BASE_URL}${path}`, withAuthInit(init));

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} for ${path}.`);
  }

  return parseJsonResponse<T>(response, path);
}

async function runAgentJob<T>(
  path: string,
  input: unknown,
  onEvent?: (event: AgentEvent) => void
): Promise<T> {
  const created = await postJson<AgentJobCreatedResponse>(path, input, `starting ${path}`);

  return new Promise<T>((resolve, reject) => {
    const stream = new EventSource(withSessionTokenQuery(`${RUNNER_BASE_URL}${created.streamPath}`));
    let settled = false;
    let recoveryInFlight = false;

    const settleFromSnapshot = (snapshot: AgentJobSnapshot) => {
      if (settled) {
        return;
      }

      if (snapshot.status === "completed") {
        settled = true;
        window.clearInterval(intervalHandle);
        stream.close();
        resolve(snapshot.result as T);
        return;
      }

      if (snapshot.status === "failed") {
        fail(new Error(snapshot.error ?? "Agent job failed."));
      }
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearInterval(intervalHandle);
      stream.close();
      reject(error);
    };

    const intervalHandle = window.setInterval(() => {
      if (settled || recoveryInFlight) {
        return;
      }

      recoveryInFlight = true;
      void recoverAgentJob(created)
        .then((snapshot) => {
          settleFromSnapshot(snapshot);
        })
        .catch(() => {
          // Ignore polling misses while the stream remains open.
        })
        .finally(() => {
          recoveryInFlight = false;
        });
    }, 1_000);

    stream.addEventListener("agent-event", (event) => {
      try {
        onEvent?.(JSON.parse((event as MessageEvent).data) as AgentEvent);
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("Failed to parse agent event stream.")
        );
      }
    });

    stream.addEventListener("agent-state", (event) => {
      try {
        settleFromSnapshot(
          JSON.parse((event as MessageEvent).data) as AgentJobSnapshot
        );
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("Failed to parse agent state stream.")
        );
      }
    });

    stream.addEventListener("agent-complete", (event) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearInterval(intervalHandle);
      stream.close();
      resolve((JSON.parse((event as MessageEvent).data) as { result: T }).result);
    });

    stream.addEventListener("agent-error", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { error?: string };
      fail(new Error(data.error ?? "Agent job failed."));
    });

    stream.addEventListener("agent-end", () => {
      if (settled) {
        return;
      }

      void recoverAgentJob(created)
        .then(settleFromSnapshot)
        .catch((error) => {
          fail(
            error instanceof Error
              ? error
              : new Error("Agent stream ended before completion.")
          );
        });
    });

    stream.onerror = () => {
      if (settled) {
        return;
      }

      void recoverAgentJob(created)
        .then((snapshot) => {
          settleFromSnapshot(snapshot);

          if (!settled) {
            fail(new Error(snapshot.error ?? "Agent stream disconnected before completion."));
          }
        })
        .catch((error) => {
          fail(
            error instanceof Error
              ? error
              : new Error("Agent stream disconnected before completion.")
          );
        });
    };
  });
}

async function recoverAgentJob(
  created: AgentJobCreatedResponse
): Promise<AgentJobSnapshot> {
  return getJson<AgentJobSnapshot>(created.resultPath);
}

async function postJson<T>(
  path: string,
  input: unknown,
  context: string,
  options: {
    withAuth?: boolean;
  } = {}
): Promise<T> {
  const response = await fetch(`${RUNNER_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.withAuth === false ? {} : buildAuthHeaders())
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while ${context}.`);
  }

  return parseJsonResponse<T>(response, context);
}

function withAuthInit(init?: RequestInit): RequestInit | undefined {
  if (!init) {
    const headers = buildAuthHeaders();
    return Object.keys(headers).length > 0 ? { headers } : undefined;
  }

  return {
    ...init,
    headers: {
      ...(init.headers ? normalizeHeaders(init.headers) : {}),
      ...buildAuthHeaders()
    }
  };
}

function buildAuthHeaders(): Record<string, string> {
  const token = getStoredSessionToken();
  return token
    ? {
        Authorization: `Bearer ${token}`
      }
    : {};
}

function withSessionTokenQuery(url: string): string {
  const token = getStoredSessionToken();
  if (!token) {
    return url;
  }

  const resolved = new URL(url);
  resolved.searchParams.set("sessionToken", token);
  return resolved.toString();
}

function normalizeHeaders(headers: HeadersInit): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
  const rawBody = await response.text();

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    const bodyPreview = rawBody.trim().slice(0, 180) || "<empty body>";
    throw new Error(`Runner returned a non-JSON response while ${context}: ${bodyPreview}`);
  }
}
