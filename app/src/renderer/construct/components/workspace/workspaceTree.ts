import type { WorkspaceTreeNode } from "../../types";

export function flattenTree(nodes: WorkspaceTreeNode[]): string[] {
  const result: string[] = [];

  function visit(node: WorkspaceTreeNode) {
    if (node.type === "file") {
      result.push(node.path);
    } else if (node.children) {
      node.children.forEach(visit);
    }
  }

  nodes.forEach(visit);
  return result;
}
