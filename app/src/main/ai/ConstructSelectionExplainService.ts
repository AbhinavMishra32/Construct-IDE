import { randomUUID } from "node:crypto";

import {
  runConstructSelectionExplainAgent,
  type SelectionExplanationLogEntry
} from "../constructSelectionExplainAgent";
import { ConstructObservabilityService } from "../observability/ConstructObservabilityService";
import type { StoredProject } from "../projects/ConstructProjectTypes";
import { AgentLogService } from "./AgentLogService";
import { ConstructLoggedAgentService } from "./ConstructLoggedAgentService";

export class ConstructSelectionExplainService extends ConstructLoggedAgentService {
  constructor(private readonly options: {
    logs: AgentLogService;
    sendToRenderers: (channel: string, payload: unknown) => void;
    observability?: ConstructObservabilityService;
  }) {
    super("selection-explain", options.logs, options.observability);
  }

  async explain(project: StoredProject, input: any): Promise<unknown> {
    return this.traceAgentOperation(
      "construct.selectionExplain.explain",
      {
        projectId: project.id,
        source: String(input?.selection?.source ?? "workspace"),
        sourceLabel: String(input?.selection?.sourceLabel ?? "unknown"),
        filePath: typeof input?.selection?.filePath === "string" ? input.selection.filePath : ""
      },
      () => this.runExplain(project, input)
    );
  }

  private async runExplain(project: StoredProject, input: any): Promise<unknown> {
    const requestId = String(input?.requestId ?? randomUUID());
    this.log(`Explaining selection from ${input?.selection?.source ?? "workspace"} (${input?.selection?.sourceLabel ?? "unknown"})`);
    this.structured("Selection explanation request", {
      requestId,
      projectId: project.id,
      workspacePath: project.workspacePath,
      selection: input?.selection ?? {},
      learningContext: input?.learningContext ?? {}
    });
    console.log("[selection explain] request started", {
      requestId,
      projectId: project.id,
      source: input?.selection?.source,
      filePath: input?.selection?.filePath
    });

    const progress = (entry: Omit<SelectionExplanationLogEntry, "at">) => {
      const payload = { requestId, entry: { ...entry, at: new Date().toISOString() } };
      this.options.sendToRenderers("construct:project:explain-selection-log", payload);
      const level = entry.status === "failed" ? "error" : entry.status === "running" ? "info" : "debug";
      this.log(`[${entry.status}] ${entry.message}${entry.detail ? ` - ${entry.detail}` : ""}`, level);
      console.log("[selection explain]", entry.status, entry.message, entry.detail ?? "");
    };

    try {
      const result = await runConstructSelectionExplainAgent({
        projectId: project.id,
        workspacePath: project.workspacePath,
        selection: {
          text: String(input?.selection?.text ?? ""),
          source: String(input?.selection?.source ?? "workspace"),
          sourceLabel: String(input?.selection?.sourceLabel ?? "Construct workspace"),
          contextText: String(input?.selection?.contextText ?? "").slice(0, 18_000),
          filePath: typeof input?.selection?.filePath === "string" ? input.selection.filePath : undefined,
          language: typeof input?.selection?.language === "string" ? input.selection.language : undefined,
          lineStart: Number.isInteger(input?.selection?.lineStart) ? input.selection.lineStart : undefined,
          lineEnd: Number.isInteger(input?.selection?.lineEnd) ? input.selection.lineEnd : undefined
        },
        learningContext: input?.learningContext ?? {}
      }, progress, (entry) => {
        if (entry.payload !== undefined) {
          this.structured(entry.title, entry.payload, entry.level ?? "debug");
          return;
        }
        this.log(`${entry.title}\n${entry.detail}`, entry.level ?? "debug");
      });
      this.structured("Selection explanation result payload", result);
      return result;
    } catch (error) {
      progress({ status: "failed", message: "Explanation failed", detail: error instanceof Error ? error.message : String(error), tool: "agent" });
      throw error;
    }
  }
}
