import { useState, useEffect } from "react";
import {
  FileTree as OpenShellFileTree,
  type FileTreeItem
} from "@/components/open-shell";
import {
  Atom,
  File,
  FileCode,
  FileCss,
  FileJs,
  FileMd,
  FilePy,
  FileTs,
  FileTsx,
  Folder,
  PencilSimpleLine
} from "@phosphor-icons/react";

import type { WorkspaceTreeNode } from "../types";

// Helper to extract parent paths of a file path
function getParentPaths(path: string): string[] {
  const parts = path.split("/");
  const parents: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    parents.push(parts.slice(0, i).join("/"));
  }
  return parents;
}

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
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});

  // Auto-expand parents when activePath changes
  useEffect(() => {
    if (activePath) {
      const parents = getParentPaths(activePath);
      setExpandedPaths((prev) => {
        const next = { ...prev };
        let changed = false;
        parents.forEach((p) => {
          if (!next[p]) {
            next[p] = true;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [activePath]);

  return (
    <OpenShellFileTree
      items={nodes.map((node) => toOpenShellItem(node, activePath, relevantPath, expandedPaths))}
      gitLane={false}
      onSelectPath={(path, item) => {
        if (item.type === "directory") {
          setExpandedPaths((prev) => ({
            ...prev,
            [path]: !prev[path]
          }));
        } else {
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
  relevantPath: string | null,
  expandedPaths: Record<string, boolean>
): FileTreeItem {
  const isExpanded = node.type === "directory" ? !!expandedPaths[node.path] : undefined;
  const isTarget = node.path === relevantPath;
  return {
    name: node.name,
    path: node.path,
    type: node.type,
    icon: iconForFile(node),
    selected: node.path === activePath,
    gitStatus: isTarget ? "modified" : undefined,
    expanded: isExpanded,
    decoration: isTarget ? (
      <span className="construct-file-tree-active-step-indicator" title="Active step file">
        <PencilSimpleLine size={13} weight="bold" />
      </span>
    ) : undefined,
    children: node.children?.map((child) =>
      toOpenShellItem(child, activePath, relevantPath, expandedPaths)
    )
  };
}

function iconForFile(node: WorkspaceTreeNode) {
  const props = { size: 17, weight: "duotone" as const };

  if (node.type === "directory") {
    return <Folder {...props} color="#3584e4" />;
  }

  // React Components (.tsx, .jsx)
  if (/\.(tsx|jsx)$/.test(node.name)) return <Atom {...props} color="#00d8ff" />;

  // TypeScript (.ts, .mts, .cts)
  if (/\.(ts|mts|cts)$/.test(node.name)) return <FileTs {...props} color="#3178c6" />;

  // JavaScript (.js, .mjs, .cjs)
  if (/\.(js|mjs|cjs)$/.test(node.name)) return <FileJs {...props} color="#e9c46a" />;

  // Stylesheets (.css, .scss, .sass, .less)
  if (/\.(css|scss|sass|less)$/.test(node.name)) return <FileCss {...props} color="#a259ff" />;

  // JSON Config
  if (/\.json$/.test(node.name)) return <FileCode {...props} color="#cb8e00" />;

  // Markdown Docs
  if (/\.mdx?$/.test(node.name)) return <FileMd {...props} color="#4d7bbd" />;

  // Python files
  if (/\.(py|ipy)$/.test(node.name)) return <FilePy {...props} color="#3572a5" />;

  // Go files
  if (/\.go$/.test(node.name)) return <FileCode {...props} color="#00add8" />;

  // Swift files
  if (/\.swift$/.test(node.name)) return <FileCode {...props} color="#f05138" />;

  // Rust files
  if (/\.rs$/.test(node.name)) return <FileCode {...props} color="#dea584" />;

  return <File {...props} />;
}
