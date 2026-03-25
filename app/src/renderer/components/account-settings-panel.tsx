import { KeyRoundIcon, Link2Icon, UserCircle2Icon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import type { AuthSessionView, ConnectedProvider, ProviderConnection } from "../types";

const PROVIDER_CATALOG: Array<{
  provider: ConnectedProvider;
  title: string;
  description: string;
  placeholder: string;
}> = [
  {
    provider: "openai",
    title: "OpenAI",
    description: "Used for project planning, frontier generation, and runtime guidance when you want personal credentials instead of shared env keys.",
    placeholder: "sk-..."
  },
  {
    provider: "codex",
    title: "Codex",
    description: "Reserved for future Codex-native auth and tokens. You can still store a key-shaped secret here now if you need a placeholder connection.",
    placeholder: "codex-..."
  },
  {
    provider: "tavily",
    title: "Tavily",
    description: "Search and research provider for project planning and architecture discovery.",
    placeholder: "tvly-..."
  },
  {
    provider: "langsmith",
    title: "LangSmith",
    description: "Tracing and observability provider for LangGraph-backed runs and later provider analytics.",
    placeholder: "lsv2_..."
  }
];

export function AccountSettingsPanel({
  open,
  authSession,
  displayNameDraft,
  onDisplayNameDraftChange,
  profileBusy,
  providerDrafts,
  providerBusy,
  onProviderDraftChange,
  onSaveDisplayName,
  onSaveConnection,
  onRemoveConnection,
  onClose
}: {
  open: boolean;
  authSession: AuthSessionView | null;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  profileBusy: boolean;
  providerDrafts: Partial<Record<ConnectedProvider, { apiKey: string; baseUrl: string }>>;
  providerBusy: ConnectedProvider | null;
  onProviderDraftChange: (
    provider: ConnectedProvider,
    next: { apiKey?: string; baseUrl?: string }
  ) => void;
  onSaveDisplayName: () => void;
  onSaveConnection: (provider: ConnectedProvider) => void;
  onRemoveConnection: (provider: ConnectedProvider) => void;
  onClose: () => void;
}) {
  if (!open || !authSession?.user) {
    return null;
  }

  const user = authSession.user;
  const connections = authSession.connections;

  return (
    <div className="construct-account-overlay" role="presentation">
      <button
        type="button"
        className="construct-account-backdrop"
        aria-label="Close account settings"
        onClick={onClose}
      />
      <section className="construct-account-panel" aria-label="Account settings">
        <header className="construct-account-header">
          <div className="construct-account-header-copy">
            <Badge variant="outline">Account</Badge>
            <h2>{user.displayName}</h2>
            <p>
              Manage your native Construct profile and the provider connections the runner
              can use for planning, guidance, search, and observability.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        </header>

        <ScrollArea className="construct-account-scroll">
          <div className="construct-account-grid">
            <Card className="construct-account-profile-card">
              <CardHeader>
                <CardTitle className="construct-account-card-title">
                  <UserCircle2Icon className="size-4" />
                  Profile
                </CardTitle>
                <CardDescription>
                  This account owns your local Construct projects, sessions, and provider links.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel>Email</FieldLabel>
                    <Input value={user.email} disabled />
                  </Field>
                  <Field>
                    <FieldLabel>Display name</FieldLabel>
                    <Input
                      value={displayNameDraft}
                      onChange={(event) => {
                        onDisplayNameDraftChange(event.target.value);
                      }}
                      disabled={profileBusy}
                    />
                    <FieldDescription>
                      This shows up in the workbench and will become the human-facing identity for future external auth links.
                    </FieldDescription>
                  </Field>
                  <Button type="button" disabled={profileBusy} onClick={onSaveDisplayName}>
                    {profileBusy ? "Saving..." : "Save profile"}
                  </Button>
                </FieldGroup>
              </CardContent>
            </Card>

            <div className="construct-account-provider-stack">
              {PROVIDER_CATALOG.map((entry) => {
                const connection =
                  connections.find(
                    (candidate) =>
                      candidate.provider === entry.provider && candidate.authType === "api-key"
                  ) ?? null;
                const draft = providerDrafts[entry.provider] ?? {
                  apiKey: "",
                  baseUrl: connection?.baseUrl ?? ""
                };
                const busy = providerBusy === entry.provider;

                return (
                  <Card key={entry.provider} className="construct-account-provider-card">
                    <CardHeader>
                      <div className="construct-account-provider-title-row">
                        <div>
                          <CardTitle className="construct-account-card-title">
                            <Link2Icon className="size-4" />
                            {entry.title}
                          </CardTitle>
                          <CardDescription>{entry.description}</CardDescription>
                        </div>
                        <Badge
                          variant={connection ? "secondary" : "outline"}
                          className={cn(
                            "construct-account-provider-status",
                            connection ? "is-connected" : ""
                          )}
                        >
                          {connection ? `Saved${connection.last4 ? ` • ••••${connection.last4}` : ""}` : "Not connected"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <Field>
                          <FieldLabel>API key</FieldLabel>
                          <Input
                            type="password"
                            value={draft.apiKey}
                            onChange={(event) => {
                              onProviderDraftChange(entry.provider, {
                                apiKey: event.target.value
                              });
                            }}
                            placeholder={entry.placeholder}
                            disabled={busy}
                          />
                        </Field>
                        <Field>
                          <FieldLabel>Base URL</FieldLabel>
                          <Input
                            value={draft.baseUrl}
                            onChange={(event) => {
                              onProviderDraftChange(entry.provider, {
                                baseUrl: event.target.value
                              });
                            }}
                            placeholder="Optional"
                            disabled={busy}
                          />
                          <FieldDescription>
                            Leave this empty for the provider default. Use it for gateways or compatible endpoints.
                          </FieldDescription>
                        </Field>
                        <div className="construct-account-provider-actions">
                          <Button
                            type="button"
                            disabled={busy || draft.apiKey.trim().length < 3}
                            onClick={() => {
                              onSaveConnection(entry.provider);
                            }}
                          >
                            <KeyRoundIcon className="size-4" />
                            {busy ? "Saving..." : "Save key"}
                          </Button>
                          {connection ? (
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                onRemoveConnection(entry.provider);
                              }}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </FieldGroup>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
