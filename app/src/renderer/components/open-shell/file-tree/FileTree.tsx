import type { CSSProperties, ReactNode } from "react";
import "./file-tree.css";

export type FileTreeItem = {
  children?: FileTreeItem[];
  decoration?: ReactNode;
  gitStatus?: "added" | "modified" | "deleted" | "renamed";
  id?: string;
  locked?: boolean;
  name: string;
  path: string;
  selected?: boolean;
  type?: "file" | "directory";
};

export function FileTree({
  coloredIcons = true,
  items,
  onSelectPath,
  search = true,
}: {
  coloredIcons?: boolean;
  items: FileTreeItem[];
  onSelectPath?: (path: string, item: FileTreeItem) => void;
  search?: boolean;
}) {
  return (
    <div className="codex-file-tree" data-file-tree-colored-icons={coloredIcons ? "true" : undefined}>
      <FileTreeIconSprite />
      <div
        className="codex-file-tree-root"
        data-file-tree-has-context-menu-action-lane="true"
        data-file-tree-has-git-lane="true"
        data-file-tree-virtualized-root="true"
        role="tree"
        tabIndex={-1}
      >
        {search ? (
          <div data-file-tree-search-container="true">
            <label className="codex-file-tree-search-label" htmlFor="codex-file-tree-search">
              Filter files
            </label>
            <div className="codex-file-tree-search-field">
              <SearchIcon />
              <input
                id="codex-file-tree-search"
                data-file-tree-search-input="true"
                placeholder="Filter files…"
                aria-label="Filter files"
              />
            </div>
          </div>
        ) : null}
        <div data-file-tree-virtualized-scroll="true">
          <div data-file-tree-virtualized-list="true">
            {items.map((item) => (
              <FileTreeRow key={item.path} item={item} level={1} onSelectPath={onSelectPath} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FileTreeRow({
  item,
  level,
  onSelectPath,
}: {
  item: FileTreeItem;
  level: number;
  onSelectPath?: (path: string, item: FileTreeItem) => void;
}) {
  const isDirectory = item.type === "directory" || item.children != null;
  const iconName = isDirectory ? "file-tree-icon-chevron" : item.locked === true ? "file-tree-icon-lock" : "file-tree-icon-file";
  const iconToken = getIconToken(item.name, isDirectory);

  return (
    <>
      <button
        className="codex-file-tree-row"
        data-file-tree-sticky-path={level === 1 ? item.path : undefined}
        data-file-tree-sticky-row={level === 1 && isDirectory ? "true" : undefined}
        data-path={item.path}
        data-type="item"
        role="treeitem"
        aria-expanded={isDirectory ? "true" : undefined}
        aria-level={level}
        data-item-selected={item.selected ? "true" : undefined}
        data-item-type={isDirectory ? "directory" : "file"}
        onClick={() => onSelectPath?.(item.path, item)}
        type="button"
        style={{ "--tree-depth": String(level - 1) } as CSSProperties}
      >
        <span data-item-section="icon">
          <svg data-icon-name={iconName} data-icon-token={iconToken} aria-hidden="true">
            <use href={`#${iconName}`} />
          </svg>
        </span>
        <span data-item-section="content">{item.name}</span>
        <span data-item-section="decoration">
          {item.decoration}
        </span>
        <span data-item-section="git">{item.gitStatus != null ? <GitDot status={item.gitStatus} /> : null}</span>
        <span data-item-section="action">
          <svg data-icon-name="file-tree-icon-ellipsis" aria-hidden="true">
            <use href="#file-tree-icon-ellipsis" />
          </svg>
        </span>
      </button>
      {isDirectory
        ? item.children?.map((child) => (
            <FileTreeRow key={child.path} item={child} level={level + 1} onSelectPath={onSelectPath} />
          ))
        : null}
    </>
  );
}

function GitDot({ status }: { status: NonNullable<FileTreeItem["gitStatus"]> }) {
  return (
    <span className="codex-file-tree-git-dot" data-git-status={status}>
      {status.slice(0, 1).toUpperCase()}
    </span>
  );
}

function getIconToken(name: string, isDirectory: boolean) {
  if (isDirectory) {
    return "default";
  }
  if (/\.(tsx|ts)$/.test(name)) {
    return "typescript";
  }
  if (/\.(jsx|js|mjs|cjs)$/.test(name)) {
    return "javascript";
  }
  if (/\.css$/.test(name)) {
    return "css";
  }
  if (/\.json$/.test(name)) {
    return "json";
  }
  if (/\.mdx?$/.test(name)) {
    return "markdown";
  }
  return "default";
}

function SearchIcon() {
  return (
    <svg className="codex-file-tree-search-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M8.75 3.75a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm4.1 7.1 3.15 3.15"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function FileTreeIconSprite() {
  return (
    <svg data-icon-sprite="" aria-hidden="true" width="0" height="0">
      <symbol id="file-tree-icon-chevron" viewBox="0 0 16 16">
        <path d="M12.4697 5.46973C12.7626 5.17684 13.2374 5.17684 13.5303 5.46973C13.8232 5.76262 13.8232 6.23738 13.5303 6.53028L8.53028 11.5303C8.23738 11.8232 7.76262 11.8232 7.46973 11.5303L2.46973 6.53028C2.17684 6.23738 2.17684 5.76262 2.46973 5.46973C2.76262 5.17684 3.23738 5.17684 3.53028 5.46973L8 9.93946L12.4697 5.46973Z" fill="currentcolor" />
      </symbol>
      <symbol id="file-tree-icon-dot" viewBox="0 0 6 6">
        <circle cx="3" cy="3" r="3" />
      </symbol>
      <symbol id="file-tree-icon-file" viewBox="0 0 16 16">
        <path fill="currentColor" d="M8 1v3a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1z" className="bg" opacity=".5" />
        <path fill="currentColor" d="M9.5 1a.5.5 0 0 1 .354.146l4 4A.5.5 0 0 1 14 5.5V6h-3a2 2 0 0 1-2-2V1z" className="fg" />
      </symbol>
      <symbol id="file-tree-icon-lock" viewBox="0 0 16 16">
        <path fill="currentcolor" d="M4 5.336V4a4 4 0 1 1 8 0v1.336c1.586.54 2 1.843 2 4.664v1c0 4.118-.883 5-5 5H7c-4.117 0-5-.883-5-5v-1c0-2.821.414-4.124 2-4.664M5.5 4v1.054Q6.166 4.998 7 5h2q.834-.002 1.5.054V4a2.5 2.5 0 0 0-5 0m-2 6v1c0 .995.055 1.692.167 2.193.107.483.246.686.35.79s.307.243.79.35c.5.112 1.198.167 2.193.167h2c.995 0 1.692-.055 2.193-.166.483-.108.686-.247.79-.35.104-.105.243-.308.35-.791.112-.5.167-1.198.167-2.193v-1c0-.995-.055-1.692-.166-2.193-.108-.483-.247-.686-.35-.79-.105-.104-.308-.243-.791-.35C10.693 6.555 9.995 6.5 9 6.5H7c-.995 0-1.692.055-2.193.167-.483.107-.686.246-.79.35s-.243.307-.35.79C3.555 8.307 3.5 9.005 3.5 10" />
      </symbol>
      <symbol id="file-tree-icon-ellipsis" viewBox="0 0 16 16">
        <path d="M5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M9.5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M14 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
      </symbol>
    </svg>
  );
}
