import { type ReactNode } from "react";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

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
            ? <CircleCheck className="size-5 text-emerald-500" />
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
    <div className="relative w-[min(34rem,calc(100vw-2rem))] rounded-[10px] border border-border bg-popover/95 p-4 text-popover-foreground shadow-xl backdrop-blur">
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
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-sm font-medium text-muted-foreground">{description}</div>
        </div>
        <button className="h-7 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground" type="button">
          Update
        </button>
      </div>
    </div>
  );
}
