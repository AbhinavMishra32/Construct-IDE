import { useCallback, useEffect, useMemo, useState } from "react";
import { Braces, Check, ChevronDown, ExternalLink, Ellipsis, Folder, FolderOpen, Globe, KeyRound, Laptop, Link2, Lock, LogOut, Moon, Plus, RotateCw, Settings2, Sparkle, Sun, Trash2, UserRound } from "lucide-react";
import { Orb } from "../common/Orb";
import { LANGUAGES, type Language } from "@construct/domain";
import type { ConstructApi, LearnerProfile, ProjectDefaults, ProviderId, ProviderInventory, SubscriptionUsage, ThemePreference, UsageWindow } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { message } from "@/lib/format";
import { credentialStore, deviceNoun } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { refreshProviders } from "../../hooks/use-providers";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { ConstructWordmark } from "../common/ConstructWordmark";
import { AboutConstruct } from "../settings/AboutConstruct";
import { CodeThemeRows } from "../settings/CodeThemeRows";
import { UpdateSettings } from "../settings/UpdateSettings";
import { ProviderConnectDialog } from "../settings/ProviderConnectDialog";
import { SettingsControl, SettingsField, SettingsGroup, SettingsHeader, SettingsRow, SettingsSection } from "../settings/layout";
import { LearnerRows } from "../settings/LearnerRows";
import { LanguageServerRows } from "../settings/LanguageServerRows";
import { ConstructDots } from "@/components/common/ConstructDots";

/** The host capabilities the preload exposes beside the Construct API. */
declare const constructHost: { chooseDirectory(): Promise<string | null> };

/** Resolved in the main process before the window paints, so it is already here. */
const build = window.construct?.build;

type Provider = ProviderInventory["providers"][number];
type SettingsSection = "general" | "you" | "models" | "languages" | "projects";

type NavItem = { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> };
type NavGroup = { label: string; items: NavItem[] };

/* Five pages under two headings, and the headings are what the sidebar was
   missing rather than more pages.

   Splitting a page is worth it when the page is long; splitting it when the
   page is one row only moves the reading from the page into the sidebar. So the
   count stays at five — but five unlabelled rows floating at the top of a tall
   empty column read as an unfinished screen, and the fix is to say what the
   five are rather than to invent a sixth. The division is the honest one: two
   pages about this copy of Construct and the person using it, three about the
   machinery it points at your code.

   Within the first group, You now carries the account as well as the profile.
   General opening on "Sign out" was a page whose first row had nothing to do
   with its name. */
const SETTINGS_NAV: NavGroup[] = [
  {
    label: "Construct",
    items: [
      { id: "general", label: "General", icon: Settings2 },
      /* Above the agent's own settings on purpose: what Construct knows about
         you shapes every turn it takes, so it belongs beside the account rather
         than filed under the model. */
      { id: "you", label: "You", icon: UserRound },
    ],
  },
  {
    label: "Coding",
    items: [
      /* One star, not a brain and not a constellation. A brain is a claim
         about the software; a cluster of three is decoration at 16px, where the
         two small ones read as noise around the one you can actually see. */
      { id: "models", label: "Models", icon: Sparkle },
      /* Beside Models rather than under Projects: a language server is the other
         thing that reads your code and tells you something about it, and it is
         installed once for the machine rather than chosen per project. */
      { id: "languages", label: "Languages", icon: Braces },
      { id: "projects", label: "Projects", icon: Folder },
    ],
  },
];

/** Flat, for the one question the groups cannot answer: what is this page called. */
const SETTINGS_PAGES: NavItem[] = SETTINGS_NAV.flatMap((group) => group.items);

/* One string, because every row in the list has to agree about its height, its
   resting colour, and what "selected" does to its glyph — and a row that
   disagrees is visible immediately. */
const NAV_ITEM =
  "h-8 w-full justify-start text-left text-muted-foreground click-depth-effect-slightly [&_svg]:text-muted-foreground data-[active=true]:bg-muted! data-[active=true]:text-foreground data-[active=true]:[&_svg]:text-foreground";


const KIND_LABEL: Record<Provider["kind"], string> = {
  subscription: "Subscription",
  "api-key": "API",
  local: "Local",
  custom: "Custom",
};

/** Ordered so the connect menu groups read the way the list itself does. */
const KIND_ORDER: Array<Provider["kind"]> = ["subscription", "api-key", "local", "custom"];

/**
 * Whether the agent may reach the web, and the key that lets it.
 *
 * Two facts, so two rows. The switch is the setting — a learner who wants a
 * session read only from their own record can have one without throwing their
 * key away — and the key is a credential, which appears once it is relevant and
 * gets out of the way once it is held. An input box sitting open under a key
 * that is already stored is a form asking to be filled in for no reason.
 *
 * Write-only, like every other credential here: the field takes a key and the
 * main process never hands one back, so what these rows can report is whether
 * one is set and where it came from. A key supplied through `EXA_API_KEY` says
 * so rather than showing an empty box that mysteriously works.
 */
function WebSearchRow({ api }: { api: ConstructApi | undefined }) {
  const [source, setSource] = useState<"keychain" | "env" | "none" | "loading">("loading");
  const [enabled, setEnabled] = useState(true);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const read = useCallback(async () => {
    if (!api) return;
    const status = await api.webSearchStatus();
    setSource(status.source);
    setEnabled(status.enabled);
  }, [api]);

  useEffect(() => { void read().catch(() => setSource("none")); }, [read]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setFailure("");
    try { await run(); setDraft(""); setEditing(false); await read(); }
    catch (cause) { setFailure(message(cause)); }
    finally { setBusy(false); }
  };

  const held = source === "keychain" || source === "env";
  /* The switch reads the setting, but a key-less agent cannot search whatever the
     setting says — so the row shows off, and says why, rather than showing on and
     quietly doing nothing. */
  const active = enabled && held;

  return (
    <>
      <Row>
        <span className={cn("grid size-6 shrink-0 place-items-center transition-colors", active ? "text-foreground/85" : "text-muted-foreground/50")}>
          <Globe className="size-[1.15rem]" />
        </span>
        <SettingsField
          description={
            source === "loading"
              ? "Checking…"
              : !held
                ? "Needs an Exa key. Without one the agent works entirely from your own record."
                : enabled
                  ? "The agent can look up what a company's interviews cover or what a library's current API is."
                  : "Off. The agent works entirely from your own record."
          }
          title="Web search"
        />
        <SettingsControl>
          <Switch
            aria-label="Web search"
            checked={active}
            disabled={busy || !held}
            onCheckedChange={(next) => void act(async () => api?.setWebSearchEnabled(next))}
          />
        </SettingsControl>
      </Row>

      {/* The key. Shown while there is none to hold, and folded away once there
          is — replacing one is a deliberate act, not the default state. */}
      {held && !editing ? (
        <Row>
          <span className="grid size-6 shrink-0 place-items-center text-muted-foreground/70"><KeyRound className="size-4" /></span>
          <div className="min-w-0 grow px-1">
            <p className="text-muted-foreground truncate text-xs font-medium">
              {source === "env" ? "Key supplied by the EXA_API_KEY environment variable." : `Key stored in ${credentialStore}.`}
            </p>
          </div>
          {source === "keychain" && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Exa key options"
                className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
              >
                {busy ? <Orb label="Working" px={16} state="working" /> : <Ellipsis className="size-4" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}><KeyRound />Replace key</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void api?.openExternal("https://dashboard.exa.ai/api-keys")}><ExternalLink />Exa dashboard</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void act(async () => api?.clearWebSearchKey())} variant="destructive">
                  <Trash2 />Remove key
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </Row>
      ) : source !== "loading" && (source === "none" || editing) ? (
        <Row>
          <span className="grid size-6 shrink-0 place-items-center text-muted-foreground/70"><KeyRound className="size-4" /></span>
          <Input
            autoComplete="off"
            autoFocus={editing}
            className="min-w-0 flex-1 font-mono text-ui"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && draft.trim()) void act(async () => api?.saveWebSearchKey(draft.trim())); if (event.key === "Escape") { setEditing(false); setDraft(""); } }}
            placeholder={editing ? "Paste the replacement key…" : "Paste your Exa API key…"}
            type="password"
            value={draft}
          />
          <Button disabled={busy || !draft.trim()} onClick={() => void act(async () => api?.saveWebSearchKey(draft.trim()))} size="sm">
            {busy ? <Orb invert label="Saving" px={15} state="working" /> : "Save"}
          </Button>
          {editing
            ? <Button onClick={() => { setEditing(false); setDraft(""); }} size="sm" variant="ghost">Cancel</Button>
            : <Button onClick={() => void api?.openExternal("https://dashboard.exa.ai/api-keys")} size="sm" variant="ghost"><ExternalLink className="size-3.5" />Get one</Button>}
        </Row>
      ) : null}

      {failure && <Row><p className="text-destructive px-1 text-xs font-medium">{failure}</p></Row>}
    </>
  );
}

/** A labelled stack of rows: the page's most common shape, so it keeps a name of
 *  its own. The label sits above the card, not inside it — the card is then one
 *  uninterrupted surface rather than a header plus a body. */
function Group({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <SettingsSection title={label}>
      <SettingsGroup className={className}>{children}</SettingsGroup>
    </SettingsSection>
  );
}

/**
 * Where new projects go, and what they are written in.
 *
 * Both are here rather than in the New project dialog because they are the same
 * answer every time: the dialog used to make choosing a folder through the OS
 * picker mandatory, so every project began with a decision nobody has an opinion
 * about after the first one — and it stood in front of the only two things that
 * matter, which are what you want to build and what you want to understand.
 *
 * The dialog still shows where the project will land and still lets one project
 * go somewhere else. This is the default it starts from.
 */
function ProjectDefaultsRows({
  api,
  defaults,
  onChange,
  onError,
}: {
  api: ConstructApi | undefined;
  defaults: ProjectDefaults;
  onChange(defaults: ProjectDefaults): void;
  onError(message: string): void;
}) {
  const [busy, setBusy] = useState(false);

  /* The main process answers with what actually settled, because it is what
     knows whether the folder could be made — so the row shows a path that
     exists rather than one that was merely typed. */
  const save = (input: { directory?: string; language?: Language }) => {
    if (!api) return;
    setBusy(true);
    onError("");
    void api
      .setProjectDefaults(input)
      .then(onChange)
      .catch((cause: unknown) => onError(message(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Row>
        <div className="min-w-0 grow px-1">
          <h4 className="text-foreground text-sm font-medium" data-settings-field="Projects folder">Projects folder</h4>
          <p className="text-muted-foreground truncate font-mono text-xs font-medium" title={defaults.directory}>
            {defaults.directory}
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={async () => {
            const chosen = await constructHost.chooseDirectory();
            if (chosen) save({ directory: chosen });
          }}
          size="sm"
          variant="outline"
        >
          <FolderOpen className="size-4" /> Change
        </Button>
        <Button disabled={busy} onClick={() => void api?.openExternal(`file://${defaults.directory}`)} size="sm" variant="ghost">
          Reveal
        </Button>
      </Row>

      <Row>
        <SettingsField description="What a new project is scaffolded in, unless you change it for that project." title="Language" />
        <SettingsControl>
          <Select disabled={busy} onValueChange={(value) => save({ language: value as Language })} value={defaults.language}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((language) => (
                <SelectItem key={language} value={language}>
                  <LanguageGlyph className="size-3.5" language={language} />
                  {LANGUAGE_LABEL[language]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsControl>
      </Row>
    </>
  );
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <SettingsRow className={className}>{children}</SettingsRow>;
}

/** Bare mark, no tile — the glyph reads as a logo rather than a favicon. */
function Mark({ provider }: { provider: ProviderId }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center text-foreground/85">
      <ProviderGlyph className="size-[1.15rem]" provider={provider} />
    </span>
  );
}

function ModelPicker({ provider, onSelect }: { provider: Provider; onSelect(model: string): void }) {
  const current = provider.models.find((model) => model.id === provider.selectedModel);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-7 max-w-[11.5rem] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-background px-2 text-ui text-foreground transition-colors outline-none hover:bg-accent aria-expanded:bg-accent dark:bg-input/30 dark:hover:bg-input/50"
        title={`${provider.name} model`}
      >
        <ProviderGlyph className="size-3.5 shrink-0 opacity-70" provider={provider.id} />
        <span className="truncate">{current?.name ?? provider.selectedModel}</span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 min-w-[14rem]">
        <DropdownMenuLabel>{provider.name}</DropdownMenuLabel>
        {provider.models.map((model) => (
          <DropdownMenuCheckItem
            checked={model.id === provider.selectedModel}
            key={model.id}
            onSelect={() => onSelect(model.id)}
          >
            <span className="min-w-0 flex-1 truncate">{model.name}</span>
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A subscription's remaining quota, in the only two windows either upstream
 *  rations by. The ring reads the weekly window because that is the one that
 *  ends a week's work; the card behind it spells both out. */
function UsageRing({ provider, api }: { provider: Provider; api: ConstructApi | undefined }) {
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);
  const [read, setRead] = useState(false);

  useEffect(() => {
    if (!api || provider.kind !== "subscription") return;
    let live = true;
    void api.providerUsage(provider.id)
      .then((value) => { if (live) setUsage(value); })
      .catch(() => undefined)
      .finally(() => { if (live) setRead(true); });
    return () => { live = false; };
  }, [api, provider.id, provider.kind]);

  const weekly = usage?.windows.find((window) => window.kind === "weekly") ?? null;
  const fiveHour = usage?.windows.find((window) => window.kind === "five-hour") ?? null;
  /* Nothing to say and nothing still coming: no dimmed ring standing in for a
     reading that will never arrive. ChatGPT reports quota only on a turn's own
     response headers, so this row stays empty until one has run. */
  if (provider.kind !== "subscription" || (read && !weekly && !fiveHour)) return null;

  const left = weekly ? percentLeft(weekly) : 0;
  return (
    <HoverCard>
      {/* A button, not Radix's default anchor: this is not a link, and focusing
          it is the only way the card opens without a pointer. */}
      <HoverCardTrigger asChild>
        <button
          aria-label={`${provider.name} subscription usage`}
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground transition-colors outline-none hover:text-foreground"
          type="button"
        >
          <svg className={cn("size-4 -rotate-90", weekly ? "" : "opacity-30")} viewBox="0 0 20 20">
            <circle className="fill-none stroke-current opacity-25" cx="10" cy="10" r="8" strokeWidth="3" />
            <circle
              className="fill-none stroke-current"
              cx="10"
              cy="10"
              pathLength={100}
              r="8"
              strokeDasharray={`${left} 100`}
              strokeLinecap="round"
              strokeWidth="3"
            />
          </svg>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-auto min-w-[13rem] gap-1 p-0 py-2 tabular-nums">
        <UsageLine entry={fiveHour} label="5 hours" />
        <UsageLine entry={weekly} label="Weekly" />
      </HoverCardContent>
    </HoverCard>
  );
}

function UsageLine({ label, entry }: { label: string; entry: UsageWindow | null }) {
  return (
    <div className="flex items-center justify-between gap-6 px-3 py-0.5 text-ui">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{entry ? describeWindow(entry) : "Not available"}</span>
    </div>
  );
}

const percentLeft = (entry: UsageWindow) => Math.min(100, Math.max(0, Math.round(100 - entry.usedPercent)));

/** Once a window is spent, when it comes back is the only useful thing left to
 *  say about it. Above zero, how much is left says it better than a reset time. */
function describeWindow(entry: UsageWindow) {
  const left = percentLeft(entry);
  if (left > 0 || entry.resetsAt === null) return `${left}% left`;
  return `resets ${new Date(entry.resetsAt * 1_000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function ProviderRow({
  provider,
  api,
  isDefault,
  onModel,
  onMakeDefault,
  onOpen,
  onDisconnect,
  onKeyUrl,
}: {
  provider: Provider;
  api: ConstructApi | undefined;
  isDefault: boolean;
  onModel(model: string): void;
  onMakeDefault(): void;
  onOpen(): void;
  onDisconnect(): void;
  onKeyUrl(): void;
}) {
  const expired = provider.state === "auth-expired";

  return (
    <Row>
      <Mark provider={provider.id} />
      <div className="min-w-0 grow px-1">
        <div className="flex items-center gap-1.5">
          <h4 className="text-foreground truncate text-sm font-medium">{provider.name}</h4>
          {isDefault && (
            <span className="shrink-0 rounded-full bg-success/12 px-1.5 py-px text-ui-sm font-medium text-success">Default</span>
          )}
          {expired && (
            <span className="shrink-0 rounded-full bg-destructive/12 px-1.5 py-px text-ui-sm font-medium text-destructive">
              Sign in again
            </span>
          )}
        </div>
        <p className="text-muted-foreground truncate text-xs font-medium">{KIND_LABEL[provider.kind]}</p>
      </div>

      {provider.models.length > 0 && <ModelPicker onSelect={onModel} provider={provider} />}

      <UsageRing api={api} provider={provider} />

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${provider.name} options`}
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isDefault && provider.models.length > 0 && (
            <DropdownMenuItem onSelect={onMakeDefault}>
              <Check />
              Use as default
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onOpen}>
            {provider.kind === "subscription" ? <RotateCw /> : <Lock />}
            {provider.kind === "subscription" ? "Reconnect account" : "Edit credentials"}
          </DropdownMenuItem>
          {provider.keyUrl && (
            <DropdownMenuItem onSelect={onKeyUrl}>
              <ExternalLink />
              Get an API key
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDisconnect} variant="destructive">
            <Trash2 />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Row>
  );
}

/** The last row of the providers card: one affordance that opens everything
 *  still available, grouped by how it authenticates. */
function ConnectRow({ available, onPick }: { available: Provider[]; onPick(provider: Provider): void }) {
  const groups = KIND_ORDER.map((kind) => [kind, available.filter((provider) => provider.kind === kind)] as const).filter(
    ([, list]) => list.length > 0,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="bg-surface-secondary text-muted-foreground dark:hover:bg-accent flex min-h-13 w-full cursor-default items-center gap-3 p-2.5 text-sm font-medium outline-none transition-colors hover:bg-neutral-100 hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground">
        <span className="grid size-6 shrink-0 place-items-center">
          <Plus className="size-4" />
        </span>
        Connect a provider
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-[15rem]">
        {groups.map(([kind, list], groupIndex) => (
          <div key={kind}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{KIND_LABEL[kind]}</DropdownMenuLabel>
            {list.map((provider) => (
              <DropdownMenuItem key={provider.id} onSelect={() => onPick(provider)}>
                <ProviderGlyph className="size-3.5" provider={provider.id} />
                <span className="truncate">{provider.name}</span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SettingsPage({
  api,
  onProjectDefaults,
  onRetakeIntake,
  onSection,
  onSignedOut,
  onThemeChange,
  projectDefaults,
  theme,
}: {
  api: ConstructApi | undefined;
  /** Reports settled defaults back to the shell, which holds them for the New
   *  project dialog. */
  onProjectDefaults(defaults: ProjectDefaults): void;
  /** Runs the intake again, over the app. The shell owns which screen is
   *  showing, so it is the shell that puts it there. */
  onRetakeIntake(profile: LearnerProfile): void;
  /** The toolbar above this page belongs to the shell, but the second half of
   *  its title is the section you are standing in — so the page reports it up
   *  rather than drawing a second title bar of its own. */
  onSection?(label: string): void;
  onSignedOut(): Promise<void>;
  onThemeChange(theme: ThemePreference): Promise<void>;
  projectDefaults: ProjectDefaults;
  theme: ThemePreference;
}) {
  const [inventory, setInventory] = useState<ProviderInventory | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [themeBusy, setThemeBusy] = useState(false);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [accountAction, setAccountAction] = useState<"sign-out" | "delete" | null>(null);
  const [section, setSection] = useState<SettingsSection>("general");
  const sectionLabel = SETTINGS_PAGES.find((item) => item.id === section)?.label ?? "";
  useEffect(() => { onSection?.(sectionLabel); }, [onSection, sectionLabel]);

  /* Through the shared store, not the bridge directly: connecting here has to
     retire the "no model provider" notice on the composer waiting behind this
     page, not only the rows on it. */
  const refresh = useCallback(async () => {
    if (!api) return;
    setInventory(await refreshProviders());
  }, [api]);

  useEffect(() => { void refresh().catch((cause) => setError(message(cause))); }, [refresh]);

  const connected = useMemo(() => inventory?.providers.filter((provider) => provider.state !== "disconnected") ?? [], [inventory]);
  const available = useMemo(() => inventory?.providers.filter((provider) => provider.state === "disconnected") ?? [], [inventory]);
  const defaultProvider = useMemo(
    () => connected.find((provider) => provider.id === inventory?.defaultModel.provider),
    [connected, inventory],
  );

  const open = (provider: Provider) => {
    setSelected(provider);
    setError("");
  };

  const setDefault = async (provider: Provider, nextModel: string) => {
    if (!api) return;
    setError("");
    try { await api.setDefaultProvider(provider.id, nextModel); await refresh(); }
    catch (cause) { setError(message(cause)); }
  };

  const disconnect = async (provider: Provider) => {
    if (!api) return;
    setError("");
    try { await api.disconnectProvider(provider.id); await refresh(); setSelected(null); }
    catch (cause) { setError(message(cause)); }
  };

  const finishAccountAction = async () => {
    if (!api || !accountAction) return;
    setBusy(true); setError("");
    try {
      if (accountAction === "delete") await api.deleteAccount();
      else await api.signOut();
      await onSignedOut();
      setAccountAction(null);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  return (
    /* Two surfaces, not one. The nav sits on the window's own ground — it is
       chrome, and chrome belongs to the window — while the page it points at is
       a sheet laid on top, the same blob every other content pane in the app
       gets. A settings screen drawn as one flat field reads as a web page that
       happened to open here rather than as a place in the app. */
    <div className="flex h-full min-h-0 pt-1 pr-1.5 pb-1.5">
      {/* Narrow, and padded only on the leading edge: the rows are the column, so
          the space between them and the page is the page's, not the list's. */}
      <aside className="relative flex h-full w-52 shrink-0 flex-col py-1 pr-0 pl-1.5">
        {/* No search field. Five destinations is a list you read, not one you
            query, and a search box over five rows is a control that exists to
            look like a settings screen rather than to find anything. */}
        <nav aria-label="Settings sections" className="app-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-1">
          {SETTINGS_NAV.map((group) => (
            <section key={group.label}>
              {/* The same heading the page's own sections wear, one step
                  quieter. It is doing two jobs: naming the pair, and giving the
                  column something at the top that is not a button — a list of
                  five identical rows has no reading order, and a heading is what
                  gives it one.

                  Sized and inset to the rows rather than spaced away from them:
                  a 28px band on the same left edge as the glyphs, so the column
                  is one ruled list of bands instead of headings floating at
                  their own margin above groups of buttons. `pl-2` is the
                  button's own leading inset once it carries an icon — the
                  heading lines up with the glyph column, which is the line the
                  eye actually follows down. */}
              <h2 className="font-display text-muted-foreground/70 flex h-7 items-center pl-2 text-ui-sm font-[550]">{group.label}</h2>
              <ul>
                {group.items.map(({ id, label, icon: Icon }) => (
                  <li key={id}>
                    <Button
                      className={NAV_ITEM}
                      data-active={section === id || undefined}
                      onClick={() => setSection(id)}
                      size="lg"
                      variant="ghost"
                    >
                      <Icon data-icon="inline-start" />
                      <span className="grow">{label}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        {/* The bottom of the column, and the reason it no longer reads as empty:
            a list that ends in mid-air looks unfinished, and one that ends on a
            line of type looks placed. It also answers, from anywhere in
            Settings, the question the About panel answers only from General. */}
        {build && (
          <p className="text-muted-foreground/60 shrink-0 pt-3 pb-1 pl-2 text-ui-sm">
            Construct {build.version}
            {!build.packaged && " · dev"}
          </p>
        )}
      </aside>
      <div className="app-blob app-scroll ml-1.5 min-w-0 grow overflow-y-auto">
      {/* The column the page is read in. Wide top padding rather than a title bar:
          the heading sits in air, which is what makes it read as the page's name
          rather than as the first row of the list under it. */}
      <main className="mx-auto w-full max-w-2xl px-8 pt-16 pb-40 text-left">
        <SettingsHeader>
          <h1>{sectionLabel}</h1>
        </SettingsHeader>

        {error && !selected && (
          <p className="border-destructive/30 bg-destructive/5 text-destructive mb-6 rounded-xl border px-3 py-2 text-xs font-medium">{error}</p>
        )}

        <div className="space-y-8">

        {section === "general" && <><Group label="Appearance">
          <Row>
            <SettingsField description="Pick an appearance, or follow the system setting." title="Theme" />
            <SettingsControl className="max-w-none">
            <Segmented
              ariaLabel="Application theme"
              disabled={themeBusy}
              onChange={(value) => {
                setThemeBusy(true);
                setError("");
                void onThemeChange(value).catch((cause) => setError(message(cause))).finally(() => setThemeBusy(false));
              }}
              options={[
                { value: "system", label: "Auto", icon: Laptop },
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
              ]}
              value={theme}
            />
            </SettingsControl>
          </Row>
        </Group>

        {/* Its own group: the code palette is not an app-appearance setting, it
            is the one preference that changes three surfaces at once. */}
        <Group label="Code">
          <CodeThemeRows />
        </Group>

        {/* Its own group rather than a row under Appearance: an update is not a
            preference, and filing it under one implies it is optional. */}
        <Group label="Updates">
          <UpdateSettings api={api} />
        </Group>

        <AboutConstruct /></>}

        {/* Account sits under You rather than under General, which is where it
            was. A page called General that opened on "Sign out" was a page whose
            first row had nothing to do with its name; and the profile, the
            session and the record are three views of one subject — who is using
            this copy of Construct. Splitting them across two destinations meant
            deleting your account was filed under the same heading as the theme. */}
        {section === "you" && <>
          <LearnerRows api={api} onError={setError} onRetake={onRetakeIntake} />

          <Group label="Account">
            <Row>
              <SettingsField
                description={`Remove this account and clear its sessions from this ${deviceNoun}. Anything already synced stays in your cloud history.`}
                title="Sign out"
              />
              <SettingsControl>
                <Button onClick={() => setAccountAction("sign-out")} size="sm" variant="secondary"><LogOut />Sign out</Button>
              </SettingsControl>
            </Row>
          </Group>

          {/* Last, and deliberately: this is the only irreversible control in
              Settings, and it should be the thing you have to travel furthest to. */}
          <Group label="Data & Privacy">
            <Row>
              <SettingsField
                description="Permanently remove your account and cloud-backed learning history. This cannot be undone."
                title="Delete account"
              />
              <SettingsControl>
                <Button onClick={() => setAccountAction("delete")} size="sm" variant="destructive"><Trash2 />Delete account</Button>
              </SettingsControl>
            </Row>
          </Group>
        </>}

        {section === "languages" && (
          <Group label="Language servers">
            <LanguageServerRows api={api} onError={setError} />
          </Group>
        )}

        {section === "projects" && (
          <Group label="New projects">
            <ProjectDefaultsRows api={api} defaults={projectDefaults} onChange={onProjectDefaults} onError={setError} />
          </Group>
        )}

        {section === "models" && <><Group label="Providers">
          {!inventory && (
            <Row>
              <ConstructDots className="text-muted-foreground" pattern="pulse" size={16} />
              <span className="text-muted-foreground px-1 text-sm font-medium">Reading the provider inventory…</span>
            </Row>
          )}
          {connected.map((provider) => (
            <ProviderRow
              api={api}
              isDefault={inventory?.defaultModel.provider === provider.id}
              key={provider.id}
              onDisconnect={() => void disconnect(provider)}
              onKeyUrl={() => provider.keyUrl && void api?.openExternal(provider.keyUrl)}
              onMakeDefault={() => void setDefault(provider, provider.selectedModel)}
              onModel={(model) => void setDefault(provider, model)}
              onOpen={() => open(provider)}
              provider={provider}
            />
          ))}
          {available.length > 0 && <ConnectRow available={available} onPick={open} />}
        </Group>

        {defaultProvider && (
          <Group label="Agent">
            <Row>
              <SettingsField description="Every new run starts here until you switch provider." title="Default model" />
              <SettingsControl>
                <ModelPicker onSelect={(model) => void setDefault(defaultProvider, model)} provider={defaultProvider} />
              </SettingsControl>
            </Row>
          </Group>
        )}

        {/* Not under Providers, and deliberately above Web search: this is where
            the problems come from, which is a bigger fact about how Construct behaves
            than either of the things below it. */}
        <Group label="Web search">
          <WebSearchRow api={api} />
        </Group></>}


        </div>
      </main>
      </div>

      <ProviderConnectDialog api={api} onClose={() => setSelected(null)} onConnected={refresh} provider={selected} />

      <Dialog onOpenChange={(next) => { if (!next && !busy) setAccountAction(null); }} open={!!accountAction}>
        <DialogContent className="sm:max-w-[28rem]">
          <DialogHeader>
            <DialogTitle>{accountAction === "delete" ? "Delete your account?" : "Sign out of Construct?"}</DialogTitle>
            <DialogDescription>
              {accountAction === "delete"
                ? "This permanently deletes your account, synced sessions, attempts, ability evidence, and local workspaces."
                : `This clears your sessions, challenges, and workspaces from this ${deviceNoun}. Construct pushes anything still pending first, and signing back in restores nothing that never reached the cloud.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={busy} onClick={() => setAccountAction(null)} variant="secondary">Cancel</Button>
            <Button disabled={busy} onClick={() => void finishAccountAction()} variant={accountAction === "delete" ? "destructive" : "default"}>
              {busy && <Orb invert label="Working" px={15} state="working" />}{accountAction === "delete" ? "Delete permanently" : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
