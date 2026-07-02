import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  FileTree as OpalineFileTree,
  type FileTreeItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  Button,
} from "@opaline/ui";
import {
  FilePlus,
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
  RotateCw,
  Search,
  FolderOpen,
  Plus,
} from "lucide-react";

import type { WorkspaceTreeNode } from "../types";
import { iconForFile as renderFileIcon } from "./workspace/fileIcons";

// Helper to extract parent paths of a file path
function getParentPaths(path: string): string[] {
  const parts = path.split("/");
  const parents: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    parents.push(parts.slice(0, i).join("/"));
  }
  return parents;
}

function expandedPathRecord(paths: string[]): Record<string, boolean> {
  return Object.fromEntries(paths.filter((path) => path.trim()).map((path) => [path, true]));
}

function expandedPathList(paths: Record<string, boolean>): string[] {
  return Object.keys(paths).filter((path) => paths[path]).sort();
}

function sameExpandedPaths(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
  const leftPaths = expandedPathList(left);
  const rightPaths = expandedPathList(right);
  return leftPaths.length === rightPaths.length && leftPaths.every((path, index) => path === rightPaths[index]);
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
  expandedPaths: persistedExpandedPaths,
  onOpenFile,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
  onCreateFolder,
  onDuplicateFile,
  onExpandedPathsChange,
  onRefresh,
}: {
  nodes: WorkspaceTreeNode[];
  activePath: string | null;
  relevantPath: string | null;
  expandedPaths?: string[];
  onOpenFile: (path: string) => void;
  onCreateFile?: (path: string) => void;
  onDeleteFile?: (path: string) => Promise<void>;
  onRenameFile?: (oldPath: string, newPath: string) => Promise<void>;
  onCreateFolder?: (path: string) => Promise<void>;
  onDuplicateFile?: (path: string, destPath: string) => Promise<void>;
  onExpandedPathsChange?: (paths: string[]) => void;
  onRefresh?: () => void;
}) {
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>(() => expandedPathRecord(persistedExpandedPaths ?? []));
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draftPath, setDraftPath] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingState, setCreatingState] = useState<{
    type: "file" | "folder";
    parentPath: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setExpandedPaths(expandedPathRecord(persistedExpandedPaths ?? []));
  }, [persistedExpandedPaths]);

  const updateExpandedPaths = useCallback((updater: (current: Record<string, boolean>) => Record<string, boolean>) => {
    setExpandedPaths((current) => {
      const next = updater(current);
      if (sameExpandedPaths(current, next)) {
        return current;
      }
      onExpandedPathsChange?.(expandedPathList(next));
      return next;
    });
  }, [onExpandedPathsChange]);

  // Auto-expand parents when activePath changes
  useEffect(() => {
    if (activePath) {
      const parents = getParentPaths(activePath);
      updateExpandedPaths((prev) => {
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
  }, [activePath, updateExpandedPaths]);

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

  // Filter nodes based on search query
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return nodes;

    const query = searchQuery.toLowerCase().trim();

    function filterNodeList(nodeList: WorkspaceTreeNode[]): WorkspaceTreeNode[] {
      return nodeList
        .map((node) => {
          if (node.type === "directory") {
            const filteredChildren = node.children ? filterNodeList(node.children) : [];
            const nameMatches = node.name.toLowerCase().includes(query);
            if (nameMatches || filteredChildren.length > 0) {
              return {
                ...node,
                children: filteredChildren,
              };
            }
          } else {
            if (node.name.toLowerCase().includes(query)) {
              return node;
            }
          }
          return null;
        })
        .filter((node): node is WorkspaceTreeNode => node !== null);
    }

    return filterNodeList(nodes);
  }, [nodes, searchQuery]);

  // Transform nodes to Opaline items, injecting the new file/folder creation row if active
  const openShellItems = useMemo(() => {
    function mapNode(node: WorkspaceTreeNode): FileTreeItem {
      const isExpanded = node.type === "directory"
        ? (searchQuery.trim() ? true : !!expandedPaths[node.path])
        : undefined;
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
            icon: creatingState.type === "folder" ? <Folder size={14} weight="duotone" /> : renderFileIcon("", { size: 14 }),
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
        icon: renderFileIcon(node.name, { size: 14, type: node.type }),
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
    const rootItems = filteredNodes.map((node) => mapNode(node));

    // If we are creating in the root directory (parentPath is empty string)
    if (creatingState && creatingState.parentPath === "") {
      rootItems.push({
        name: "",
        path: "__new_item__",
        type: creatingState.type === "folder" ? "directory" : "file",
        icon: creatingState.type === "folder" ? <Folder size={12} weight="duotone" /> : renderFileIcon("", { size: 12 }),
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
  }, [filteredNodes, searchQuery, activePath, relevantPath, expandedPaths, renamingPath, creatingState, onCreateFile, onCreateFolder, onRenameFile]);

  const showEmptyWorkspaceState = nodes.length === 0 && !creatingState;
  const showEmptySearchState = nodes.length > 0 && filteredNodes.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="shrink-0 flex items-center gap-1.5 px-3 pb-2 pt-3">
        <label className="flex h-8 flex-1 items-center gap-2 rounded-[6px] border bg-background/70 px-2.5 ring-offset-background focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-ring/25">
          <Search className="size-3.5 shrink-0 text-muted-foreground/50" />
          <input
            type="text"
            className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/45"
            value={searchQuery}
            placeholder="Search files..."
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        {onRefresh && (
          <button
            className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            type="button"
            onClick={onRefresh}
            title="Refresh Explorer"
            aria-label="Refresh Explorer"
          >
            <RotateCw size={13} />
          </button>
        )}
      </div>

      {isCreating ? (
        <div className="shrink-0 border-b p-2">
          <div className="flex h-7 items-center gap-2 rounded-[8px] border bg-background/70 px-2 shadow-sm [&_svg]:size-4">
            {renderFileIcon(draftPath || "file", { size: 16 })}
            <input className="min-w-0 flex-1 bg-transparent text-xs outline-none"
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
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

      {showEmptyWorkspaceState ? (
        <div className="flex flex-col items-center justify-center pt-20 pb-12 px-5 text-center text-muted-foreground animate-in fade-in duration-300">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-sidebar-accent/50 border border-sidebar-border/30 shadow-[inset_0_1px_2px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.15)] mb-4">
            <FolderOpen className="size-5 text-muted-foreground/80" />
          </div>
          <h3 className="text-[13px] font-semibold text-foreground tracking-tight">No files in project</h3>
          <p className="text-[11.5px] text-muted-foreground/65 mt-1.5 max-w-[200px] leading-relaxed">
            Create a file to get started.
          </p>
          {onCreateFile && (
            <Button
              variant="outline"
              onClick={() =>
                setCreatingState({
                  type: "file",
                  parentPath: "",
                })
              }
              className="mt-4 px-3 gap-1 active:scale-[0.97] transition-transform duration-150"
              style={{ fontSize: "11px", borderRadius: "12px" }}
            >
              <Plus className="size-3" />
              <span>Create File</span>
            </Button>
          )}
        </div>
      ) : showEmptySearchState ? (
        <div className="flex flex-col items-center justify-center pt-20 pb-12 px-5 text-center text-muted-foreground animate-in fade-in duration-300">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-sidebar-accent/50 border border-sidebar-border/30 shadow-[inset_0_1px_2px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.15)] mb-4">
            <Search className="size-5 text-muted-foreground/80" />
          </div>
          <h3 className="text-[13px] font-semibold text-foreground tracking-tight">No matches found</h3>
          <p className="text-[11.5px] text-muted-foreground/65 mt-1.5 max-w-[200px] leading-relaxed">
            No files match "{searchQuery}"
          </p>
          <Button
            variant="outline"
            onClick={() => setSearchQuery("")}
            className="mt-4 px-3 active:scale-[0.97] transition-transform duration-150"
            style={{ fontSize: "11px", borderRadius: "12px" }}
          >
            Clear Search
          </Button>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <OpalineFileTree
            className="[&_[data-file-tree-virtualized-list=true]]:pb-9"
            items={openShellItems}
            gitLane={false}
            onSelectPath={(path, item) => {
              if (item.type === "directory") {
                updateExpandedPaths((prev) => ({
                  ...prev,
                  [path]: !prev[path]
                }));
              } else {
                onOpenFile(path);
              }
            }}
            search={false}
            showActions={true}
            variant="sidebar"
            renderRowContextMenu={renderRowContextMenu}
          />
        </div>
      )}
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
