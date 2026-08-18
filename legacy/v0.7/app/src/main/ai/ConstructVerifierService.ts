import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { runConstructVerifierAgent, type VerificationLogEntry, type VerificationResult } from "../constructVerifierAgent";
import { ConstructLearningStore } from "../constructLearningStore";
import type { StoredProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";
import { ConstructTerminalService } from "../terminal/ConstructTerminalService";
import { ConstructObservabilityService } from "../observability/ConstructObservabilityService";
import { AgentLogService } from "./AgentLogService";
import { ConstructLoggedAgentService } from "./ConstructLoggedAgentService";

const execAsync = promisify(exec);

export class ConstructVerifierService extends ConstructLoggedAgentService {
  constructor(private readonly options: {
    logs: AgentLogService;
    workspace: ConstructProjectWorkspaceService;
    terminal: ConstructTerminalService;
    learningStore: () => ConstructLearningStore;
    sendToRenderers: (channel: string, payload: unknown) => void;
    observability?: ConstructObservabilityService;
  }) {
    super("verifier", options.logs, options.observability);
  }

  async verifyRecall(project: StoredProject, input: any): Promise<VerificationResult> {
    return this.traceAgentOperation(
      "construct.verifier.verifyRecall",
      {
        projectId: project.id,
        recallId: String(input?.recall?.id ?? ""),
        verifyId: String(input?.recall?.verify?.id ?? ""),
        workspacePath: project.workspacePath
      },
      () => this.runVerifyRecall(project, input)
    );
  }

  private async runVerifyRecall(project: StoredProject, input: any): Promise<VerificationResult> {
    const recall = input.recall;
    const verify = recall?.verify;
    const logs: VerificationLogEntry[] = [];
    this.log(`Verification started for recall block ${verify?.id ?? "unknown"}`);

    if (!verify || verify.kind !== "agent") {
      this.addVerificationLog(logs, "failed", "Verification contract is not supported", "Expected ::verify kind=\"agent\".");
      this.log("Verification contract is not supported (expected kind=\"agent\")", "error");
      return this.withVerificationLogs({
        passed: false,
        confidence: "low",
        reason: "This Construct build only supports agent verification for recall blocks.",
        evidence: [],
        suggestion: "Use a ::verify block with kind=\"agent\"."
      }, logs);
    }

    this.addVerificationLog(logs, "running", "Loaded verification contract", String(verify.id ?? "agent verifier"));
    this.addVerificationLog(logs, "done", "Loaded recall task", String(recall.task ?? "No task text supplied."));
    this.addVerificationLog(
      logs,
      "done",
      "Loaded support context",
      String(recall.support ?? "").trim() || "No support text supplied."
    );

    const referenceCount = Array.isArray(input.references) ? input.references.length : 0;
    this.addVerificationLog(
      logs,
      referenceCount > 0 ? "done" : "warning",
      "Collected reference cards",
      referenceCount > 0 ? `${referenceCount} reference card${referenceCount === 1 ? "" : "s"} supplied.` : "No reference cards supplied."
    );

    const conceptCount = Array.isArray(input.concepts) ? input.concepts.length : 0;
    const savedKnowledgeCount = Array.isArray(input.savedKnowledge) ? input.savedKnowledge.length : 0;
    this.addVerificationLog(
      logs,
      conceptCount > 0 ? "done" : "warning",
      "Collected concept context",
      conceptCount > 0
        ? `${conceptCount} concept card${conceptCount === 1 ? "" : "s"} linked to this task.`
        : "No concept cards were linked to this recall task."
    );
    this.addVerificationLog(
      logs,
      savedKnowledgeCount > 0 ? "done" : "warning",
      "Checked saved knowledge",
      savedKnowledgeCount > 0
        ? `${savedKnowledgeCount} saved card${savedKnowledgeCount === 1 ? "" : "s"} available to the verifier.`
        : "No saved knowledge cards are available yet."
    );

    const files = await this.collectEvidenceFiles(project, verify, logs);
    const terminalCommand =
      typeof verify.evidence?.terminalCommand === "string"
        ? verify.evidence.terminalCommand
        : undefined;
    const latestAnswer =
      verify.evidence?.answer === "latest" || recall.mode === "reply"
        ? String(input.answer ?? "")
        : undefined;
    let terminalOutput = this.options.terminal.latestOutput(project.id);

    if (terminalCommand) {
      this.addVerificationLog(logs, "running", "Running verification command", terminalCommand);
      terminalOutput = await this.runVerificationCommand(project, terminalCommand);
      this.options.terminal.appendOutput(project.id, terminalOutput);
      this.addVerificationLog(
        logs,
        terminalOutput.includes("[exit ") ? "failed" : "done",
        terminalOutput.includes("[exit ") ? "Command exited with a failure" : "Command completed",
        this.summarizeTerminalForLog(terminalOutput)
      );
    } else if (verify.evidence?.terminalOutput === "latest") {
      this.addVerificationLog(
        logs,
        "done",
        "Using latest terminal output",
        terminalOutput ? this.summarizeTerminalForLog(terminalOutput) : "No terminal output has been captured for this project yet."
      );
    } else {
      this.addVerificationLog(logs, "done", "No terminal command declared", "The agent will judge from files and rubric only.");
    }

    try {
      this.addVerificationLog(logs, "running", "Evaluating rubric", String(verify.rubric ?? "No rubric supplied."));
      this.addVerificationLog(logs, "running", "Asking Construct Verifier Agent", "Comparing goal, rubric, files, terminal output, task, support, and reference cards.");
      const verifierInput = {
        goal: String(verify.goal ?? ""),
        rubric: String(verify.rubric ?? ""),
        task: String(recall.task ?? ""),
        support: String(recall.support ?? ""),
        references: Array.isArray(input.references)
          ? input.references.map((reference: { id?: unknown; title?: unknown; body?: unknown }) => ({
              id: String(reference.id ?? ""),
              title: String(reference.title ?? ""),
              body: String(reference.body ?? "")
            }))
          : [],
        concepts: Array.isArray(input.concepts)
          ? input.concepts.map((concept: { id?: unknown; title?: unknown; summary?: unknown; why?: unknown; example?: unknown }) => ({
              id: String(concept.id ?? ""),
              title: String(concept.title ?? ""),
              summary: String(concept.summary ?? ""),
              why: String(concept.why ?? ""),
              example: String(concept.example ?? "")
            }))
          : [],
        savedKnowledge: Array.isArray(input.savedKnowledge)
          ? input.savedKnowledge.map((concept: { id?: unknown; title?: unknown; summary?: unknown; why?: unknown; example?: unknown }) => ({
              id: String(concept.id ?? ""),
              title: String(concept.title ?? ""),
              summary: String(concept.summary ?? ""),
              why: String(concept.why ?? ""),
              example: String(concept.example ?? "")
            }))
          : [],
        files,
        terminalCommand,
        terminalOutput,
        answer: latestAnswer,
        messages: {
          success: String(verify.messages?.success ?? ""),
          failure: String(verify.messages?.failure ?? "")
        }
      };
      this.structured("Verifier request", verifierInput);
      const result = await runConstructVerifierAgent(verifierInput, (entry) => {
        if (entry.payload !== undefined) {
          this.structured(entry.title, entry.payload, entry.level ?? "debug");
          return;
        }
        this.log(`${entry.title}\n${entry.detail}`, entry.level ?? "debug");
      });
      await this.options.learningStore().recordRecallAttempt({
        id: randomUUID(),
        projectId: project.id,
        recallId: String(recall.id ?? verify.id),
        mode: recall.mode === "reply" ? "reply" : "code",
        answer: latestAnswer,
        passed: result.passed,
        status: result.status,
        confidence: result.confidence,
        conceptIds: Array.isArray(recall.concepts) ? recall.concepts.map(String) : [],
        createdAt: new Date().toISOString()
      });
      this.addVerificationLog(
        logs,
        result.passed ? "done" : "failed",
        result.passed ? "Verifier passed the recall task" : result.status === "almost" ? "Verifier found the solution is close" : "Verifier did not pass the recall task",
        result.reason
      );
      this.log(`Verification ${result.passed ? "passed" : "failed"} (confidence=${result.confidence}): ${result.reason?.slice(0, 120) ?? "no reason"}`);
      this.structured("Verifier result payload", result);
      return this.withVerificationLogs(result, logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addVerificationLog(logs, "failed", "Verifier agent failed to return a result", message);
      this.log(`Verification failed: ${message}`, "error");
      return this.withVerificationLogs({
        passed: false,
        confidence: "low",
        reason: `Construct verifier could not complete: ${message}`,
        evidence: [
          terminalCommand ? `terminal command: ${terminalCommand}` : "terminal command: none",
          `files supplied: ${files.map((file) => file.path).join(", ") || "none"}`
        ],
        suggestion: "Check verifier credentials and rerun verification when the project evidence is ready."
      }, logs);
    }
  }

  private async collectEvidenceFiles(
    project: StoredProject,
    verify: any,
    logs: VerificationLogEntry[]
  ): Promise<Array<{ path: string; content: string }>> {
    const declaredFiles = Array.isArray(verify.evidence?.files) ? verify.evidence.files : [];
    this.addVerificationLog(
      logs,
      "running",
      "Collecting declared evidence files",
      declaredFiles.length > 0 ? declaredFiles.join(", ") : "No files declared in ::evidence."
    );
    const files = await Promise.all(
      declaredFiles.map(async (relativePath: string) => {
        try {
          const target = this.options.workspace.safeProjectPath(project, relativePath);
          const content = await readFile(target, "utf8");
          this.addVerificationLog(logs, "done", `Read ${relativePath}`, `${content.length} characters`);
          return {
            path: relativePath,
            content
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.addVerificationLog(logs, "warning", `Could not read ${relativePath}`, message);
          return {
            path: relativePath,
            content: `[missing or unreadable file: ${message}]`
          };
        }
      })
    );
    this.addVerificationLog(logs, "done", "Evidence collection finished", `${files.length} file${files.length === 1 ? "" : "s"} supplied to the verifier.`);
    return files;
  }

  private addVerificationLog(
    logs: VerificationLogEntry[],
    status: VerificationLogEntry["status"],
    message: string,
    detail?: string
  ): void {
    const entry = {
      at: new Date().toISOString(),
      status,
      message,
      detail
    };
    logs.push(entry);
    console.log("[construct verifier]", status, message, detail ? { detail } : "");
    this.options.sendToRenderers("construct:project:verify-log", { entry });
  }

  private withVerificationLogs(
    result: VerificationResult,
    logs: VerificationLogEntry[]
  ): VerificationResult {
    return {
      ...result,
      logs
    };
  }

  private summarizeTerminalForLog(output: string): string {
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const summary = lines.slice(-8).join("\n");
    return summary.length > 1200 ? `${summary.slice(0, 1200)}...` : summary || "(no output)";
  }

  private async runVerificationCommand(
    project: StoredProject,
    command: string
  ): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: project.workspacePath,
        maxBuffer: 2 * 1024 * 1024,
        shell: process.env.SHELL || "/bin/zsh"
      });

      return [
        `$ ${command}`,
        stdout,
        stderr
      ].filter(Boolean).join("\n");
    } catch (error) {
      const failed = error as Error & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };

      return [
        `$ ${command}`,
        `[exit ${failed.code ?? "unknown"}]`,
        failed.stdout ?? "",
        failed.stderr ?? "",
        failed.message
      ].filter(Boolean).join("\n");
    }
  }
}
