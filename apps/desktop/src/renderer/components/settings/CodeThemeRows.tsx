import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCodeTheme } from "@/hooks/use-code-theme";
import { SettingsControl, SettingsField, SettingsRow } from "./layout";

/**
 * Choosing the palette every surface draws code with.
 *
 * One theme per appearance rather than one overall, because Construct's light
 * and dark are chosen separately and a palette built for one is wrong on the
 * other — a light theme on a dark window is not a preference, it is a mistake.
 * So this row only ever offers the themes built for the appearance you are
 * currently in, and says so.
 */
export function CodeThemeRows() {
  const { appearance, available, importTheme, remove, select, theme } = useCodeTheme();
  const [failure, setFailure] = useState("");
  const field = useRef<HTMLInputElement | null>(null);

  const load = (file: File | undefined) => {
    if (!file) return;
    setFailure("");
    void file
      .text()
      .then((json) => {
        const problem = importTheme(json, file.name);
        if (problem) setFailure(problem);
      })
      .catch(() => setFailure("Construct could not read that file."));
  };

  return (
    <>
      <SettingsRow>
        <SettingsField
          description={`The editor, code in chat, and concept cards all use this. Showing ${appearance} themes.`}
          title="Code theme"
        />
        <SettingsControl>
          <Select onValueChange={select} value={theme.id}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsControl>
      </SettingsRow>

      {/* The swatch is the point of the row: theme names mean nothing, and the
          only question being asked is what code will look like. */}
      <SettingsRow>
        <SettingsField description="Comment, keyword, type, string, number." title="Preview" />
        <SettingsControl className="max-w-none">
          <div
            className="flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 font-mono text-ui-sm"
            style={{ background: theme.slots.background, color: theme.slots.foreground }}
          >
            {(["comment", "keyword", "type", "string", "number"] as const).map((slot) => (
              <span key={slot} style={{ color: theme.slots[slot] }}>
                ab
              </span>
            ))}
          </div>
        </SettingsControl>
      </SettingsRow>

      <SettingsRow>
        <SettingsField
          description={
            failure ||
            "Any VS Code colour theme JSON. Its chrome and ten token families come across; the rest inherit the foreground."
          }
          title="Import from VS Code"
        />
        <SettingsControl>
          <input
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              load(event.target.files?.[0]);
              /* Cleared so choosing the same file twice still fires a change —
                 re-importing after an edit is the normal way to iterate. */
              event.target.value = "";
            }}
            ref={field}
            type="file"
          />
          <Button onClick={() => field.current?.click()} size="sm" variant="outline">
            <Upload className="size-3.5" />
            Choose file
          </Button>
        </SettingsControl>
      </SettingsRow>

      {available
        .filter((entry) => entry.source)
        .map((entry) => (
          <SettingsRow key={entry.id}>
            <SettingsField description={entry.source} title={entry.name} />
            <SettingsControl>
              <Button onClick={() => remove(entry.id)} size="sm" variant="ghost">
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            </SettingsControl>
          </SettingsRow>
        ))}
    </>
  );
}
