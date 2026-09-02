import { useCallback, useEffect, useState } from "react";
import { Check, Download, Trash2 } from "lucide-react";
import { Orb } from "../common/Orb";

import type { ConstructApi, LanguageServerStatus } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { ConstructDots } from "@/components/common/ConstructDots";
import { SettingsControl, SettingsField, SettingsRow } from "./layout";

/**
 * Language intelligence, one row per language.
 *
 * Construct used to ship three language servers and colour four languages,
 * because every one of them was a decision made in the source. The catalog is
 * data now, and this is the whole of the interface to it: what Construct can
 * speak, what this machine already has, and a button.
 *
 * Nothing here is required to write code. A language with no server installed
 * is still coloured, still edited, still run — the row offers understanding of
 * that language, not access to it, which is why an install that fails says so
 * in place and leaves everything else alone.
 */
export function LanguageServerRows({ api, onError }: { api: ConstructApi | null | undefined; onError(message: string): void }) {
  const [servers, setServers] = useState<LanguageServerStatus[] | null>(null);
  /* Per-row rather than one for the page: installing Python must not put the
     Go row into a spinner. */
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!api) return;
    void api
      .listLanguageServers()
      .then(setServers)
      .catch(() => onError("Construct could not read the list of language servers."));
  }, [api, onError]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!api) return;
    return api.onLanguageServerInstall((event) => {
      setNotes((current) => ({ ...current, [event.id]: event.detail }));
      /* Only a settled install changes what the row can do, so only that
         re-reads. A progress line is just a line. */
      if (event.phase !== "installing") load();
    });
  }, [api, load]);

  if (!api) return null;

  if (!servers) {
    return (
      <SettingsRow>
        <ConstructDots className="text-muted-foreground" pattern="pulse" size={16} />
        <span className="text-muted-foreground px-1 text-sm font-medium">Reading the language catalog…</span>
      </SettingsRow>
    );
  }

  const act = (server: LanguageServerStatus, run: Promise<void>) => {
    setNotes((current) => ({ ...current, [server.id]: "" }));
    setServers((current) => current?.map((entry) => (entry.id === server.id ? { ...entry, installing: true } : entry)) ?? null);
    void run.catch((cause: unknown) => {
      setNotes((current) => ({ ...current, [server.id]: cause instanceof Error ? cause.message : "That did not work." }));
      load();
    });
  };

  return (
    <>
      {servers.map((server) => {
        const note = notes[server.id];
        const extensions = server.extensions.slice(0, 6).map((extension) => `.${extension}`).join("  ");

        return (
          <SettingsRow key={server.id}>
            <SettingsField
              description={note || `${server.blurb} — ${extensions}`}
              title={server.name}
            />
            <SettingsControl>
              {server.installing ? (
                <Button disabled size="sm" variant="secondary">
                  <Orb label="Installing" px={15} state="connecting" />
                  Installing
                </Button>
              ) : server.state === "bundled" ? (
                /* No button at all. A bundled server is not a choice the
                   learner made and cannot be unmade, so offering to remove it
                   would be offering to break the editor. */
                <span className="text-muted-foreground inline-flex items-center gap-1.5 px-1 text-xs font-medium">
                  <Check className="size-3.5" />
                  Included
                </span>
              ) : server.state === "installed" ? (
                <Button
                  onClick={() => act(server, api.uninstallLanguageServer({ serverId: server.id }))}
                  size="sm"
                  variant="secondary"
                >
                  <Trash2 />
                  Remove
                </Button>
              ) : server.state === "unavailable" ? (
                /* Said rather than disabled-and-silent: "Go is not installed"
                   is something the learner can act on, and a greyed button
                   with no reason is not. */
                <span className="text-muted-foreground max-w-56 px-1 text-right text-xs font-medium">{server.reason}</span>
              ) : (
                <Button onClick={() => act(server, api.installLanguageServer({ serverId: server.id }))} size="sm" variant="secondary">
                  <Download />
                  Install
                </Button>
              )}
            </SettingsControl>
          </SettingsRow>
        );
      })}
    </>
  );
}
