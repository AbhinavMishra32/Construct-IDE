import type { ReactNode } from "react";
import { FileTree } from "../file-tree/FileTree";
import type { FileTreeItem } from "../file-tree/FileTree";
import { CodexMark } from "../icons/CodexMark";
import "./file-browser-panel.css";

export type FileBrowserPanelProps = {
  breadcrumbs?: string[];
  code?: string;
  fileName?: string;
  fileTree: FileTreeItem[];
  language?: string;
  tabIcon?: ReactNode;
};

export function FileBrowserPanel({
  breadcrumbs = ["desktop-agent-app", "package.json"],
  code = defaultCode,
  fileName = "package.json",
  fileTree,
  language = "json",
  tabIcon,
}: FileBrowserPanelProps) {
  return (
    <section className="codex-file-browser-panel" data-codex-file-browser-panel="true">
      <header className="codex-file-browser-topbar">
        <div className="codex-file-browser-tab" data-active="true">
          <span className="codex-file-browser-tab-icon">{tabIcon ?? <JsonIcon />}</span>
          <span className="codex-file-browser-tab-title">{fileName}</span>
        </div>
        <button className="codex-file-browser-tab-add" type="button" aria-label="Open another panel">
          +
        </button>
        <div className="codex-file-browser-window-actions">
          <button type="button" aria-label="Expand right panel">
            <ExpandIcon />
          </button>
          <button type="button" aria-label="Hide bottom panel">
            <BottomPanelMiniIcon />
          </button>
          <button type="button" aria-label="Hide right panel">
            <RightPanelMiniIcon />
          </button>
        </div>
      </header>

      <div className="codex-file-browser-toolbar">
        <nav className="codex-file-browser-breadcrumbs" aria-label="File path">
          {breadcrumbs.map((breadcrumb, index) => (
            <span key={`${breadcrumb}-${index}`}>
              {index > 0 ? <ChevronRightIcon /> : null}
              <span>{breadcrumb}</span>
            </span>
          ))}
        </nav>
        <button className="codex-file-browser-more" type="button" aria-label="More file actions">
          <MoreIcon />
        </button>
        <button className="codex-file-browser-open" type="button" aria-label="Open attached application">
          <span>
            <CodexMark />
          </span>
          Open
          <ChevronDownIcon />
        </button>
        <button className="codex-file-browser-tool" type="button" aria-label="Open workspace tree">
          <FolderIcon />
        </button>
      </div>

      <div className="codex-file-browser-body">
        <pre className="codex-file-browser-code" data-language={language}>
          <code>{code}</code>
        </pre>
        <aside className="codex-file-browser-tree-panel" data-app-shell-focus-area="file-tree">
          <FileTree items={fileTree} />
        </aside>
      </div>
    </section>
  );
}

const defaultCode = `{
  "private": true,
  "packageManager": "npm@11.6.1",
  "description": "A research-driven component system",
  "workspaces": [
    "packages/*",
    "examples/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "start:example": "npm run start -w @open-shell/electron-example"
  },
  "dependencies": {
    "@radix-ui/react-dropdown-menu": "^2.1.16"
  }
}`;

function JsonIcon() {
  return <span className="codex-file-browser-json-icon">{"{}"}</span>;
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7.5 4.75 5.25 5.25-5.25 5.25" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.75 7.75 4.25 4.25 4.25-4.25" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4.5" cy="10" r="1.2" />
      <circle cx="10" cy="10" r="1.2" />
      <circle cx="15.5" cy="10" r="1.2" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.75 6.75A2.25 2.25 0 0 1 5 4.5h3.1l1.35 1.5H15A2.25 2.25 0 0 1 17.25 8.25v5A2.25 2.25 0 0 1 15 15.5H5a2.25 2.25 0 0 1-2.25-2.25Z" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7.5 3.75H4.75a1 1 0 0 0-1 1V7.5" />
      <path d="M12.5 16.25h2.75a1 1 0 0 0 1-1V12.5" />
      <path d="M13 3.75h3.25V7" />
      <path d="M7 16.25H3.75V13" />
    </svg>
  );
}

function BottomPanelMiniIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="2.2" />
      <path d="M4 12.25h12" />
    </svg>
  );
}

function RightPanelMiniIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="2.2" />
      <path d="M12.25 4.5v11" />
    </svg>
  );
}
