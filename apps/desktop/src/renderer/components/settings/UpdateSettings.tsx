import { useEffect, useState } from "react";
import { Check, Download, RefreshCw, ShieldCheck } from "lucide-react";
import { Orb } from "../common/Orb";
import type { ConstructApi, UpdateState } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { message } from "@/lib/format";
import { SettingsControl, SettingsField, SettingsRow } from "./layout";

const STATUS: Record<UpdateState["status"], string> = {
  idle: "Ready to check",
  checking: "Checking for updates…",
  available: "Update available",
  downloading: "Downloading update…",
  installing: "Installing update…",
  current: "Construct is up to date",
  error: "Couldn’t check for updates",
  unsupported: "Available in packaged releases",
};

/** A read-only policy row: Construct always checks automatically. The controls are
 *  immediate actions, never a checkbox that can disable the safety guarantee. */
export function UpdateSettings({ api }: { api: ConstructApi | undefined }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!api) return;
    void api.updateState().then(setState).catch((cause) => setFailure(message(cause)));
    return api.onUpdateState(setState);
  }, [api]);

  const check = () => {
    if (!api) return;
    setFailure("");
    void api.checkForUpdate().catch((cause) => setFailure(message(cause)));
  };
  const download = () => {
    if (!api) return;
    setFailure("");
    void api.downloadUpdate().catch((cause) => setFailure(message(cause)));
  };

  const busy = state?.status === "checking" || state?.status === "downloading" || state?.status === "installing";
  const detail = state?.status === "available"
    ? `Construct ${state.version} is ready. Download it now and Construct will restart after saving your work.`
    : state?.status === "downloading"
      ? `${Math.round(state.percent ?? 0)}% downloaded. Construct will restart as soon as the verified update is ready.`
      : state?.status === "installing"
        ? "Saving your work and handing off to the verified installer."
        : state?.status === "error"
          ? state.message
          : state?.status === "unsupported"
            ? state.message
            : "Construct checks securely when it opens and every few hours while it is running.";

  return (
    <SettingsRow>
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-foreground">
        {busy ? <Orb label="Checking for updates" px={16} state="connecting" /> : state?.status === "current" ? <Check className="size-4 text-success" /> : <ShieldCheck className="size-4" />}
      </div>
      <SettingsField description={failure || detail} title={state ? STATUS[state.status] : "Automatic updates"} />
      <SettingsControl>
        {state?.status === "available" ? (
          <Button disabled={!api} onClick={download} size="sm"><Download />Update now</Button>
        ) : (
          <Button disabled={!api || busy || state?.status === "unsupported"} onClick={check} size="sm" variant="secondary"><RefreshCw />Check now</Button>
        )}
      </SettingsControl>
    </SettingsRow>
  );
}
