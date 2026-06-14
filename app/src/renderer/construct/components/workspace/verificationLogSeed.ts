import type { RecallBlock, VerificationLogEntry } from "../../types";

export function buildVerificationStartLogs(recall: RecallBlock): VerificationLogEntry[] {
  if (!recall.verify) {
    return [];
  }

  const now = new Date().toISOString();
  const files = recall.verify.evidence.files;
  const command = recall.verify.evidence.terminalCommand;

  return [
    {
      at: now,
      status: "running",
      message: "Preparing verifier evidence",
      detail: files.length > 0 ? files.join(", ") : "No files declared."
    },
    {
      at: now,
      status: command ? "pending" : "done",
      message: command ? "Terminal command queued" : "No terminal command declared",
      detail: command ?? "The verifier will judge from files and rubric."
    },
    {
      at: now,
      status: "pending",
      message: "Construct Verifier Agent",
      detail: "Goal, rubric, support, references, files, and terminal evidence will be checked together."
    }
  ];
}
