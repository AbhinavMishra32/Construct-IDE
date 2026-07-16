// Ported from Synara's apps/web/src/components/chat/ProviderModelPicker.tsx.
// Construct adaptations are limited to provider types, availability, catalog loading,
// and the persistence callback. The nested-menu interaction remains source-shaped.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import {
  ChevronDownIcon,
  CloudIcon,
  GithubIcon,
  Layers3Icon,
  Loader2Icon,
  RouteIcon,
} from "lucide-react";

import { Button } from "@opaline/ui";

import type { AiSettings, ModelCatalogEntry } from "../types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Skeleton } from "../../components/ui/skeleton";
import { cn } from "../../lib/utils";

export type ComposerProvider = AiSettings["provider"] | "construct-cloud";

type ProviderIcon = ComponentType<SVGProps<SVGSVGElement>>;

type ProviderOption = {
  value: ComposerProvider;
  label: string;
  Icon: ProviderIcon;
};

const PROVIDER_OPTIONS: ReadonlyArray<ProviderOption> = [
  { value: "construct-cloud", label: "Construct Cloud", Icon: CloudIcon },
  { value: "openai", label: "OpenAI", Icon: OpenAIIcon },
  { value: "openrouter", label: "OpenRouter", Icon: RouteIcon },
  { value: "github-copilot", label: "GitHub Copilot", Icon: GithubIcon },
  { value: "opencode-zen", label: "OpenCode Zen", Icon: OpenCodeIcon },
  { value: "litellm", label: "LiteLLM", Icon: Layers3Icon },
];

function resolveLiveProviderAvailability(
  provider: ComposerProvider,
  settings: AiSettings,
): { disabled: boolean; label: string | null } {
  if (provider === "construct-cloud" && !settings.constructCloudAccessToken.trim()) {
    return { disabled: true, label: "Sign in" };
  }
  if (provider === "openai" && !settings.openAiApiKey.trim()) {
    return { disabled: true, label: "Sign in" };
  }
  if (provider === "openrouter" && !settings.openRouterApiKey.trim()) {
    return { disabled: true, label: "Sign in" };
  }
  if (provider === "litellm" && !settings.liteLlmBaseUrl.trim()) {
    return { disabled: true, label: "Unavailable" };
  }
  return { disabled: false, label: null };
}

function modelLabel(model: ModelCatalogEntry): string {
  if (model.name?.trim()) return model.name.trim();
  const leaf = model.id.split("/").pop() || model.id;
  return leaf.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type ProviderModelMenuItemsProps = {
  settings: AiSettings;
  provider: ComposerProvider;
  model: string;
  models: ReadonlyArray<ModelCatalogEntry>;
  modelsBusy: boolean;
  modelsError: string | null;
  disabled?: boolean;
  onLoadProviderModels: (provider: ComposerProvider) => Promise<ModelCatalogEntry[]>;
  onProviderModelChange: (provider: ComposerProvider, model: string) => void;
  onAfterSelection?: () => void;
};

// This is the direct Construct adapter for Synara's ProviderModelMenuItems:
// provider rows are sub-triggers and each provider owns a separate radio submenu.
const ProviderModelMenuItems = memo(function ProviderModelMenuItems(
  props: ProviderModelMenuItemsProps,
) {
  const [modelsByProvider, setModelsByProvider] = useState<
    Partial<Record<ComposerProvider, ReadonlyArray<ModelCatalogEntry>>>
  >({ [props.provider]: props.models });
  const [loadingProvider, setLoadingProvider] = useState<ComposerProvider | null>(null);
  const [providerErrors, setProviderErrors] = useState<Partial<Record<ComposerProvider, string>>>({});

  useEffect(() => {
    setModelsByProvider((current) => ({ ...current, [props.provider]: props.models }));
  }, [props.models, props.provider]);

  const loadProviderModels = useCallback(
    async (provider: ComposerProvider) => {
      if (modelsByProvider[provider] || loadingProvider === provider) return;
      setLoadingProvider(provider);
      setProviderErrors((current) => ({ ...current, [provider]: undefined }));
      try {
        const models = await props.onLoadProviderModels(provider);
        setModelsByProvider((current) => ({ ...current, [provider]: models }));
      } catch (error) {
        setProviderErrors((current) => ({
          ...current,
          [provider]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setLoadingProvider((current) => (current === provider ? null : current));
      }
    },
    [loadingProvider, modelsByProvider, props],
  );

  const renderModelRadioGroup = (provider: ComposerProvider) => {
    const loading = loadingProvider === provider || (provider === props.provider && props.modelsBusy);
    const models = modelsByProvider[provider] ?? [];
    const error = providerErrors[provider] ?? (provider === props.provider ? props.modelsError : null);

    if (loading) {
      return (
        <div aria-label="Loading models" className="flex flex-col gap-2 px-2 py-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className={cn("h-3.5 rounded-full", index % 3 === 0 ? "w-24" : "w-32")} />
            </div>
          ))}
        </div>
      );
    }

    if (models.length === 0) {
      return <div className="px-2 py-2 text-sm text-muted-foreground">{error || "No models found"}</div>;
    }

    return (
      <DropdownMenuRadioGroup
        value={provider === props.provider ? props.model : ""}
        onValueChange={(value) => {
          if (props.disabled || !value) return;
          props.onProviderModelChange(provider, value);
          props.onAfterSelection?.();
        }}
      >
        {[...models]
          .sort((left, right) => modelLabel(left).localeCompare(modelLabel(right)))
          .map((option) => (
            <DropdownMenuRadioItem key={`${provider}:${option.id}`} value={option.id} title={option.id}>
              <span className="min-w-0 truncate">{modelLabel(option)}</span>
            </DropdownMenuRadioItem>
          ))}
      </DropdownMenuRadioGroup>
    );
  };

  return (
    <>
      {PROVIDER_OPTIONS.map((option) => {
        const availability = resolveLiveProviderAvailability(option.value, props.settings);
        const OptionIcon = option.Icon;

        if (availability.disabled) {
          return (
            <DropdownMenuItem key={option.value} disabled>
              <OptionIcon className="size-3 shrink-0 opacity-80" aria-hidden="true" />
              <span>{option.label}</span>
              <span className="ms-auto text-[11px] text-muted-foreground/80">
                {availability.label}
              </span>
            </DropdownMenuItem>
          );
        }

        return (
          <DropdownMenuSub
            key={option.value}
            onOpenChange={(open) => {
              if (open) void loadProviderModels(option.value);
            }}
          >
            <DropdownMenuSubTrigger>
              <OptionIcon className="size-3 shrink-0 text-muted-foreground/85" aria-hidden="true" />
              <span>{option.label}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto p-1">
              {renderModelRadioGroup(option.value)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        );
      })}
    </>
  );
});

type ProviderModelPickerProps = {
  settings: AiSettings;
  model: string;
  models: ModelCatalogEntry[];
  modelsBusy: boolean;
  modelsError: string | null;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectionCommitted?: () => void;
  onLoadProviderModels: (provider: ComposerProvider) => Promise<ModelCatalogEntry[]>;
  onProviderModelChange: (provider: ComposerProvider, model: string) => void;
};

export const ProviderModelPicker = memo(function ProviderModelPicker(
  props: ProviderModelPickerProps,
) {
  const [uncontrolledMenuOpen, setUncontrolledMenuOpen] = useState(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const isMenuOpen = props.open ?? uncontrolledMenuOpen;
  const provider: ComposerProvider = props.settings.source === "construct-cloud"
    ? "construct-cloud"
    : props.settings.provider;
  const selectedModel = props.models.find((option) => option.id === props.model);
  const selectedModelLabel = selectedModel ? modelLabel(selectedModel) : modelLabel({ id: props.model, name: props.model });
  const activeProvider = PROVIDER_OPTIONS.find((option) => option.value === provider) ?? PROVIDER_OPTIONS[1];
  const ActiveProviderIcon = activeProvider.Icon;

  const setMenuOpen = useCallback(
    (nextOpen: boolean) => {
      if (props.open === undefined) setUncontrolledMenuOpen(nextOpen);
      props.onOpenChange?.(nextOpen);
    },
    [props],
  );

  const scheduleSelectionCommitted = useCallback(() => {
    if (selectionCommitTimerRef.current !== null) {
      window.clearTimeout(selectionCommitTimerRef.current);
    }
    selectionCommitTimerRef.current = window.setTimeout(() => {
      selectionCommitTimerRef.current = null;
      props.onSelectionCommitted?.();
    }, 0);
  }, [props]);

  useEffect(
    () => () => {
      if (selectionCommitTimerRef.current !== null) {
        window.clearTimeout(selectionCommitTimerRef.current);
      }
    },
    [],
  );

  const handleAfterSelection = useCallback(() => {
    setMenuOpen(false);
    scheduleSelectionCommitted();
  }, [scheduleSelectionCommitted, setMenuOpen]);

  return (
    <DropdownMenu
      open={isMenuOpen}
      onOpenChange={(nextOpen) => {
        if (props.disabled) {
          setMenuOpen(false);
          return;
        }
        setMenuOpen(nextOpen);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Change model"
          className="min-w-0 max-w-[12rem] shrink-0 justify-start gap-1.5 whitespace-nowrap px-2 sm:px-2.5"
          disabled={props.disabled}
          size="sm"
          title={selectedModelLabel}
          type="button"
          variant="chrome"
        >
          <ActiveProviderIcon className="size-3.5 shrink-0 text-[var(--color-text-foreground)]" data-icon="inline-start" />
          <span className="min-w-0 truncate text-[var(--color-text-foreground)]">{selectedModelLabel}</span>
          <ChevronDownIcon className="ms-0.5 size-3 shrink-0 opacity-60" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-1" sideOffset={4}>
        <ProviderModelMenuItems
          settings={props.settings}
          provider={provider}
          model={props.model}
          models={props.models}
          modelsBusy={props.modelsBusy}
          modelsError={props.modelsError}
          disabled={props.disabled}
          onLoadProviderModels={props.onLoadProviderModels}
          onProviderModelChange={props.onProviderModelChange}
          onAfterSelection={handleAfterSelection}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

function OpenCodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 32H8V16H24V32Z" fill="#BCBBBB" />
      <path d="M24 8H8V32H24V8ZM32 40H0V0H32V40Z" fill="currentColor" />
    </svg>
  );
}

// Synara's OpenAI provider icon is react-icons/si's SiOpenai. Construct does not
// depend on react-icons, so the same Simple Icons glyph is inlined here.
function OpenAIIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} role="img" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}
