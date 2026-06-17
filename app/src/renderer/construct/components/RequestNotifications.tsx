import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, LoaderCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { apiTracker, type ActiveCall } from "../lib/apiTracker";

const SLOW_REQUEST_MS = 15_000;
const SLOW_TOAST_ID = "construct:slow-requests";

export function RequestNotifications() {
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const unsubscribe = apiTracker.subscribe(() => {
      setActiveCalls([...apiTracker.getActiveCalls()]);
    });
    setActiveCalls([...apiTracker.getActiveCalls()]);
    return unsubscribe;
  }, []);

  const slowCalls = useMemo(
    () => activeCalls.filter((call) => Date.now() - call.startedAt >= SLOW_REQUEST_MS),
    [activeCalls]
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveCalls([...apiTracker.getActiveCalls()]);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (slowCalls.length === 0) {
      toast.dismiss(SLOW_TOAST_ID);
      return;
    }

    toast.custom(
      () => (
        <div className="w-[min(38rem,calc(100vw-2rem))] rounded-2xl border border-border bg-popover/95 p-5 text-popover-foreground shadow-2xl backdrop-blur">
          <button
            type="button"
            className="absolute -right-3 -top-3 flex size-9 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground shadow"
            onClick={() => toast.dismiss(SLOW_TOAST_ID)}
            aria-label="Dismiss slow request notification"
          >
            ×
          </button>
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-1 size-5 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">Some requests are slow</div>
              <button
                type="button"
                className="mt-1 flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-muted-foreground"
                onClick={() => setExpanded((value) => !value)}
              >
                <span>{slowCalls.length} request{slowCalls.length === 1 ? "" : "s"} waiting longer than 15s.</span>
                {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
              {expanded ? (
                <div className="mt-4 space-y-3">
                  {slowCalls.map((call) => (
                    <div key={call.id}>
                      <div className="text-sm font-semibold">{call.key}</div>
                      <div className="text-xs text-muted-foreground">{call.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Started {new Date(call.startedAt).toLocaleString([], {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit"
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ),
      { id: SLOW_TOAST_ID, duration: Infinity }
    );
  }, [expanded, slowCalls]);

  return null;
}

export function showProviderUpdateToast(phase: "running" | "succeeded" | "failed", description?: string) {
  const id = "construct:provider-update";
  if (phase === "running") {
    toast.custom(
      () => (
        <ProviderToast
          icon={<LoaderCircle className="size-5 animate-spin text-muted-foreground" />}
          title="Updating providers"
          description={description ?? "Running provider update command."}
        />
      ),
      { id, duration: Infinity }
    );
    return;
  }

  toast.custom(
    () => (
      <ProviderToast
        icon={
          phase === "succeeded"
            ? <span className="flex size-5 items-center justify-center rounded-full border-2 border-emerald-500 text-emerald-500">✓</span>
            : <TriangleAlert className="size-5 text-destructive" />
        }
        title={phase === "succeeded" ? "Provider updates finished" : "Provider updates failed"}
        description={description ?? (phase === "succeeded" ? "New sessions will use the updated providers." : "Provider update failed.")}
      />
    ),
    { id, duration: phase === "succeeded" ? 4000 : Infinity }
  );
}

function ProviderToast({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="relative w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-border bg-popover/95 p-5 text-popover-foreground shadow-2xl backdrop-blur">
      <button
        type="button"
        className="absolute -right-3 -top-3 flex size-9 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground shadow"
        onClick={() => toast.dismiss("construct:provider-update")}
        aria-label="Dismiss provider update notification"
      >
        ×
      </button>
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">{title}</div>
          <div className="mt-1 text-sm font-medium text-muted-foreground">{description}</div>
        </div>
        <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground" type="button">
          Update
        </button>
      </div>
    </div>
  );
}
