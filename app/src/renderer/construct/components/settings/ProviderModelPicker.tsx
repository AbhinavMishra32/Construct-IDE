import { useMemo, useState, type ReactElement, type ReactNode, type SVGProps } from "react";
import { Bot, Check, ChevronDown, Search, Star } from "lucide-react";

import { Button } from "@opaline/ui";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import type { AiProvider, ModelCatalogEntry } from "../../types";

type Icon = (props: SVGProps<SVGSVGElement>) => ReactElement;

type ProviderModelPickerProps = {
  provider: AiProvider;
  value: string;
  models: ModelCatalogEntry[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (model: string) => void;
};

const providerOrder: AiProvider[] = ["litellm", "opencode-zen", "github-copilot", "openrouter", "openai"];

const providerMeta: Record<AiProvider, { label: string; icon: Icon }> = {
  openai: { label: "OpenAI", icon: OpenAIIcon },
  openrouter: { label: "OpenRouter", icon: OpenRouterIcon },
  "github-copilot": { label: "GitHub Copilot", icon: GithubCopilotIcon },
  "opencode-zen": { label: "OpenCode Zen", icon: OpenCodeZenIcon },
  litellm: { label: "LiteLLM", icon: LiteLlmIcon }
};

export function ProviderModelPicker({
  provider,
  value,
  models,
  disabled,
  placeholder = "Pick model",
  onChange
}: ProviderModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | "favorites">(() => provider);
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites());
  const activeModel = models.find((model) => model.id === value) ?? null;
  const providerBuckets = useMemo(() => bucketModels(models, provider), [models, provider]);
  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const source = selectedProvider === "favorites"
      ? models.filter((model) => favorites.includes(model.id))
      : providerBuckets.get(selectedProvider) ?? [];

    if (!normalizedQuery) return source;
    return source.filter((model) => [
      model.id,
      model.name,
      model.providerName,
      model.subProvider,
      model.description
    ].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery));
  }, [favorites, models, providerBuckets, query, selectedProvider]);

  function toggleFavorite(modelId: string) {
    setFavorites((current) => {
      const next = current.includes(modelId)
        ? current.filter((item) => item !== modelId)
        : [modelId, ...current].slice(0, 24);
      writeFavorites(next);
      return next;
    });
  }

  function chooseModel(modelId: string) {
    onChange(modelId);
    setOpen(false);
  }

  const triggerLabel = activeModel?.name || value || placeholder;
  const activeProvider = providerFromModel(activeModel, provider);
  const ActiveIcon = providerMeta[activeProvider].icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="small"
          disabled={disabled}
          className="h-8 min-w-0 max-w-[16rem] justify-between gap-2 px-2 text-xs"
        >
          <span className="flex min-w-0 items-center gap-2">
            <ActiveIcon className="size-4 shrink-0" />
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(44rem,calc(100vw-3rem))] overflow-hidden rounded-lg border bg-popover p-0 shadow-2xl"
      >
        <div className="flex max-h-[34rem] min-h-[24rem]">
          <div className="w-14 shrink-0 border-r bg-muted/25 p-1">
            <RailButton
              active={selectedProvider === "favorites"}
              label="Favorites"
              onClick={() => setSelectedProvider("favorites")}
            >
              <Star className="size-5 fill-current" />
            </RailButton>
            <div className="my-1 border-t" />
            {providerOrder
              .filter((candidate) => providerBuckets.has(candidate) || candidate === provider)
              .map((candidate) => {
                const Icon = providerMeta[candidate].icon;
                return (
                  <RailButton
                    key={candidate}
                    active={selectedProvider === candidate}
                    label={providerMeta[candidate].label}
                    onClick={() => setSelectedProvider(candidate)}
                  >
                    <Icon className="size-5" />
                  </RailButton>
                );
              })}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b p-2">
              <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  value={query}
                  placeholder="Search models..."
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filteredModels.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  No models found.
                </div>
              ) : (
                filteredModels.map((model, index) => {
                  const modelProvider = providerFromModel(model, provider);
                  const Icon = providerMeta[modelProvider].icon;
                  const favorite = favorites.includes(model.id);
                  const selected = model.id === value;
                  return (
                    <div
                      key={model.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                        "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                        selected && "bg-muted/70"
                      )}
                      onClick={() => chooseModel(model.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          chooseModel(model.id);
                        }
                      }}
                    >
                      <button
                        type="button"
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground",
                          favorite && "text-yellow-500"
                        )}
                        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFavorite(model.id);
                        }}
                      >
                        <Star className={cn("size-4", favorite && "fill-current")} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{model.name}</span>
                          {selected ? <Check className="size-3.5 shrink-0 text-blue-400" /> : null}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Icon className="size-3 shrink-0" />
                          <span className="truncate">
                            {model.providerName || providerMeta[modelProvider].label}
                            {model.subProvider ? ` · ${model.subProvider}` : ""}
                          </span>
                        </div>
                      </div>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        ⌘{index + 1}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RailButton({
  active,
  label,
  children,
  onClick
}: {
  active: boolean;
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex aspect-square w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            active && "bg-muted text-foreground"
          )}
          aria-label={label}
          onClick={onClick}
        >
          {children}
          {active ? <span className="absolute -right-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-l-full bg-primary" /> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

function bucketModels(models: ModelCatalogEntry[], activeProvider: AiProvider): Map<AiProvider, ModelCatalogEntry[]> {
  const buckets = new Map<AiProvider, ModelCatalogEntry[]>();
  for (const model of models) {
    const provider = providerFromModel(model, activeProvider);
    const bucket = buckets.get(provider) ?? [];
    bucket.push(model);
    buckets.set(provider, bucket);
  }
  return buckets;
}

function providerFromModel(model: ModelCatalogEntry | null, fallback: AiProvider): AiProvider {
  const providerId = model?.providerId?.replace(/_/g, "-").toLowerCase();
  const id = model?.id ?? "";
  if (providerId === "github-copilot" || id.startsWith("github_copilot/") || id.startsWith("github-copilot/")) return "github-copilot";
  if (providerId === "opencode-zen") return "opencode-zen";
  if (providerId === "openrouter" || id.startsWith("openrouter/")) return "openrouter";
  if (providerId === "openai" || id.startsWith("openai/")) return "openai";
  return fallback === "github-copilot" || fallback === "opencode-zen" || fallback === "openrouter" || fallback === "openai"
    ? fallback
    : "litellm";
}

function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem("construct:model-picker:favorites");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeFavorites(favorites: string[]) {
  try {
    window.localStorage.setItem("construct:model-picker:favorites", JSON.stringify(favorites));
  } catch {
    // Best-effort UI preference.
  }
}

function OpenAIIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 256 260" className={cn("fill-current", className)}>
      <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z" />
    </svg>
  );
}

function GithubCopilotIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 256 208" className={cn("fill-current", className)}>
      <path d="M205.3 31.4c14 14.8 20 35.2 22.5 63.6 6.6 0 12.8 1.5 17 7.2l7.8 10.6c2.2 3 3.4 6.6 3.4 10.4v28.7a12 12 0 0 1-4.8 9.5C215.9 187.2 172.3 208 128 208c-49 0-98.2-28.3-123.2-46.6a12 12 0 0 1-4.8-9.5v-28.7c0-3.8 1.2-7.4 3.4-10.5l7.8-10.5c4.2-5.7 10.4-7.2 17-7.2 2.5-28.4 8.4-48.8 22.5-63.6C77.3 3.2 112.6 0 127.6 0h.4c14.7 0 50.4 2.9 77.3 31.4ZM128 78.7c-3 0-6.5.2-10.3.6a27.1 27.1 0 0 1-6 12.1 45 45 0 0 1-32 13c-6.8 0-13.9-1.5-19.7-5.2-5.5 1.9-10.8 4.5-11.2 11-.5 12.2-.6 24.5-.6 36.8 0 6.1 0 12.3-.2 18.5 0 3.6 2.2 6.9 5.5 8.4C79.9 185.9 105 192 128 192s48-6 74.5-18.1a9.4 9.4 0 0 0 5.5-8.4c.3-18.4 0-37-.8-55.3-.4-6.6-5.7-9.1-11.2-11-5.8 3.7-13 5.1-19.7 5.1a45 45 0 0 1-32-12.9 27.1 27.1 0 0 1-6-12.1c-3.4-.4-6.9-.5-10.3-.6Zm-27 44c5.8 0 10.5 4.6 10.5 10.4v19.2a10.4 10.4 0 0 1-20.8 0V133c0-5.8 4.6-10.4 10.4-10.4Zm53.4 0c5.8 0 10.4 4.6 10.4 10.4v19.2a10.4 10.4 0 0 1-20.8 0V133c0-5.8 4.7-10.4 10.4-10.4Zm-73-94.4c-11.2 1.1-20.6 4.8-25.4 10-10.4 11.3-8.2 40.1-2.2 46.2A31.2 31.2 0 0 0 75 91.7c6.8 0 19.6-1.5 30.1-12.2 4.7-4.5 7.5-15.7 7.2-27-.3-9.1-2.9-16.7-6.7-19.9-4.2-3.6-13.6-5.2-24.2-4.3Zm69 4.3c-3.8 3.2-6.4 10.8-6.7 19.9-.3 11.3 2.5 22.5 7.2 27a41.7 41.7 0 0 0 30 12.2c8.9 0 17-2.9 21.3-7.2 6-6.1 8.2-34.9-2.2-46.3-4.8-5-14.2-8.8-25.4-9.9-10.6-1-20 .7-24.2 4.3ZM128 56c-2.6 0-5.6.2-9 .5.4 1.7.5 3.7.7 5.7 0 1.5 0 3-.2 4.5 3.2-.3 6-.3 8.5-.3 2.6 0 5.3 0 8.5.3-.2-1.6-.2-3-.2-4.5.2-2 .3-4 .7-5.7-3.4-.3-6.4-.5-9-.5Z" />
    </svg>
  );
}

function OpenCodeZenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function OpenRouterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none">
      <path d="M4 12h10.5m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 5h2.5A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function LiteLlmIcon(props: SVGProps<SVGSVGElement>) {
  return <Bot {...props} />;
}
