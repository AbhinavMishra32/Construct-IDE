import {
  FileTree as OpenShellFileTree,
  type FileTreeItem
} from "@/components/open-shell";

import type { WorkspaceTreeNode } from "../types";

export function FileTree({
  nodes,
  activePath,
  relevantPath,
  onOpenFile
}: {
  nodes: WorkspaceTreeNode[];
  activePath: string | null;
  relevantPath: string | null;
  onOpenFile: (path: string) => void;
}) {
  return (
    <OpenShellFileTree
      items={nodes.map((node) => toOpenShellItem(node, activePath, relevantPath))}
      onSelectPath={onOpenFile}
    />
  );
}

function toOpenShellItem(
  node: WorkspaceTreeNode,
  activePath: string | null,
  relevantPath: string | null
): FileTreeItem {
  return {
    name: node.name,
    path: node.path,
    type: node.type,
    selected: node.path === activePath,
    gitStatus: node.path === relevantPath ? "modified" : undefined,
    children: node.children?.map((child) =>
      toOpenShellItem(child, activePath, relevantPath)
    )
  };
}
