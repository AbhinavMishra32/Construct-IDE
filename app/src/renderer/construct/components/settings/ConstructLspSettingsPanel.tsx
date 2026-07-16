import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
  Spinner
} from "@opaline/ui";

import { lspLanguageOrder, type LspLanguageId, type LspServerStatus, type LspStatusReport } from "./lspSettingsModel";

export function ConstructLspSettingsPanel({
  enabled,
  status,
  aggregateStatus,
  installBusy,
  logs,
  error,
  onToggle,
  onInstall,
  onStart,
  onStop,
  onRestart
}: {
  enabled: boolean;
  status: LspStatusReport;
  aggregateStatus: LspServerStatus;
  installBusy: boolean;
  logs: string[];
  error: string | null;
  onToggle: (enabled: boolean) => void;
  onInstall: (language?: LspLanguageId) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  return (
    <SettingsPanel title="Language Server" subtitle="Manage editor intelligence, diagnostics, and code navigation for this workspace.">
      <SettingsSection title="Configuration">
        <SettingsCard>
          <SettingsRow
            title="Enable Language Server"
            description="Enable diagnostics, autocomplete, hover cards, references, go to definition, type definition, and implementation lookup."
            control={
              <SettingsToggle
                checked={enabled}
                onCheckedChange={(checked) => onToggle(checked)}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>

      {enabled ? (
        <SettingsSection title="Installed servers">
          <SettingsCard>
            {lspLanguageOrder.map((language) => {
              const server = status[language];
              return (
                <SettingsRow
                  key={language}
                  title={server.label}
                  description={
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={server.status === "running" ? "default" : server.status === "not-installed" || server.status === "blocked" ? "destructive" : "secondary"}>
                        {server.status.replace("-", " ")}
                      </Badge>
                      <code>{server.command}</code>
                      <small>{server.resolvedPath ?? server.installCommand}</small>
                      {server.memoryLimitMb ? (
                        <small>
                          Memory guard: {server.memoryLimitMb} MB{server.memoryMb ? `, last seen ${server.memoryMb} MB` : ""}
                        </small>
                      ) : null}
                      {server.detail ? <small>{server.detail}</small> : null}
                      {server.blockedUntil ? <small>Retry after {new Date(server.blockedUntil).toLocaleTimeString()}</small> : null}
                    </div>
                  }
                  control={
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={installBusy || server.status === "installing"}
                      onClick={() => onInstall(language)}
                    >
                      {server.installed ? "Update" : "Install"}
                    </Button>
                  }
                />
              );
            })}
          </SettingsCard>
        </SettingsSection>
      ) : null}

      {enabled ? (
        <SettingsSection title="Controls">
          <SettingsCard>
            <SettingsRow
              title="Server lifecycle"
              description="Starts every installed language server for the active workspace. Install adds TypeScript language server, TypeScript, and Pyright when missing."
              control={
                <div className="flex items-center gap-2">
                  {aggregateStatus === "running" ? (
                    <>
                      <Button variant="secondary" size="sm" onClick={onRestart}>
                        Restart
                      </Button>
                      <Button variant="destructive" size="sm" onClick={onStop}>
                        Stop
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" disabled={aggregateStatus === "not-installed"} onClick={onStart}>
                      Start
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" disabled={installBusy} onClick={() => onInstall()}>
                    {aggregateStatus === "not-installed" ? "Download & Install" : "Reinstall / Update"}
                  </Button>
                </div>
              }
            />

            {aggregateStatus === "installing" || logs.length > 0 ? (
              <Alert>
                <AlertTitle className="flex items-center justify-between gap-2">
                  <span>Installation output</span>
                  {installBusy ? <span className="flex items-center gap-1"><Spinner /> Running npm install...</span> : null}
                </AlertTitle>
                <AlertDescription>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
                    {logs.length === 0 ? "Starting installer..." : logs.join("\n")}
                  </pre>
                </AlertDescription>
              </Alert>
            ) : null}
          </SettingsCard>
        </SettingsSection>
      ) : null}
      {error ? <Alert variant="destructive"><AlertTitle>Language server error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    </SettingsPanel>
  );
}
