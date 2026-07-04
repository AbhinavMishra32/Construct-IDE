import type { AuthView } from "@better-auth-ui/core";
import { useSession } from "@better-auth-ui/react";
import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useMemo, useState, type ComponentPropsWithoutRef, type PropsWithChildren } from "react";
import { Button, Input } from "@opaline/ui";

import { Auth } from "../../../components/auth/auth";
import { AuthProvider } from "../../../components/auth/auth-provider";
import { cleanAndNormalizeUrl } from "../../ConstructApplication";
import { CONSTRUCT_CLOUD_PRODUCTION_BASE_URL, endpointFromRuntimeInfo } from "../../../../shared/constructCloud";

function configuredConstructCloudEndpoint(): string {
  return typeof window === "undefined"
    ? CONSTRUCT_CLOUD_PRODUCTION_BASE_URL
    : endpointFromRuntimeInfo(window.construct?.getRuntimeInfo?.());
}

type ConstructCloudAccountPanelProps = {
  baseUrl: string;
  accessToken: string;
  disabled?: boolean;
  allowEndpointEditing?: boolean;
  onBaseUrlChange: (baseUrl: string) => void;
  onAccessTokenChange: (accessToken: string) => void;
  onUsageLoaded?: (usage: any) => void;
};

type CloudUsageWindow = {
  windowStart: string;
  windowEnd: string;
  resetAt?: string;
  usedUnits: number;
  reservedUnits: number;
  limitUnits: number;
  remainingUnits: number;
  percentage: number;
};

type CloudUsageResponse = {
  user?: {
    email?: string | null;
    name?: string | null;
    plan?: string | null;
  };
  usage?: {
    plan: string;
    windows: {
      five_hour_all: CloudUsageWindow;
      weekly_all: CloudUsageWindow;
      weekly_expensive?: CloudUsageWindow;
    };
  };
};

export function ConstructCloudAccountPanel({
  baseUrl,
  accessToken,
  disabled,
  allowEndpointEditing = false,
  onBaseUrlChange,
  onAccessTokenChange,
  onUsageLoaded
}: ConstructCloudAccountPanelProps) {
  const normalizedBaseUrl = normalizeCloudBaseUrl(baseUrl);
  const authClient = useMemo(() => createAuthClient({
    baseURL: normalizedBaseUrl,
    fetchOptions: {
      auth: {
        type: "Bearer",
        token: () => localStorage.getItem("bearer_token") || "",
      },
      onSuccess: (ctx) => {
        const authToken = ctx.response.headers.get("set-auth-token");
        if (authToken) {
          localStorage.setItem("bearer_token", authToken);
        }
      }
    }
  }), [normalizedBaseUrl]);
  const [authPath, setAuthPath] = useState("/auth/sign-in");
  const authView = authViewFromPath(authPath);

  const navigate = useCallback((options: { to: string }) => {
    setAuthPath(options.to);
  }, []);

  const Link = useMemo(() => {
    return function ConstructCloudAuthLink({
      href,
      to,
      onClick,
      children,
      ...props
    }: PropsWithChildren<
      { className?: string; href: string; to?: string } & Pick<
        ComponentPropsWithoutRef<"a">,
        "aria-disabled" | "tabIndex" | "onClick"
      >
    >) {
      return (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onClick?.(event);
            setAuthPath(to ?? href);
          }}
        >
          {children}
        </a>
      );
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className={allowEndpointEditing ? "grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] mt-1" : "grid gap-3 mt-1"}>
        {allowEndpointEditing ? (
          <Input
            value={baseUrl}
            disabled={disabled}
            placeholder={configuredConstructCloudEndpoint()}
            className="bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] px-3 py-2 w-full transition-all"
            onChange={(event) => onBaseUrlChange(event.target.value)}
          />
        ) : null}
        <Input
          type="password"
          value={accessToken}
          disabled={disabled}
          placeholder="cct_..."
          className="bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] px-3 py-2 w-full transition-all"
          onChange={(event) => onAccessTokenChange(event.target.value)}
        />
      </div>

      <AuthProvider
        authClient={authClient}
        baseURL={normalizedBaseUrl}
        redirectTo="/settings/account"
        socialProviders={["google", "github"]}
        emailAndPassword={{ enabled: true, forgotPassword: true, name: true, rememberMe: true }}
        navigate={navigate}
        Link={Link}
      >
        <div className="w-full">
          <ConstructCloudTokenPanel
            baseUrl={normalizedBaseUrl}
            accessToken={accessToken}
            disabled={disabled}
            authClient={authClient}
            onAccessTokenChange={onAccessTokenChange}
            onUsageLoaded={onUsageLoaded}
          />
        </div>
      </AuthProvider>
    </div>
  );
}

function ConstructCloudTokenPanel({
  baseUrl,
  accessToken,
  disabled,
  authClient,
  onAccessTokenChange,
  onUsageLoaded
}: {
  baseUrl: string;
  accessToken: string;
  disabled?: boolean;
  authClient: ReturnType<typeof createAuthClient>;
  onAccessTokenChange: (accessToken: string) => void;
  onUsageLoaded?: (usage: any) => void;
}) {
  const { data: session, isPending, refetch } = useSession(authClient);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<CloudUsageResponse["usage"] | null>(null);

  useEffect(() => {
    if (!session) {
      setUsage(null);
      onUsageLoaded?.(null);
      return;
    }

    let cancelled = false;
    const token = localStorage.getItem("bearer_token");
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    void fetch(`${baseUrl}/api/me`, {
      credentials: "include",
      headers
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Account lookup failed (${response.status}).`);
        return await response.json() as CloudUsageResponse;
      })
      .then((payload) => {
        if (!cancelled) {
          setUsage(payload.usage ?? null);
          onUsageLoaded?.(payload.usage ?? null);
        }
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [baseUrl, session, onUsageLoaded]);

  async function mintToken() {
    try {
      setBusy(true);
      setStatus(null);
      const token = localStorage.getItem("bearer_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`${baseUrl}/api/cloud/tokens`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ name: "Construct Desktop" })
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || `Token mint failed (${response.status}).`);
      }
      const payload = await response.json() as { token?: string };
      if (!payload.token) throw new Error("Token response did not include a desktop token.");
      onAccessTokenChange(payload.token);
      setStatus("Hosted compute token saved in the current draft.");
      await refetch();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const user = session?.user;

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-background/40 p-4">
      <div>
        <div className="text-[13px] font-semibold text-foreground">
          {user ? (user.email ?? user.name ?? "Signed in") : isPending ? "Checking account..." : "No Construct account"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground font-normal">
          {usage ? `${usage.plan.toUpperCase()} plan` : accessToken ? "Construct Cloud token is configured." : "Sign in to mint a Construct Cloud token."}
        </div>
      </div>



      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="small"
          disabled={disabled || busy || !user}
          className="bg-primary hover:bg-primary/90 text-primary-foreground disabled:bg-muted disabled:text-muted-foreground font-medium text-xs px-3.5 py-1.5 h-[34px] rounded-lg transition-colors cursor-pointer border-none"
          onClick={() => void mintToken()}
        >
          {busy ? "Minting..." : "Mint hosted token"}
        </Button>
        {accessToken ? (
          <Button
            size="small"
            variant="secondary"
            disabled={disabled}
            className="bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border/80 font-medium text-xs px-3.5 py-1.5 h-[34px] rounded-lg transition-colors cursor-pointer"
            onClick={() => onAccessTokenChange("")}
          >
            Clear token
          </Button>
        ) : null}
        <Button
          size="small"
          variant="secondary"
          disabled={disabled || busy}
          className="bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border/80 font-medium text-xs px-3.5 py-1.5 h-[34px] rounded-lg transition-colors cursor-pointer"
          onClick={async () => {
            localStorage.removeItem("bearer_token");
            await authClient.signOut();
            window.location.reload();
          }}
        >
          Sign out
        </Button>
      </div>

      {status ? <div className="text-xs text-muted-foreground font-normal">{status}</div> : null}
    </div>
  );
}

function authViewFromPath(path: string): AuthView {
  if (path.includes("sign-up")) return "signUp";
  if (path.includes("forgot-password")) return "forgotPassword";
  if (path.includes("reset-password")) return "resetPassword";
  if (path.includes("verify-email")) return "verifyEmail";
  if (path.includes("sign-out")) return "signOut";
  return "signIn";
}

function normalizeCloudBaseUrl(baseUrl: string): string {
  return cleanAndNormalizeUrl(baseUrl);
}
