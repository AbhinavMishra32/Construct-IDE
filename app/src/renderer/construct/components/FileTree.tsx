import {
  FileTree as OpenShellFileTree,
  type FileTreeItem
} from "@/components/open-shell";
import {
  File,
  FileCode,
  FileCss,
  FileJs,
  FileMd,
  FileTs,
  FileTsx,
  Folder
} from "@phosphor-icons/react";

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
      gitLane={false}
      onSelectPath={(path, item) => {
        if (item.type !== "directory") {
          onOpenFile(path);
        }
      }}
      searchPlaceholder="Search files..."
      showActions={false}
      variant="sidebar"
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
    icon: iconForFile(node),
    selected: node.path === activePath,
    gitStatus: node.path === relevantPath ? "modified" : undefined,
    children: node.children?.map((child) =>
      toOpenShellItem(child, activePath, relevantPath)
    )
  };
}

function iconForFile(node: WorkspaceTreeNode) {
  const props = { size: 17, weight: "duotone" as const };

  if (node.type === "directory") {
    return <Folder {...props} />;
  }

  if (/\.(tsx)$/.test(node.name)) return <FileTsx {...props} />;
  if (/\.(ts|mts|cts)$/.test(node.name)) return <FileTs {...props} />;
  if (/\.(js|jsx|mjs|cjs)$/.test(node.name)) return <FileJs {...props} />;
  if (/\.css$/.test(node.name)) return <FileCss {...props} />;
  if (/\.json$/.test(node.name)) return <FileCode {...props} />;
  if (/\.mdx?$/.test(node.name)) return <FileMd {...props} />;

  return <File {...props} />;
}
