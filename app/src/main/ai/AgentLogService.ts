export type AgentLogChannel = "verifier" | "authoring-review" | "selection-explain" | "interact" | "code-ghost";
export type AgentLogLevel = "info" | "warn" | "error" | "debug";

export type AgentStructuredLogPayload = {
  kind: "structured";
  title: string;
  preview: string;
  raw: string;
  payload: unknown;
};

export type AgentTextLogPayload = {
  kind: "text";
};

export type AgentLogEnvelope = {
  agent: AgentLogChannel;
  message: string;
  level: AgentLogLevel;
  timestamp: string;
  structured?: AgentStructuredLogPayload | AgentTextLogPayload;
};

type PublishAgentLog = (channel: "construct:project:agent-log", payload: AgentLogEnvelope) => void;

export class AgentLogService {
  constructor(private readonly publish: PublishAgentLog) {}

  text(agent: AgentLogChannel, message: string, level: AgentLogLevel = "info"): void {
    this.publish("construct:project:agent-log", {
      agent,
      message,
      level,
      timestamp: new Date().toISOString(),
      structured: {
        kind: "text"
      }
    });
  }

  structured(agent: AgentLogChannel, title: string, payload: unknown, level: AgentLogLevel = "debug"): void {
    const raw = formatAgentPayload(payload);
    this.publish("construct:project:agent-log", {
      agent,
      message: `${title}\n${raw}`,
      level,
      timestamp: new Date().toISOString(),
      structured: {
        kind: "structured",
        title,
        preview: summarizeStructuredPayload(payload),
        raw,
        payload,
      }
    });
  }
}

function formatAgentPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      }
      if (typeof value === "string" && value.length > 60_000) {
        return `${value.slice(0, 60_000)}\n... [truncated]`;
      }
      return value;
    }, 2);
  } catch {
    return String(payload);
  }
}

function summarizeStructuredPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return truncateInline(String(payload ?? ""), 240);
  }

  if (Array.isArray(payload)) {
    return `${payload.length} item${payload.length === 1 ? "" : "s"}`;
  }

  const record = payload as Record<string, unknown>;
  const tracePreview = summarizeAgentTracePayload(record);
  if (tracePreview) {
    return tracePreview;
  }

  const preferredKeys = [
    "type",
    "status",
    "confidence",
    "passed",
    "reason",
    "suggestion",
    "model",
    "provider",
    "requestId",
    "projectId",
    "blockId",
    "tool",
    "query",
    "message",
    "error"
  ];
  const parts: string[] = [];

  for (const key of preferredKeys) {
    if (record[key] !== undefined) {
      parts.push(`${key}: ${truncateInline(JSON.stringify(record[key]), 120)}`);
    }
    if (parts.length >= 4) break;
  }

  if (parts.length === 0) {
    parts.push(...Object.keys(record).slice(0, 5));
  }

  return parts.join(" | ");
}

function summarizeAgentTracePayload(record: Record<string, unknown>): string | undefined {
  const event = isRecord(record.event) ? record.event : undefined;
  const payload = isRecord(record.payload) ? record.payload : undefined;
  const nestedPayload = isRecord(payload?.payload) ? payload.payload : undefined;
  const parts: string[] = [];

  if (event) {
    pushPart(parts, "event", event.type);
    pushPart(parts, "status", event.status);
    pushPart(parts, "title", event.title);
    pushPart(parts, "tool", event.toolName);
    pushPart(parts, "iteration", event.iteration);
  }

  if (payload) {
    pushPart(parts, "chunk", payload.type);
    pushPart(parts, "iteration", payload.iteration);
    pushPart(parts, "maxIterations", payload.maxIterations);
    pushArrayCount(parts, "toolCalls", payload.toolCalls);
    pushArrayCount(parts, "toolResults", payload.toolResults);
    pushPart(parts, "isFinal", payload.isFinal);
    pushPart(parts, "finishReason", payload.finishReason);
  }

  const detailSource = nestedPayload ?? payload;
  if (detailSource) {
    pushPart(parts, "tool", detailSource.toolName);
    pushPart(parts, "toolCallId", detailSource.toolCallId);
    pushPart(parts, "text", detailSource.text);
    pushPart(parts, "delta", detailSource.argsTextDelta);
  }

  pushArrayCount(parts, "toolCalls", record.toolCalls);
  pushArrayCount(parts, "toolResults", record.toolResults);
  pushPart(parts, "isFinal", record.isFinal);
  pushPart(parts, "finishReason", record.finishReason);

  return parts.length > 0 ? parts.slice(0, 7).join(" | ") : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pushPart(parts: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  parts.push(`${label}: ${truncateInline(String(value), 120)}`);
}

function pushArrayCount(parts: string[], label: string, value: unknown): void {
  if (!Array.isArray(value)) return;
  parts.push(`${label}: ${value.length}`);
}

function truncateInline(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
