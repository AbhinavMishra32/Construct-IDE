import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { Orb } from "../common/Orb";

import type { ConstructApi, SyncStatus } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Whether this machine is in step with the account.
 *
 * Shows nothing at all when there is nothing to say. Construct works with no
 * account and no network, so a permanent "synced" light would be chrome
 * announcing that the ordinary case is still the ordinary case — and a green
 * tick beside somebody who never signed in would be a lie about where their
 * work is.
 *
 * It appears for the two states a learner can act on: offline, and failed. And
 * for the moment a sync is actually running, because a click that produced no
 * visible response is a click people repeat.
 */
export function SyncBadge({ api }: { api: ConstructApi | undefined }) {
  const [status, setStatus] = useState<SyncStatus>({ state: "idle", at: null });

  useEffect(() => {
    void api?.syncStatus().then(setStatus).catch(() => undefined);
    return api?.onSyncStatus(setStatus);
  }, [api]);

  if (status.state === "idle") return null;

  const look =
    status.state === "syncing"
      ? { icon: RefreshCw, label: "Syncing…", tone: "text-muted-foreground", spin: true }
      : status.state === "offline"
        ? { icon: CloudOff, label: "Offline — your work is safe on this machine", tone: "text-muted-foreground", spin: false }
        : { icon: TriangleAlert, label: status.error ?? "Sync failed", tone: "text-[var(--warning)]", spin: false };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={look.label}
          className={cn("app-no-drag grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--sidebar-accent)]", look.tone)}
          /* Retrying is the only useful thing to do about either state, so the
             badge is the retry. */
          onClick={() => void api?.syncNow()}
          type="button"
        >
          {look.spin ? <Orb label="Syncing" px={14} state="connecting" /> : <look.icon className="size-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{look.label}</TooltipContent>
    </Tooltip>
  );
}
