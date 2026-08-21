import type { MemoryService } from "../memory/memoryService.js";
import type { ProjectStore } from "../store/projectStore.js";

/**
 * The path: the ordered steps between where the learner is and the project they
 * set out to build.
 *
 * v0.7 called this the Flow path, and the name mattered — it is not a filesystem
 * path and not a curriculum. It is what the agent has decided to teach, in order,
 * for *this* learner on *this* project, and it is revised whenever the evidence
 * about them changes. Without it the agent teaches whatever the last message was
 * about, which is how a learner ends up with six half-explained ideas and no
 * project.
 *
 * Stored twice on purpose. The rows are the structured truth the UI draws and the
 * next turn reads; `path.md` is the same thing as prose in the learner's own
 * repository, so the plan is legible without Construct. The mirror is written
 * from the rows, never the other way round.
 */
export type PathNodeStatus = "planned" | "active" | "completed" | "blocked" | "revising";
export type PathNodeKind = "profile" | "foundation" | "build" | "connect" | "polish" | "ship" | "custom";

export type PathNodeInput = {
  id: string;
  title: string;
  summary: string;
  kind?: string;
  status?: string;
  concepts?: string[];
  exitCriteria?: string[];
};

export type PathNode = {
  id: string;
  title: string;
  summary: string;
  status: PathNodeStatus;
  order: number;
  kind: PathNodeKind;
  concepts: string[];
  exitCriteria: string[];
  createdAt: string;
  updatedAt: string;
};

export type PlannedPath = {
  reason: string;
  currentNodeId: string | null;
  nodes: PathNode[];
};

const STATUSES: readonly PathNodeStatus[] = ["planned", "active", "completed", "blocked", "revising"];
const KINDS: readonly PathNodeKind[] = ["profile", "foundation", "build", "connect", "polish", "ship", "custom"];

export class PathService {
  constructor(
    private readonly store: ProjectStore,
    private readonly memory: MemoryService,
  ) {}

  read(projectId: string): PlannedPath {
    return { reason: "", currentNodeId: this.store.currentPathNode(projectId), nodes: this.store.listPathNodes(projectId) };
  }

  /**
   * Records a path, keeping what the learner has already finished.
   *
   * Completed steps stay completed even if the agent's new plan lists them as
   * planned again: the plan is the agent's opinion, but what the learner has
   * actually done is a fact, and a replan that quietly un-finishes their work
   * would make the path untrustworthy exactly when it matters — after a
   * revision.
   */
  async plan(
    project: { id: string; directory: string },
    input: { reason: string; currentNodeId?: string | undefined; nodes: PathNodeInput[] },
  ): Promise<PlannedPath> {
    const now = new Date().toISOString();
    const existing = new Map(this.store.listPathNodes(project.id).map((node) => [node.id, node]));
    const completed = new Set([...existing.values()].filter((node) => node.status === "completed").map((node) => node.id));

    const named = input.currentNodeId && input.nodes.some((node) => node.id === input.currentNodeId) ? input.currentNodeId : null;
    /* Falls to the first unfinished step when the agent does not name one, which
       is nearly always what it meant. */
    const firstOpen = input.nodes.find((node) => !completed.has(node.id) && node.status !== "completed");
    const currentNodeId = named ?? firstOpen?.id ?? input.nodes[0]?.id ?? null;

    const nodes: PathNode[] = input.nodes
      .filter((node) => node.id.trim() && node.title.trim())
      .map((node, order) => {
        const before = existing.get(node.id);
        const status: PathNodeStatus = completed.has(node.id)
          ? "completed"
          : STATUSES.includes(node.status as PathNodeStatus)
            ? (node.status as PathNodeStatus)
            : node.id === currentNodeId
              ? "active"
              : "planned";
        return {
          id: node.id.trim(),
          title: node.title.trim(),
          summary: node.summary.trim(),
          status,
          order,
          kind: KINDS.includes(node.kind as PathNodeKind) ? (node.kind as PathNodeKind) : "custom",
          concepts: node.concepts ?? [],
          exitCriteria: node.exitCriteria ?? [],
          createdAt: before?.createdAt ?? now,
          updatedAt: now,
        };
      });

    this.store.replacePath(project.id, nodes, currentNodeId);
    await this.memory.update(project.directory, [{ file: "path.md", content: format(nodes, currentNodeId, input.reason) }]);

    return { reason: input.reason, currentNodeId, nodes };
  }

  /** Marks one step finished and moves the current step to the next open one.
   *  Called when the agent judges the learner has met a step's exit criteria. */
  async complete(project: { id: string; directory: string }, nodeId: string, reason: string): Promise<PlannedPath> {
    const nodes = this.store.listPathNodes(project.id).map((node) => (node.id === nodeId ? { ...node, status: "completed" as const } : node));
    const next = nodes.find((node) => node.status !== "completed")?.id ?? null;
    this.store.replacePath(project.id, nodes, next);
    await this.memory.update(project.directory, [{ file: "path.md", content: format(nodes, next, reason) }]);
    return { reason, currentNodeId: next, nodes };
  }
}

/**
 * The path as prose, for `path.md`.
 *
 * Generated from the rows every time rather than patched, and that is the one
 * place in memory where a full rewrite is right: this file is a rendering of
 * structured state, so a patch could put it out of step with the thing it
 * describes.
 */
function format(nodes: PathNode[], currentNodeId: string | null, reason: string): string {
  const ordered = [...nodes].sort((a, b) => a.order - b.order);
  const current = ordered.find((node) => node.id === currentNodeId);

  return [
    "# Path",
    "",
    `Now: ${current ? current.title : "not chosen yet"}`,
    "",
    `Why this path: ${reason}`,
    "",
    "## Steps",
    "",
    ...ordered.flatMap((node) => [
      `### ${node.order + 1}. ${node.title}${node.id === currentNodeId ? " ← here" : ""}`,
      "",
      `Status: ${node.status}`,
      "",
      node.summary,
      "",
      node.concepts.length ? `Concepts: ${node.concepts.join(", ")}` : "Concepts: none recorded yet.",
      "",
      node.exitCriteria.length ? `Done when: ${node.exitCriteria.join("; ")}` : "Done when: not stated.",
      "",
    ]),
    "## Handoff",
    "",
    "The structured path on the project record is the source of truth; this file is its readable copy. Revise the path when what the learner can do changes.",
  ].join("\n");
}
