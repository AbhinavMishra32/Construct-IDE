import type { ConstructAgentRunEvent } from "../shared/constructLearning";

export type ConstructAgentIterationTrace = {
  iteration: number;
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolResults: Array<{ id: string; name: string; result: unknown; error?: Error }>;
  isFinal: boolean;
  finishReason: string;
};

export type ObservedToolEventState = {
  providerToolCallId: string;
  event: ConstructAgentRunEvent;
  completed: boolean;
};

export type ConstructAgentStreamTraceEntry = {
  title: string;
  detail: string;
  level?: "info" | "warn" | "error" | "debug";
  payload?: unknown;
  event?: ConstructAgentRunEvent;
};

export function iterationDetail(iteration: ConstructAgentIterationTrace): string {
  const toolCallCount = iteration.toolCalls.length;
  const toolResultCount = iteration.toolResults.length;
  if (toolCallCount > 0 || toolResultCount > 0) {
    const missingToolResults = Math.max(0, toolCallCount - toolResultCount);
    return [
      toolCallCount > 0 ? `${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"}` : null,
      toolResultCount > 0 ? `${toolResultCount} result${toolResultCount === 1 ? "" : "s"}` : null,
      missingToolResults > 0 ? `${missingToolResults} missing result${missingToolResults === 1 ? "" : "s"}` : null,
      iteration.isFinal ? "final step" : null,
      iteration.finishReason ? `finish: ${iteration.finishReason}` : null
    ].filter(Boolean).join(" · ");
  }
  return iteration.isFinal ? `Final step · ${iteration.finishReason}` : `Step ${iteration.iteration} · ${iteration.finishReason}`;
}

export function finalizeDanglingToolRunEvents(
  toolEvents: Map<string, ObservedToolEventState>,
  pendingToolInputs: Map<string, string>,
  reason: string,
  onTrace?: (entry: ConstructAgentStreamTraceEntry) => void
): number {
  let finalized = 0;
  for (const state of toolEvents.values()) {
    if (state.completed) continue;
    const input = state.event.input ?? parseMaybeJson(pendingToolInputs.get(state.providerToolCallId));
    state.event = {
      ...state.event,
      status: "error",
      detail: missingToolResultDetail(reason),
      input,
      outputPreview: "Flow did not receive a tool result for this call. The provider stopped before task creation could be confirmed."
    };
    state.completed = true;
    finalized += 1;
    onTrace?.({
      title: "Agent tool result missing",
      level: "warn",
      detail: state.event.detail ?? state.event.title,
      event: state.event,
      payload: {
        type: "missing-tool-result",
        reason,
        providerToolCallId: state.providerToolCallId,
        id: state.event.id,
        toolName: state.event.toolName,
        inputLength: pendingToolInputs.get(state.providerToolCallId)?.length ?? 0
      }
    });
  }
  return finalized;
}

function missingToolResultDetail(reason: string): string {
  if (reason === "stream-end") {
    return "Tool call ended without a result";
  }
  if (reason.startsWith("text") || reason.startsWith("reasoning") || reason === "object") {
    return "Tool call was interrupted before a result";
  }
  return "Tool call did not return a result";
}

function parseMaybeJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
