import type { ConstructFlowPathNode, ConstructFlowSession } from "../../shared/constructFlow";
import { isFlowProject, type StoredFlowProject, type StoredProject } from "../projects/ConstructProjectTypes";

const liveFlowProjectSnapshots = new Map<string, StoredFlowProject>();

export function rememberFlowProjectSnapshot(project: StoredFlowProject): void {
  liveFlowProjectSnapshots.set(project.id, project);
}

export function forgetFlowProjectSnapshot(projectId: string): void {
  liveFlowProjectSnapshots.delete(projectId);
}

export function applyLiveFlowProjectSnapshot<T extends StoredProject>(project: T): T {
  if (!isFlowProject(project)) return project;
  const snapshot = liveFlowProjectSnapshots.get(project.id);
  if (!snapshot) return project;
  return mergeFlowProjectSnapshot(project, snapshot) as T;
}

export function mergeFlowProjectSnapshot(current: StoredFlowProject, snapshot: StoredFlowProject): StoredFlowProject {
  const snapshotIsNewer = flowUpdatedTime(snapshot) >= flowUpdatedTime(current);
  const flow = snapshotIsNewer
    ? { ...current.flow, ...snapshot.flow }
    : { ...snapshot.flow, ...current.flow };
  const sessions = mergeFlowSessions(current.flow.sessions ?? [], snapshot.flow.sessions ?? []);
  const pathNodes = mergePathNodes(current.flow.pathNodes ?? [], snapshot.flow.pathNodes ?? []);
  return {
    ...current,
    progress: snapshotIsNewer ? snapshot.progress : current.progress,
    completedAt: snapshotIsNewer ? snapshot.completedAt ?? current.completedAt : current.completedAt,
    flow: {
      ...flow,
      researchCompletedAt: flow.researchCompletedAt ?? current.flow.researchCompletedAt ?? snapshot.flow.researchCompletedAt ?? null,
      pathNodes: pathNodes.length > 0 ? pathNodes : flow.pathNodes,
      currentPathNodeId: flow.currentPathNodeId ?? current.flow.currentPathNodeId ?? snapshot.flow.currentPathNodeId ?? null,
      pathCreatedAt: flow.pathCreatedAt ?? current.flow.pathCreatedAt ?? snapshot.flow.pathCreatedAt,
      pathUpdatedAt: latestIso(current.flow.pathUpdatedAt, snapshot.flow.pathUpdatedAt) ?? flow.pathUpdatedAt,
      sessions,
      updatedAt: latestIso(current.flow.updatedAt, snapshot.flow.updatedAt) ?? flow.updatedAt
    }
  };
}

function mergeFlowSessions(current: ConstructFlowSession[], snapshot: ConstructFlowSession[]): ConstructFlowSession[] {
  const byId = new Map<string, ConstructFlowSession>();
  for (const session of current) {
    byId.set(session.id, cloneSession(session));
  }
  for (const session of snapshot) {
    const existing = byId.get(session.id);
    byId.set(session.id, existing ? newestSession(existing, session) : cloneSession(session));
  }
  return [...byId.values()].sort((a, b) => sessionCreatedTime(a) - sessionCreatedTime(b));
}

function mergePathNodes(current: ConstructFlowPathNode[], snapshot: ConstructFlowPathNode[]): ConstructFlowPathNode[] {
  const byId = new Map<string, ConstructFlowPathNode>();
  for (const node of current) {
    byId.set(node.id, clonePathNode(node));
  }
  for (const node of snapshot) {
    const existing = byId.get(node.id);
    byId.set(node.id, existing ? newestPathNode(existing, node) : clonePathNode(node));
  }
  return [...byId.values()].sort((a, b) => a.order - b.order);
}

function newestPathNode(current: ConstructFlowPathNode, snapshot: ConstructFlowPathNode): ConstructFlowPathNode {
  const currentTime = parseIsoTime(current.updatedAt) ?? 0;
  const snapshotTime = parseIsoTime(snapshot.updatedAt) ?? 0;
  if (snapshotTime > currentTime) return clonePathNode(snapshot);
  if (snapshotTime < currentTime) return clonePathNode(current);
  return (snapshot.taskIds?.length ?? 0) >= (current.taskIds?.length ?? 0)
    ? clonePathNode(snapshot)
    : clonePathNode(current);
}

function newestSession(current: ConstructFlowSession, snapshot: ConstructFlowSession): ConstructFlowSession {
  const currentTime = sessionUpdatedTime(current);
  const snapshotTime = sessionUpdatedTime(snapshot);
  if (snapshotTime > currentTime) return cloneSession(snapshot);
  if (snapshotTime < currentTime) return cloneSession(current);
  return sessionCompletenessScore(snapshot) >= sessionCompletenessScore(current)
    ? cloneSession(snapshot)
    : cloneSession(current);
}

function sessionCompletenessScore(session: ConstructFlowSession): number {
  return [
    session.status === "completed" ? 10 : session.status === "waiting" ? 5 : 0,
    session.questionResponse ? 8 : 0,
    session.toolCalls.filter((toolCall) => toolCall.response).length * 5,
    session.messages.length,
    session.toolCalls.length,
    session.timeline?.length ?? 0,
    session.agentEvents.length
  ].reduce((total, value) => total + value, 0);
}

function flowUpdatedTime(project: StoredFlowProject): number {
  return parseIsoTime(project.flow.updatedAt) ?? parseIsoTime(project.lastOpenedAt) ?? 0;
}

function sessionUpdatedTime(session: ConstructFlowSession): number {
  return parseIsoTime(session.updatedAt) ?? sessionCreatedTime(session);
}

function sessionCreatedTime(session: ConstructFlowSession): number {
  return parseIsoTime(session.createdAt) ?? 0;
}

function latestIso(a: string | null | undefined, b: string | null | undefined): string | undefined {
  const aTime = parseIsoTime(a) ?? 0;
  const bTime = parseIsoTime(b) ?? 0;
  if (aTime === 0 && bTime === 0) return (a ?? b) ?? undefined;
  return (bTime > aTime ? b : a) ?? undefined;
}

function parseIsoTime(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function cloneSession(session: ConstructFlowSession): ConstructFlowSession {
  return clonePlain(session);
}

function clonePathNode(node: ConstructFlowPathNode): ConstructFlowPathNode {
  return clonePlain(node);
}

function clonePlain<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}
