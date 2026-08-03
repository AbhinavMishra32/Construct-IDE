import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  Moon,
  Plus,
  RotateCw,
  ShieldCheck,
  Sun,
  Trash2,
} from "lucide-react";

import {
  SparButton,
  SparDialog,
  SparDialogContent,
  SparDialogDescription,
  SparDialogFooter,
  SparDialogHeader,
  SparDialogTitle,
  SparMenu,
  SparMenuCheckItem,
  SparMenuContent,
  SparMenuItem,
  SparMenuLabel,
  SparMenuSeparator,
  SparMenuTrigger,
  SparSegmented,
  SparSettingsGroup,
  SparSettingsRow,
} from "../../../components/spar";
import { ProviderGlyph } from "../../../components/spar/provider-glyph";
import { credentialStore, deviceNoun } from "../../../components/spar/platform";
import { cn } from "../../../lib/utils";
import { getSettings, importOpencodeAuth, listModels, updateAiSettings } from "../../lib/bridge";
import type { ThemeMode } from "../../theme";
import type { AiSettings, ModelCatalogEntry } from "../../types";
import {
  activeConstructProviderId,
  apiKeyFor,
  constructProviders,
  disconnectProviderPatch,
  modelLookupProvider,
  selectProviderPatch,
  type ConstructProvider,
  type ConstructProviderKind,
} from "./constructProviderInventory";

const KIND_LABEL: Record<ConstructProviderKind, string> = {
  subscription: "Subscription",
  "api-key": "API",
  custom: "Custom",
};

/** Ordered so the connect menu groups read the way the list itself does. */
const KIND_ORDER: ConstructProviderKind[] = ["subscription", "api-key", "custom"];

/** Bare mark, no tile — the glyph reads as a logo rather than a favicon. */
function Mark({ provider }: { provider: string }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center text-foreground/85">
      <ProviderGlyph className="size-[1.15rem]" provider={provider} />
    </span>
  );
}

function ModelPicker({
  provider,
  models,
  busy,
  onOpen,
  onSelect,
}: {
  provider: ConstructProvider;
  models: ModelCatalogEntry[];
  busy: boolean;
  onOpen(): void;
  onSelect(model: string): void;
}) {
  const current = models.find((model) => model.id === provider.selectedModel);

  return (
    <SparMenu onOpenChange={(open) => open && onOpen()}>
      <SparMenuTrigger
        className="inline-flex h-7 max-w-[11.5rem] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-background px-2 text-ui text-foreground transition-colors outline-none hover:bg-accent aria-expanded:bg-accent focus-visible:border-[var(--border-strong)] dark:bg-input/30 dark:hover:bg-input/50"
        title={`${provider.name} model`}
      >
        <ProviderGlyph className="size-3.5 shrink-0 opacity-70" provider={provider.id} />
        <span className="truncate">{current?.name ?? (provider.selectedModel || "Choose a model")}</span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </SparMenuTrigger>
      <SparMenuContent align="end" className="max-h-72 min-w-[14rem]">
        <SparMenuLabel>{provider.name}</SparMenuLabel>
        {busy && (
          <SparMenuItem disabled>
            <Loader2 className="animate-spin" />
            Reading the catalogue…
          </SparMenuItem>
        )}
        {!busy && models.length === 0 && (
          <SparMenuItem disabled>No models reported</SparMenuItem>
        )}
        {models.map((model) => (
          <SparMenuCheckItem
            checked={model.id === provider.selectedModel}
            key={model.id}
            onSelect={() => onSelect(model.id)}
          >
            <span className="min-w-0 flex-1 truncate">{model.name}</span>
          </SparMenuCheckItem>
        ))}
      </SparMenuContent>
    </SparMenu>
  );
}

function ProviderRow({
  provider,
  isDefault,
  models,
  modelsBusy,
  onLoadModels,
  onModel,
  onMakeDefault,
  onOpen,
  onDisconnect,
  onKeyUrl,
}: {
  provider: ConstructProvider;
  isDefault: boolean;
  models: ModelCatalogEntry[];
  modelsBusy: boolean;
  onLoadModels(): void;
  onModel(model: string): void;
  onMakeDefault(): void;
  onOpen(): void;
  onDisconnect(): void;
  onKeyUrl(): void;
}) {
  return (
    <SparSettingsRow
      control={
        <>
          <ModelPicker
            busy={modelsBusy}
            models={models}
            onOpen={onLoadModels}
            onSelect={onModel}
            provider={provider}
          />
          <SparMenu>
            <SparMenuTrigger
              aria-label={`${provider.name} options`}
              className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
            >
              <Ellipsis className="size-4" />
            </SparMenuTrigger>
            <SparMenuContent align="end">
              {!isDefault && (
                <SparMenuItem onSelect={onMakeDefault}>
                  <Check />
                  Use as default
                </SparMenuItem>
              )}
              <SparMenuItem onSelect={onOpen}>
                {provider.kind === "subscription" ? <RotateCw /> : <Lock />}
                {provider.kind === "subscription" ? "Reconnect account" : "Edit credentials"}
              </SparMenuItem>
              {provider.keyUrl && (
                <SparMenuItem onSelect={onKeyUrl}>
                  <ExternalLink />
                  Get an API key
                </SparMenuItem>
              )}
              <SparMenuSeparator />
              <SparMenuItem onSelect={onDisconnect} variant="destructive">
                <Trash2 />
                Disconnect
              </SparMenuItem>
            </SparMenuContent>
          </SparMenu>
        </>
      }
      description={KIND_LABEL[provider.kind]}
      title={
        <span className="flex items-center gap-1.5">
          <span className="truncate">{provider.name}</span>
          {isDefault && (
            <span className="shrink-0 rounded-full bg-[var(--construct-success)]/12 px-1.5 py-px text-ui-sm font-medium text-[var(--construct-success)]">
              Default
            </span>
          )}
        </span>
      }
    >
      {undefined}
    </SparSettingsRow>
  );
}

/** The last row of the providers card: one affordance that opens everything still
 *  available, grouped by how it authenticates. */
function ConnectRow({ available, onPick }: { available: ConstructProvider[]; onPick(provider: ConstructProvider): void }) {
  const groups = KIND_ORDER.map(
    (kind) => [kind, available.filter((provider) => provider.kind === kind)] as const,
  ).filter(([, list]) => list.length > 0);

  return (
    <SparMenu>
      <SparMenuTrigger className="flex w-full items-center gap-2 px-3.5 py-2.5 text-ui text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground">
        <span className="grid size-6 shrink-0 place-items-center">
          <Plus className="size-4" />
        </span>
        Connect a provider
      </SparMenuTrigger>
      <SparMenuContent align="start" className="max-h-80 min-w-[15rem]">
        {groups.map(([kind, list], groupIndex) => (
          <div key={kind}>
            {groupIndex > 0 && <SparMenuSeparator />}
            <SparMenuLabel>{KIND_LABEL[kind]}</SparMenuLabel>
            {list.map((provider) => (
              <SparMenuItem key={provider.id} onSelect={() => onPick(provider)}>
                <ProviderGlyph className="size-3.5" provider={provider.id} />
                <span className="truncate">{provider.name}</span>
              </SparMenuItem>
            ))}
          </div>
        ))}
      </SparMenuContent>
    </SparMenu>
  );
}

function Boundary({
  title,
  detail,
  badge,
  tone = "muted",
}: {
  title: string;
  detail: string;
  badge: React.ReactNode;
  tone?: "muted" | "success";
}) {
  return (
    <SparSettingsRow
      className="py-3"
      control={
        <span
          className={cn(
            "mt-px inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui-sm",
            tone === "success" ? "text-[var(--construct-success)]" : "text-muted-foreground",
          )}
        >
          {badge}
        </span>
      }
      description={detail}
      title={title}
    />
  );
}

/**
 * The credentials dialog. One field per thing the provider actually needs, so a
 * key-based provider asks for a key and an endpoint-based one asks for a URL —
 * a single generic form would ask both of everything and leave half of it blank.
 */
function ProviderConnectDialog({
  provider,
  settings,
  onClose,
  onSave,
  onImportCopilot,
}: {
  provider: ConstructProvider | null;
  settings: AiSettings;
  onClose(): void;
  onSave(patch: Partial<AiSettings>): Promise<void>;
  onImportCopilot(): Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!provider) return;
    setApiKey(provider.apiKeyKey ? String(settings[provider.apiKeyKey] ?? "") : "");
    setBaseUrl(provider.baseUrlKey ? String(settings[provider.baseUrlKey] ?? "") : "");
    setError("");
  }, [provider, settings]);

  const importOnly = provider?.id === "github-copilot";

  const save = async () => {
    if (!provider) return;
    setBusy(true);
    setError("");
    try {
      if (importOnly) {
        await onImportCopilot();
      } else {
        const patch: Partial<AiSettings> = {};
        if (provider.apiKeyKey) Object.assign(patch, { [provider.apiKeyKey]: apiKey.trim() });
        if (provider.baseUrlKey) Object.assign(patch, { [provider.baseUrlKey]: baseUrl.trim() });
        await onSave(patch);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SparDialog onOpenChange={(next) => { if (!next && !busy) onClose(); }} open={provider != null}>
      <SparDialogContent className="sm:max-w-[28rem]">
        <SparDialogHeader>
          {provider && (
            <span className="grid size-7 place-items-center rounded-[var(--radius-md)] bg-[var(--color-background-elevated-secondary)] text-foreground/85">
              <ProviderGlyph className="size-4" provider={provider.id} />
            </span>
          )}
          <SparDialogTitle>{provider ? `Connect ${provider.name}` : "Connect"}</SparDialogTitle>
          <SparDialogDescription>
            {importOnly
              ? "Construct reads your Copilot credentials from the OpenCode sign-in already on this device."
              : `Stored in ${credentialStore} on this ${deviceNoun} and read only when a run starts.`}
          </SparDialogDescription>
        </SparDialogHeader>

        {!importOnly && (
          <div className="space-y-3">
            {provider?.apiKeyKey && (
              <label className="block space-y-1.5">
                <span className="text-ui font-medium">API key</span>
                <input
                  autoFocus
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-ui outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk-…"
                  type="password"
                  value={apiKey}
                />
              </label>
            )}
            {provider?.baseUrlKey && (
              <label className="block space-y-1.5">
                <span className="text-ui font-medium">Endpoint</span>
                <input
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-ui outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://…"
                  value={baseUrl}
                />
              </label>
            )}
            {provider?.keyUrl && (
              <p className="text-ui text-muted-foreground">
                Keys are minted at{" "}
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href={provider.keyUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {new URL(provider.keyUrl).host}
                </a>
                .
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-[var(--radius-xl)] border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui leading-[1.6] text-destructive">
            {error}
          </p>
        )}

        <SparDialogFooter>
          <SparButton disabled={busy} onClick={onClose} size="sm" variant="secondary">
            Cancel
          </SparButton>
          <SparButton disabled={busy} onClick={() => void save()} size="sm">
            {busy && <Loader2 className="animate-spin" />}
            {importOnly ? "Import sign-in" : "Save credentials"}
          </SparButton>
        </SparDialogFooter>
      </SparDialogContent>
    </SparDialog>
  );
}

/**
 * Construct's settings, on Spar's settings screen.
 *
 * One measure, one card idiom, one row height: appearance, then the providers the
 * agent can call, then the model it starts every run on, then what the runtime
 * guarantees, then the account. Nothing here holds its own copy of a setting —
 * every control reads the settings Construct persisted and writes straight back
 * through the bridge, so the screen cannot drift out of step with the runtime.
 */
export function ConstructSparSettingsPage({
  theme,
  onThemeChange,
  releaseVersion,
  accountName,
  accountEmail,
  accountPlan,
  onSignOut,
  onOpenAccount,
  workspaceRoot,
  onWorkspaceRootChange,
  onBrowseWorkspaceRoot,
  onSaveWorkspaceRoot,
  workspaceBusy,
}: {
  theme: ThemeMode;
  onThemeChange(theme: ThemeMode): void;
  releaseVersion: string;
  accountName: string;
  accountEmail: string;
  accountPlan: string | null;
  onSignOut(): Promise<void>;
  onOpenAccount(): void;
  workspaceRoot: string;
  onWorkspaceRootChange(next: string): void;
  onBrowseWorkspaceRoot(): void;
  onSaveWorkspaceRoot(): void;
  workspaceBusy: boolean;
}) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ConstructProvider | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Catalogues are read per provider and only when a picker opens. Enumerating
     every connected provider's models on mount would be a handful of network
     round-trips for a list nobody has looked at yet. */
  const [catalogues, setCatalogues] = useState<Record<string, ModelCatalogEntry[]>>({});
  const [loadingCatalogue, setLoadingCatalogue] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await getSettings();
    setSettings(next.ai);
    return next.ai;
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [refresh]);

  const providers = useMemo(() => (settings ? constructProviders(settings) : []), [settings]);
  const connected = useMemo(() => providers.filter((provider) => provider.connected), [providers]);
  const available = useMemo(() => providers.filter((provider) => !provider.connected), [providers]);
  const activeId = settings ? activeConstructProviderId(settings) : null;
  const defaultProvider = connected.find((provider) => provider.id === activeId) ?? null;

  const patch = useCallback(async (next: Partial<AiSettings>) => {
    setError("");
    try {
      const saved = await updateAiSettings({ ai: next });
      if (saved.ai) setSettings(saved.ai);
      else await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh().catch(() => undefined);
    }
  }, [refresh]);

  const loadCatalogue = useCallback((provider: ConstructProvider) => {
    if (!settings || catalogues[provider.id]) return;
    setLoadingCatalogue(provider.id);
    void listModels({ provider: modelLookupProvider(provider), apiKey: apiKeyFor(provider, settings) } as Parameters<typeof listModels>[0])
      .then((models) => setCatalogues((current) => ({ ...current, [provider.id]: models })))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoadingCatalogue(null));
  }, [catalogues, settings]);

  const signOut = async () => {
    setBusy(true);
    try {
      await onSignOut();
      setSignOutOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[42rem] px-6 pb-20 pt-9">
        <h1 className="text-[1.55rem] font-semibold tracking-[-0.035em]">Settings</h1>
        <p className="mt-1 text-content text-muted-foreground">{`Appearance and model runtime for this ${deviceNoun}.`}</p>

        {error && !selected && (
          <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">
            {error}
          </p>
        )}

        <SparSettingsGroup label="Appearance">
          <SparSettingsRow
            className="py-2.5"
            control={
              <SparSegmented
                ariaLabel="Application theme"
                onChange={onThemeChange}
                options={[
                  { value: "system", label: "Auto", icon: Laptop },
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ]}
                value={theme}
              />
            }
            description="Pick an appearance, or follow the system setting."
            title="Theme"
          />
        </SparSettingsGroup>

        <SparSettingsGroup label="Storage">
          <SparSettingsRow
            description="New and imported projects are kept under this folder."
            title="Workspace root"
          >
            <div className="flex gap-2">
              <input
                className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-ui outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                onChange={(event) => onWorkspaceRootChange(event.target.value)}
                placeholder="Choose a project folder"
                value={workspaceRoot}
              />
              <SparButton onClick={onBrowseWorkspaceRoot} size="sm" variant="secondary">
                Browse
              </SparButton>
              <SparButton
                disabled={workspaceBusy || !workspaceRoot.trim()}
                onClick={onSaveWorkspaceRoot}
                size="sm"
              >
                Save
              </SparButton>
            </div>
          </SparSettingsRow>
        </SparSettingsGroup>

        <SparSettingsGroup label="Providers">
          {!settings && (
            <SparSettingsRow
              control={<Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
              title="Reading the provider inventory…"
            />
          )}
          {settings &&
            connected.map((provider) => (
              <ProviderRow
                isDefault={provider.id === activeId}
                key={provider.id}
                models={catalogues[provider.id] ?? []}
                modelsBusy={loadingCatalogue === provider.id}
                onDisconnect={() => void patch(disconnectProviderPatch(provider))}
                onKeyUrl={() => provider.keyUrl && window.open(provider.keyUrl, "_blank", "noreferrer")}
                onLoadModels={() => loadCatalogue(provider)}
                onMakeDefault={() => void patch(selectProviderPatch(provider, provider.selectedModel))}
                onModel={(model) => void patch(selectProviderPatch(provider, model))}
                onOpen={() => setSelected(provider)}
                provider={provider}
              />
            ))}
          {available.length > 0 && <ConnectRow available={available} onPick={setSelected} />}
        </SparSettingsGroup>

        {defaultProvider && (
          <SparSettingsGroup label="Agent">
            <SparSettingsRow
              control={
                <ModelPicker
                  busy={loadingCatalogue === defaultProvider.id}
                  models={catalogues[defaultProvider.id] ?? []}
                  onOpen={() => loadCatalogue(defaultProvider)}
                  onSelect={(model) => void patch(selectProviderPatch(defaultProvider, model))}
                  provider={defaultProvider}
                />
              }
              description="Every new run starts here until you switch provider."
              title="Default model"
            />
            <SparSettingsRow
              control={
                <SparSegmented
                  ariaLabel="Reasoning effort"
                  onChange={(value) => void patch({ reasoningEffort: value })}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ]}
                  value={settings?.reasoningEffort === "none" ? "auto" : settings?.reasoningEffort ?? "auto"}
                />
              }
              description="How long the agent is allowed to think before it answers."
              title="Reasoning effort"
            />
          </SparSettingsGroup>
        )}

        {/* Construct-accurate, not Spar's: Construct keeps provider secrets in its
            own settings file rather than the OS keychain, and saying otherwise
            would be a false claim about where someone's API key went. */}
        <SparSettingsGroup label="Runtime boundary">
          <Boundary
            badge={<><Lock className="size-3" />Local only</>}
            detail={`API keys and access tokens are written to Construct's settings on this ${deviceNoun} and read by the agent host immediately before a run. They are never sent anywhere but the provider they belong to.`}
            title="Credential isolation"
          />
          <Boundary
            badge={<><ShieldCheck className="size-3" />Enforced</>}
            detail="Every provider feeds the same Construct agent runtime, so a change of model never changes what the agent is allowed to do."
            title="Agent isolation"
            tone="success"
          />
        </SparSettingsGroup>

        <SparSettingsGroup label="Account">
          <SparSettingsRow
            control={
              <SparButton onClick={onOpenAccount} size="sm" variant="secondary">
                Manage
              </SparButton>
            }
            description={accountEmail}
            title={
              <span className="flex items-center gap-1.5">
                <span className="truncate">{accountName}</span>
                {accountPlan && (
                  <span className="shrink-0 rounded-full bg-[var(--color-background-elevated-secondary)] px-1.5 py-px text-ui-sm font-medium text-muted-foreground">
                    {accountPlan}
                  </span>
                )}
              </span>
            }
          />
          <SparSettingsRow
            control={
              <SparButton onClick={() => setSignOutOpen(true)} size="sm" variant="secondary">
                <LogOut />
                Sign out
              </SparButton>
            }
            description={`Clear this account from this ${deviceNoun}. Your projects stay on disk, and anything already synced stays in your Construct Cloud history.`}
            title="Sign out"
          />
        </SparSettingsGroup>

        <section className="mt-16 flex flex-col items-center pb-4 text-center">
          <span aria-hidden className="construct-auth-logo__mark construct-auth-logo__mark--hero" />
          <p className="mt-6 text-ui text-muted-foreground">Version {releaseVersion}</p>
        </section>
      </div>

      {settings && (
        <ProviderConnectDialog
          onClose={() => setSelected(null)}
          onImportCopilot={async () => {
            await importOpencodeAuth();
            await refresh();
          }}
          onSave={async (next) => {
            await patch(next);
          }}
          provider={selected}
          settings={settings}
        />
      )}

      <SparDialog onOpenChange={(next) => { if (!next && !busy) setSignOutOpen(false); }} open={signOutOpen}>
        <SparDialogContent className="sm:max-w-[28rem]">
          <SparDialogHeader>
            <SparDialogTitle>Sign out of Construct?</SparDialogTitle>
            <SparDialogDescription>
              {`This clears your account from this ${deviceNoun}. Your project folders stay exactly where they are, and signing back in restores anything that reached Construct Cloud.`}
            </SparDialogDescription>
          </SparDialogHeader>
          <SparDialogFooter>
            <SparButton disabled={busy} onClick={() => setSignOutOpen(false)} size="sm" variant="secondary">
              Cancel
            </SparButton>
            <SparButton disabled={busy} onClick={() => void signOut()} size="sm">
              {busy && <Loader2 className="animate-spin" />}
              Sign out
            </SparButton>
          </SparDialogFooter>
        </SparDialogContent>
      </SparDialog>
    </div>
  );
}
