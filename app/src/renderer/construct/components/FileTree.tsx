import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  FileTree as OpalineFileTree,
  type FileTreeItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@opaline/ui";
import {
  Atom,
  File,
  FileCode,
  FileCss,
  FileJs,
  FileMd,
  FilePlus,
  FilePy,
  FileTs,
  FileTsx,
  Folder,
  FolderPlus,
  PencilSimpleLine,
} from "@phosphor-icons/react";
import {
  Copy,
  FilePen,
  FolderPen,
  Trash2,
  Clipboard,
} from "lucide-react";

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

function generateCopyPath(srcPath: string): string {
  const lastDot = srcPath.lastIndexOf(".");
  const lastSlash = srcPath.lastIndexOf("/");
  if (lastDot > lastSlash) {
    // Has extension
    return `${srcPath.slice(0, lastDot)}_copy${srcPath.slice(lastDot)}`;
  }
  return `${srcPath}_copy`;
}

function resolvePasteDest(copiedPath: string, targetPath: string, targetType: "file" | "directory"): string {
  const fileName = copiedPath.split("/").pop() || "";
  let folderPath = targetPath;
  if (targetType === "file") {
    folderPath = targetPath.includes("/")
      ? targetPath.slice(0, targetPath.lastIndexOf("/"))
      : "";
  }
  return folderPath ? `${folderPath}/${fileName}` : fileName;
}

function getExtension(filename: string): string {
  const parts = filename.split("/");
  const lastPart = parts[parts.length - 1] || "";
  const dotParts = lastPart.split(".");
  return dotParts.length > 1 ? dotParts.pop() || "" : "";
}

function getIconForExtension(ext: string) {
  const props = { size: 17, weight: "duotone" as const };
  const extLower = ext.toLowerCase();
  
  if (["tsx", "jsx"].includes(extLower)) return <Atom {...props} color="#00d8ff" />;
  if (["ts", "mts", "cts"].includes(extLower)) return <FileTs {...props} color="#3178c6" />;
  if (["js", "mjs", "cjs"].includes(extLower)) return <FileJs {...props} color="#e9c46a" />;
  if (["css", "scss", "sass", "less"].includes(extLower)) return <FileCss {...props} color="#a259ff" />;
  if (extLower === "json") return <FileCode {...props} color="#cb8e00" />;
  if (["md", "mdx"].includes(extLower)) return <FileMd {...props} color="#4d7bbd" />;
  if (["py", "ipy"].includes(extLower)) return <FilePy {...props} color="#3572a5" />;
  if (extLower === "go") return <FileCode {...props} color="#00add8" />;
  if (extLower === "swift") return <FileCode {...props} color="#f05138" />;
  if (extLower === "rs") return <FileCode {...props} color="#dea584" />;
  return <File {...props} color="var(--opaline-text-tertiary)" />;
}

// ─── Helpers to find a node by path in the tree ────────────────────────────────

function findNodeByPath(
  nodes: WorkspaceTreeNode[],
  targetPath: string
): WorkspaceTreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

export function FileTree({
  nodes,
  activePath,
  relevantPath,
  onOpenFile,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
  onCreateFolder,
  onDuplicateFile,
}: {
  nodes: WorkspaceTreeNode[];
  activePath: string | null;
  relevantPath: string | null;
  onOpenFile: (path: string) => void;
  onCreateFile?: (path: string) => void;
  onDeleteFile?: (path: string) => Promise<void>;
  onRenameFile?: (oldPath: string, newPath: string) => Promise<void>;
  onCreateFolder?: (path: string) => Promise<void>;
  onDuplicateFile?: (path: string, destPath: string) => Promise<void>;
}) {
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draftPath, setDraftPath] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingState, setCreatingState] = useState<{
    type: "file" | "folder";
    parentPath: string;
  } | null>(null);

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

  // Prefill path directory when starting creation
  useEffect(() => {
    if (isCreating) {
      if (activePath) {
        const parts = activePath.split("/");
        parts.pop(); // Remove filename
        if (parts.length > 0) {
          setDraftPath(parts.join("/") + "/");
        } else {
          setDraftPath("");
        }
      } else {
        setDraftPath("");
      }
    }
  }, [isCreating, activePath]);

  function submitCreate() {
    const nextPath = normalizeDraftPath(draftPath);
    if (!nextPath || !onCreateFile) {
      return;
    }

    setExpandedPaths((prev) => {
      const next = { ...prev };
      for (const parentPath of getParentPaths(nextPath)) {
        next[parentPath] = true;
      }
      return next;
    });
    onCreateFile(nextPath);
    setDraftPath("");
    setIsCreating(false);
  }

  // ── Context menu generator callback passed to OpalineFileTree ──
  const renderRowContextMenu = useCallback((item: FileTreeItem) => {
    const isDir = item.type === "directory";
    const path = item.path;
    const name = item.name;

    const items: React.ReactNode[] = [];

    // Helper folder path for creating items next to files or inside directories
    const folderPath = isDir
      ? path
      : path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : "";

    if (onCreateFile) {
      const handleCreateFile = () => {
        setCreatingState({
          type: "file",
          parentPath: folderPath,
        });
        if (folderPath) {
          setExpandedPaths((prev) => ({
            ...prev,
            [folderPath]: true
          }));
        }
      };

      items.push(
        <ContextMenuItem
          key="new-file"
          onSelect={handleCreateFile}
          onClick={handleCreateFile}
        >
          <FilePlus size={14} weight="duotone" />
          <span>New File</span>
        </ContextMenuItem>
      );
    }

    if (onCreateFolder) {
      const handleCreateFolder = () => {
        setCreatingState({
          type: "folder",
          parentPath: folderPath,
        });
        if (folderPath) {
          setExpandedPaths((prev) => ({
            ...prev,
            [folderPath]: true
          }));
        }
      };

      items.push(
        <ContextMenuItem
          key="new-folder"
          onSelect={handleCreateFolder}
          onClick={handleCreateFolder}
        >
          <FolderPlus size={14} weight="duotone" />
          <span>New Folder</span>
        </ContextMenuItem>
      );
    }

    if (onCreateFile || onCreateFolder) {
      items.push(<ContextMenuSeparator key="sep-new" />);
    }

    // Copy (stores item path in state for Paste)
    const handleCopy = () => {
      setCopiedPath(path);
    };
    items.push(
      <ContextMenuItem
        key="copy"
        onSelect={handleCopy}
        onClick={handleCopy}
      >
        <Copy size={14} />
        <span>Copy</span>
      </ContextMenuItem>
    );

    // Paste (duplicates copied item into/beside target)
    if (copiedPath && onDuplicateFile) {
      const handlePaste = () => {
        let destPath = resolvePasteDest(copiedPath, path, isDir ? "directory" : "file");
        if (destPath === copiedPath) {
          destPath = generateCopyPath(copiedPath);
        }
        const parentOfDest = destPath.includes("/") ? destPath.slice(0, destPath.lastIndexOf("/")) : "";
        if (parentOfDest) {
          setExpandedPaths((prev) => ({
            ...prev,
            [parentOfDest]: true
          }));
        }
        void onDuplicateFile(copiedPath, destPath);
      };

      items.push(
        <ContextMenuItem
          key="paste"
          onSelect={handlePaste}
          onClick={handlePaste}
        >
          <Clipboard size={14} />
          <span>Paste</span>
        </ContextMenuItem>
      );
    }

    // Copy Path (writes path to system clipboard)
    const handleCopyPath = () => {
      void navigator.clipboard.writeText(path);
    };
    items.push(
      <ContextMenuItem
        key="copy-path"
        onSelect={handleCopyPath}
        onClick={handleCopyPath}
      >
        <Copy size={14} />
        <span>Copy Path</span>
      </ContextMenuItem>
    );

    if (onRenameFile) {
      const handleRename = () => {
        setRenamingPath(path);
      };

      items.push(
        <ContextMenuItem
          key="rename"
          onSelect={handleRename}
          onClick={handleRename}
        >
          {isDir ? <FolderPen size={14} /> : <FilePen size={14} />}
          <span>Rename</span>
        </ContextMenuItem>
      );
    }

    if (!isDir && onDuplicateFile) {
      const handleDuplicate = () => {
        void onDuplicateFile(path, "");
      };
      items.push(
        <ContextMenuItem
          key="duplicate"
          onSelect={handleDuplicate}
          onClick={handleDuplicate}
        >
          <Copy size={14} />
          <span>Duplicate</span>
        </ContextMenuItem>
      );
    }

    if (onDeleteFile) {
      const handleDelete = async () => {
        const label = isDir ? `folder "${name}" and all its contents` : `"${name}"`;
        if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
          await onDeleteFile(path);
        }
      };

      items.push(
        <ContextMenuSeparator key="sep-del" />,
        <ContextMenuItem
          key="delete"
          className="text-destructive focus:text-destructive"
          onSelect={() => void handleDelete()}
          onClick={() => void handleDelete()}
        >
          <Trash2 size={14} />
          <span>{isDir ? "Delete Folder" : "Delete"}</span>
        </ContextMenuItem>
      );
    }

    return <ContextMenuContent>{items}</ContextMenuContent>;
  }, [onCreateFile, onCreateFolder, onRenameFile, onDuplicateFile, onDeleteFile, copiedPath]);

  // Transform nodes to Opaline items, injecting the new file/folder creation row if active
  const openShellItems = useMemo(() => {
    function mapNode(node: WorkspaceTreeNode): FileTreeItem {
      const isExpanded = node.type === "directory" ? !!expandedPaths[node.path] : undefined;
      const isTarget = node.path === relevantPath;
      const isRenaming = node.path === renamingPath;

      const childrenItems: FileTreeItem[] = [];

      // If this node is a directory and is expanded, check if we need to insert the inline creation row inside it
      if (node.type === "directory" && node.children) {
        node.children.forEach((child) => {
          childrenItems.push(mapNode(child));
        });

        if (creatingState && creatingState.parentPath === node.path) {
          // Add virtual creation node at the end of directory children
          const tempPath = node.path ? `${node.path}/__new_item__` : "__new_item__";
          childrenItems.push({
            name: "",
            path: tempPath,
            type: creatingState.type === "folder" ? "directory" : "file",
            icon: creatingState.type === "folder" ? <Folder size={17} weight="duotone" /> : <File size={17} weight="duotone" />,
            isEditing: true,
            onEditSubmit: (val) => {
              const trimmed = val.trim();
              if (trimmed && onCreateFile && onCreateFolder) {
                const newPath = node.path ? `${node.path}/${trimmed}` : trimmed;
                if (creatingState.type === "folder") {
                  void onCreateFolder(newPath);
                } else {
                  onCreateFile(newPath);
                }
              }
              setCreatingState(null);
            },
            onEditCancel: () => {
              setCreatingState(null);
            }
          });
        }
      }

      return {
        name: node.name,
        path: node.path,
        type: node.type,
        icon: iconForFile(node),
        selected: node.path === activePath,
        gitStatus: isTarget ? "modified" : undefined,
        expanded: isExpanded,
        decoration: isTarget ? (
          <span className="flex size-4 items-center justify-center text-primary" title="Active step file">
            <PencilSimpleLine size={13} weight="bold" />
          </span>
        ) : undefined,
        isEditing: isRenaming,
        onEditSubmit: (val) => {
          const trimmed = val.trim();
          if (trimmed && trimmed !== node.name && onRenameFile) {
            const parentDir = node.path.includes("/")
              ? node.path.slice(0, node.path.lastIndexOf("/"))
              : "";
            const newPath = parentDir ? `${parentDir}/${trimmed}` : trimmed;
            void onRenameFile(node.path, newPath);
          }
          setRenamingPath(null);
        },
        onEditCancel: () => {
          setRenamingPath(null);
        },
        children: childrenItems.length > 0 ? childrenItems : undefined,
      };
    }

    // Map root level nodes
    const rootItems = nodes.map((node) => mapNode(node));

    // If we are creating in the root directory (parentPath is empty string)
    if (creatingState && creatingState.parentPath === "") {
      rootItems.push({
        name: "",
        path: "__new_item__",
        type: creatingState.type === "folder" ? "directory" : "file",
        icon: creatingState.type === "folder" ? <Folder size={17} weight="duotone" /> : <File size={17} weight="duotone" />,
        isEditing: true,
        onEditSubmit: (val) => {
          const trimmed = val.trim();
          if (trimmed && onCreateFile && onCreateFolder) {
            if (creatingState.type === "folder") {
              void onCreateFolder(trimmed);
            } else {
              onCreateFile(trimmed);
            }
          }
          setCreatingState(null);
        },
        onEditCancel: () => {
          setCreatingState(null);
        }
      });
    }

    return rootItems;
  }, [nodes, activePath, relevantPath, expandedPaths, renamingPath, creatingState, onCreateFile, onCreateFolder, onRenameFile]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-2">
        <span className="text-xs font-medium">Explorer</span>
        <div className="flex items-center gap-0.5">
          {onCreateFile ? (
            <button
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              type="button"
              onClick={() => setIsCreating((value) => !value)}
              title="New File..."
              aria-label="New File"
            >
              <FilePlus size={15} weight="duotone" />
            </button>
          ) : null}
        </div>
      </div>

      {isCreating ? (
        <div className="shrink-0 border-b p-2">
          <div className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 [&_svg]:size-4">
            {getIconForExtension(getExtension(draftPath))}
            <input className="min-w-0 flex-1 bg-transparent text-xs outline-none"
              value={draftPath}
              onChange={(event) => setDraftPath(event.currentTarget.value)}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitCreate();
                }
                if (event.key === "Escape") {
                  setIsCreating(false);
                }
              }}
              onBlur={() => {
                if (draftPath.trim()) {
                  submitCreate();
                } else {
                  setIsCreating(false);
                }
              }}
              placeholder="src/filename.ts"
              aria-label="New file path"
            />
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        <OpalineFileTree
          items={openShellItems}
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
          renderRowContextMenu={renderRowContextMenu}
        />
      </div>
    </div>
  );
}

function normalizeDraftPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
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
