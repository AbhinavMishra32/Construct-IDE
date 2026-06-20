import type { WebContents } from "electron";

import { sendCodeGhostStreamToRenderer } from "../constructCodeGhostAgent";
import { resolveConstructAiSettings } from "../constructAiSettings";
import { ConstructObservabilityService } from "../observability/ConstructObservabilityService";
import { AgentLogService } from "./AgentLogService";
import { ConstructLoggedAgentService } from "./ConstructLoggedAgentService";

export class ConstructCodeGhostService extends ConstructLoggedAgentService {
  constructor(logs: AgentLogService, observability?: ConstructObservabilityService) {
    super("code-ghost", logs, observability);
  }

  explain(sender: WebContents, input: any): void {
    const requestId = String(input?.requestId ?? "");
    const lineNumber = Number(input?.lineNumber ?? 0);

    if (!requestId || !lineNumber) {
      sender.send("construct:project:code-ghost:token", {
        requestId, lineNumber, token: "", done: true, error: "Invalid request"
      });
      return;
    }

    const settings = resolveConstructAiSettings();
    if (settings.codeGhostEnabled === false) {
      sender.send("construct:project:code-ghost:token", {
        requestId, lineNumber, token: "", done: true, error: "Code Ghost is disabled"
      });
      return;
    }

    this.log(`Ghost completion requested at line ${lineNumber} (${input?.language ?? "unknown"})`);
    this.structured("Code ghost request", {
      requestId,
      lineNumber,
      lineContent: String(input?.lineContent ?? ""),
      language: String(input?.language ?? "unknown"),
      linesBefore: Array.isArray(input?.linesBefore) ? input.linesBefore.map(String) : [],
      linesAfter: Array.isArray(input?.linesAfter) ? input.linesAfter.map(String) : []
    });
    this.traceAgentOperation(
      "construct.codeGhost.explain",
      {
        requestId,
        lineNumber,
        language: String(input?.language ?? "unknown")
      },
      () => sendCodeGhostStreamToRenderer(
        sender,
        {
          lineContent: String(input?.lineContent ?? ""),
          language: String(input?.language ?? "unknown"),
          linesBefore: Array.isArray(input?.linesBefore) ? input.linesBefore.map(String) : [],
          linesAfter: Array.isArray(input?.linesAfter) ? input.linesAfter.map(String) : []
        },
        "construct:project:code-ghost:token",
        requestId,
        lineNumber,
        (entry) => {
          if (entry.payload !== undefined) {
            this.structured(entry.title, entry.payload, entry.level ?? "debug");
            return;
          }
          this.log(`${entry.title}\n${entry.detail}`, entry.level ?? "debug");
        }
      )
    ).catch((err) => {
      this.log(`Ghost completion failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      console.error("[code ghost] fatal:", err);
      try { sender.send("construct:project:code-ghost:token", { requestId, lineNumber, token: "", done: true, error: String(err) }); } catch {}
    });
  }
}
