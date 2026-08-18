import type { ConstructFlowProjectSettings } from "../../../../shared/constructFlow";

export const defaultFlowProjectSettings: ConstructFlowProjectSettings = {
  projectType: "agent",
  codebaseState: "empty",
  projectPhase: "build",
  setupScope: "standard",
  packageManager: "auto",
  testStrategy: "unit",
  docsLevel: "standard",
  gitStrategy: "initialize",
  agentEdits: "ask",
  openWorkspace: true
};

export function inferFlowTitle(goal: string): string {
  const stripped = goal
    .replace(/^i\s*(am|'m)?\s*(making|building|creating|working on)\s+/i, "")
    .replace(/^a\s+/i, "")
    .trim();
  const words = stripped.split(/\s+/).filter(Boolean).slice(0, 7);
  return words.length ? words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") : "Flow Project";
}
