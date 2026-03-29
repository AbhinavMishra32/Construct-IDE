import {
  BarChart3Icon,
  CoinsIcon,
  FolderTreeIcon,
  KeyRoundIcon,
  Link2Icon,
  RefreshCwIcon,
  UserCircle2Icon,
  XIcon
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import type {
  ApiUsageDashboardResponse,
  AuthSessionView,
  ConnectedProvider
} from "../types";

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

const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4
});

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }

  return TOKEN_FORMATTER.format(value);
}

function formatUsd(value: number | null): string {
  if (typeof value !== "number") {
    return "Unavailable";
  }

  if (value === 0) {
    return USD_FORMATTER.format(0);
  }

  return USD_FORMATTER.format(value);
}

function formatRecordedAt(value: string | null): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(date);
}

export function AccountSettingsPanel({
  open,
  authSession,
  displayNameDraft,
  onDisplayNameDraftChange,
  profileBusy,
  usageDashboard,
  usageLoading,
  usageError,
  providerDrafts,
  providerBusy,
  onProviderDraftChange,
  onSaveDisplayName,
  onSaveConnection,
  onRemoveConnection,
  onRefreshUsage,
  onClose
}: {
  open: boolean;
  authSession: AuthSessionView | null;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  profileBusy: boolean;
  usageDashboard: ApiUsageDashboardResponse | null;
  usageLoading: boolean;
  usageError: string;
  providerDrafts: Partial<Record<ConnectedProvider, { apiKey: string; baseUrl: string }>>;
  providerBusy: ConnectedProvider | null;
  onProviderDraftChange: (
    provider: ConnectedProvider,
    next: { apiKey?: string; baseUrl?: string }
  ) => void;
  onSaveDisplayName: () => void;
  onSaveConnection: (provider: ConnectedProvider) => void;
  onRemoveConnection: (provider: ConnectedProvider) => void;
  onRefreshUsage: () => void;
  onClose: () => void;
}) {
  if (!open || !authSession?.user) {
    return null;
  }

  const user = authSession.user;
  const connections = authSession.connections;
  const usage = usageDashboard;

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

            <Card className="construct-account-usage-card">
              <CardHeader>
                <div className="construct-account-provider-title-row">
                  <div>
                    <CardTitle className="construct-account-card-title">
                      <BarChart3Icon className="size-4" />
                      API usage
                    </CardTitle>
                    <CardDescription>
                      Every provider call Construct records for this account, including project
                      creation, repairs, runtime guidance, and later provider families.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={usageLoading}
                    onClick={onRefreshUsage}
                  >
                    <RefreshCwIcon className={cn("size-4", usageLoading ? "animate-spin" : "")} />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="construct-account-usage-content">
                <div className="construct-account-usage-totals">
                  <div className="construct-account-usage-stat">
                    <span>Total tokens</span>
                    <strong>{formatTokenCount(usage?.totals.totalTokens ?? 0)}</strong>
                  </div>
                  <div className="construct-account-usage-stat">
                    <span>Input</span>
                    <strong>{formatTokenCount(usage?.totals.inputTokens ?? 0)}</strong>
                  </div>
                  <div className="construct-account-usage-stat">
                    <span>Output</span>
                    <strong>{formatTokenCount(usage?.totals.outputTokens ?? 0)}</strong>
                  </div>
                  <div className="construct-account-usage-stat">
                    <span>Reported spend</span>
                    <strong>{formatUsd(usage?.totals.costUsd ?? null)}</strong>
                  </div>
                </div>

                {usageError ? (
                  <div className="construct-account-usage-empty is-error">{usageError}</div>
                ) : null}

                {!usageLoading && !usageError && !usage ? (
                  <div className="construct-account-usage-empty">
                    Usage data will appear here once Construct records provider calls for this
                    account.
                  </div>
                ) : null}

                {usageLoading && !usage ? (
                  <div className="construct-account-usage-empty">Loading usage dashboard...</div>
                ) : null}

                {usage ? (
                  <>
                    <section className="construct-account-usage-section">
                      <div className="construct-account-usage-section-header">
                        <span>Providers</span>
                        <Badge variant="outline">{usage.providers.length}</Badge>
                      </div>
                      <div className="construct-account-usage-list">
                        {usage.providers.map((provider) => (
                          <article
                            key={provider.provider}
                            className="construct-account-usage-row"
                          >
                            <div>
                              <strong>{provider.provider}</strong>
                              <p>{provider.models.join(", ") || "Unknown model"}</p>
                            </div>
                            <div className="construct-account-usage-row-metrics">
                              <span>{formatTokenCount(provider.totalTokens)} tokens</span>
                              <span>{formatUsd(provider.costUsd)}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="construct-account-usage-section">
                      <div className="construct-account-usage-section-header">
                        <span>Projects</span>
                        <Badge variant="outline">{usage.projects.length}</Badge>
                      </div>
                      <div className="construct-account-usage-list">
                        {usage.projects.length > 0 ? (
                          usage.projects.slice(0, 6).map((project) => (
                            <article
                              key={project.projectId}
                              className="construct-account-usage-row"
                            >
                              <div>
                                <strong>{project.projectName ?? project.projectGoal ?? "Project"}</strong>
                                <p>{project.providers.join(", ") || "No provider recorded"}</p>
                              </div>
                              <div className="construct-account-usage-row-metrics">
                                <span>{formatTokenCount(project.totalTokens)} tokens</span>
                                <span>{formatUsd(project.costUsd)}</span>
                              </div>
                            </article>
                          ))
                        ) : (
                          <div className="construct-account-usage-empty">
                            Project-linked usage has not been recorded yet.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="construct-account-usage-section">
                      <div className="construct-account-usage-section-header">
                        <span>Recent activity</span>
                        <Badge variant="outline">{usage.recentEvents.length}</Badge>
                      </div>
                      <div className="construct-account-usage-list">
                        {usage.recentEvents.slice(0, 8).map((event) => (
                          <article key={event.id} className="construct-account-usage-event">
                            <div className="construct-account-usage-event-copy">
                              <div className="construct-account-card-title">
                                <FolderTreeIcon className="size-4" />
                                <strong>{event.projectName ?? event.projectGoal ?? event.operation}</strong>
                              </div>
                              <p>
                                {event.provider} · {event.model} · {event.operation}
                              </p>
                            </div>
                            <div className="construct-account-usage-event-meta">
                              <span>{formatTokenCount(event.totalTokens)} tokens</span>
                              <span>{formatUsd(event.costUsd)}</span>
                              <span>{formatRecordedAt(event.recordedAt)}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>

                    <div className="construct-account-usage-footnote">
                      <CoinsIcon className="size-4" />
                      <span>
                        {usage.totals.unpricedEventCount > 0
                          ? `${usage.totals.unpricedEventCount} call${usage.totals.unpricedEventCount === 1 ? "" : "s"} did not include provider-reported pricing.`
                          : "All recorded calls currently include token totals."}
                      </span>
                    </div>
                  </>
                ) : null}
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
