import type { AuthView } from "@better-auth-ui/core";
import { useSession } from "@better-auth-ui/react";
import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useMemo, useState, type ComponentPropsWithoutRef, type PropsWithChildren } from "react";
import { Button, Input } from "@opaline/ui";

import { Auth } from "../../../components/auth/auth";
import { AuthProvider } from "../../../components/auth/auth-provider";
import { cleanAndNormalizeUrl } from "../../ConstructApplication";

type ConstructCloudAccountPanelProps = {
  baseUrl: string;
  accessToken: string;
  disabled?: boolean;
  onBaseUrlChange: (baseUrl: string) => void;
  onAccessTokenChange: (accessToken: string) => void;
};

type CloudUsageWindow = {
  windowStart: string;
  windowEnd: string;
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
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
      fiveHour: CloudUsageWindow;
      weekly: CloudUsageWindow;
    };
  };
};

export function ConstructCloudAccountPanel({
  baseUrl,
  accessToken,
  disabled,
  onBaseUrlChange,
  onAccessTokenChange
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
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Input
          value={baseUrl}
          disabled={disabled}
          placeholder="https://cloud.tryconstruct.cc"
          onChange={(event) => onBaseUrlChange(event.target.value)}
        />
        <Input
          type="password"
          value={accessToken}
          disabled={disabled}
          placeholder="cct_..."
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
  onAccessTokenChange
}: {
  baseUrl: string;
  accessToken: string;
  disabled?: boolean;
  authClient: ReturnType<typeof createAuthClient>;
  onAccessTokenChange: (accessToken: string) => void;
}) {
  const { data: session, isPending, refetch } = useSession(authClient);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<CloudUsageResponse["usage"] | null>(null);

  useEffect(() => {
    if (!session) {
      setUsage(null);
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
        if (!cancelled) setUsage(payload.usage ?? null);
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [baseUrl, session]);

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
      setStatus("Desktop token saved in the current draft.");
      await refetch();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const user = session?.user;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-background p-3">
      <div>
        <div className="text-sm font-medium">
          {user ? (user.email ?? user.name ?? "Signed in") : isPending ? "Checking account" : "No cloud account"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {usage ? `${usage.plan.toUpperCase()} plan` : accessToken ? "Desktop token is present." : "Sign in to mint a desktop token."}
        </div>
      </div>

      {usage ? (
        <div className="grid gap-2 text-xs text-muted-foreground">
          <UsageMeter label="5 hour" window={usage.windows.fiveHour} />
          <UsageMeter label="Weekly" window={usage.windows.weekly} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="small" disabled={disabled || busy || !user} onClick={() => void mintToken()}>
          {busy ? "Minting..." : "Mint desktop token"}
        </Button>
        {accessToken ? (
          <Button size="small" variant="secondary" disabled={disabled} onClick={() => onAccessTokenChange("")}>
            Clear token
          </Button>
        ) : null}
        <Button
          size="small"
          variant="secondary"
          disabled={disabled || busy}
          onClick={async () => {
            localStorage.removeItem("bearer_token");
            await authClient.signOut();
            window.location.reload();
          }}
        >
          Sign Out
        </Button>
      </div>

      {status ? <div className="text-xs text-muted-foreground">{status}</div> : null}
    </div>
  );
}

function UsageMeter({ label, window }: { label: string; window: CloudUsageWindow }) {
  const used = formatSeconds(window.usedSeconds);
  const limit = formatSeconds(window.limitSeconds);
  const reset = new Date(window.windowEnd).toLocaleString();

  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span>{used} / {limit}</span>
      </div>
      <div className="mt-1 truncate">Resets {reset}</div>
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

function formatSeconds(seconds: number): string {
  const hours = seconds / 3600;
  if (hours >= 1) return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}
