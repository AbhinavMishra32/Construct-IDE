import { MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { iconForFile as renderFileIcon } from "./fileIcons";

export function iconForFile(filename: string) {
  return renderFileIcon(filename, { size: 12 });
}

export function FileChooserContent({
  files,
  onSelectFile
}: {
  files: string[];
  onSelectFile: (path: string) => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!search) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.toLowerCase().includes(q));
  }, [files, search]);

  return (
    <div className="construct-overlay-shadow flex max-h-80 min-w-80 flex-col overflow-hidden rounded-lg border bg-popover">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-muted-foreground">
        <MagnifyingGlass size={14} weight="bold" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          type="text"
          placeholder="Search files..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="min-h-0 overflow-y-auto p-1">
        {filtered.map((filePath) => {
          const filename = filePath.split("/").pop() || "";
          return (
            <button
              key={filePath}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              type="button"
              onClick={() => onSelectFile(filePath)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">{iconForFile(filename)}</span>
              <span className="shrink-0 font-medium">{filename}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{filePath}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">No matching files</div>
        )}
      </div>
    </div>
  );
}
