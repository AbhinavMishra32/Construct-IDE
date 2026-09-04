import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ConstructApi, UpdateState } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/agent/Markdown";
import { ConstructDots } from "@/components/common/ConstructDots";
import { message } from "@/lib/format";

/**
 * Telling someone their software has an update.
 *
 * The version before this one announced it with a sparkle in a black tile, a
 * blurred glow behind the header, a gradient hairline, a green tick in a
 * coloured disc, and the words "A new round for Construct". Every one of those
 * is the application being pleased with itself in front of somebody who was
 * doing something else. An update is an interruption, and the only honest way
 * to design an interruption is to make it small, say what it is, and get out.
 *
 * So this is modelled on the platform's own: the app's mark at its real size,
 * the version as the title because the version is the news, one line of meta,
 * the notes as plain text, and two buttons. No decoration that is not
 * information, and no adjective anywhere.
 */
function bytes(value: number | null) {
  if (value === null) return null;
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1_024 && unit < units.length - 1) { amount /= 1_024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

/**
 * The app's own mark, where the platform puts an alert's icon.
 *
 * Not in a tile and not on a fill: the mark is already a shape, and mounting a
 * shape on a black square is how an icon ends up looking pasted on.
 *
 * 40px, which is larger than it looks like it needs to be. The mark is a
 * five-by-five field of dots whose sizes fall away from the centre, and below
 * about thirty the falloff stops being visible — it stops reading as concentric
 * rings and starts reading as a swatch of grey texture. An icon that reads as
 * texture is worse than no icon, so it is either drawn at a size where it is
 * the logo or it is left out. In the notification it is left out: that panel is
 * already inside Construct, and an app telling you which app it is is the kind
 * of thing only an installer needs to do. */
function UpdateMark() {
  return <ConstructDots className="shrink-0 text-foreground/85" pattern="still" size={40} />;
}

/** The line under the title: what you are on, and how big this is.
 *
 *  Interpuncts rather than sentences. These are three facts of two words each,
 *  and a paragraph would make them sound like an argument for updating. */
function metaLine(parts: Array<string | null>) {
  return parts.filter(Boolean).join(" · ");
}

/**
 * One shell for both dialogs.
 *
 * The offer and the after-the-fact changelog are the same object seen twice —
 * a version, its notes, and one thing to do about it — so they are one
 * component. Two nearly identical dialogs is how the tick in the green disc
 * came to exist in the first place: nothing was holding them to each other.
 */
function UpdateDialog({
  action,
  meta,
  notes,
  onOpenChange,
  open,
  secondary,
  version,
}: {
  action: { label: string; onSelect: () => void };
  meta: string;
  notes: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  secondary?: { label: string; onSelect: () => void } | undefined;
  version: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Close button off: the footer already says the two things you can do,
          and a third dismissal floating over the notes is the kind of control
          that exists because a component offered it. Escape still closes. */}
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[30rem]" showCloseButton={false}>
        <div className="flex items-center gap-3.5 px-5 pt-5 pb-4">
          <UpdateMark />
          <DialogHeader className="min-w-0 flex-1 gap-1">
            {/* The version is the headline. It is what the person is deciding
                about, and every alternative — "A new round", "Construct just
                got better" — is a sentence written by the software about
                itself. */}
            <DialogTitle className="text-title leading-tight">Construct {version}</DialogTitle>
            <DialogDescription className="text-ui">{meta}</DialogDescription>
          </DialogHeader>
        </div>

        {/* Notes scroll, and the last visible line fades rather than being cut
            through the middle. A hard clip at a fixed height reads as a layout
            that ran out of room; the fade is the one piece of decoration here
            and it is carrying information — there is more of this below. */}
        <div className="relative border-t border-border/60">
          <div className="app-scroll max-h-[20rem] overflow-y-auto px-5 py-4">
            {notes ? (
              <Markdown source={notes} />
            ) : (
              <p className="text-ui text-muted-foreground">No release notes were published for this version.</p>
            )}
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-modal to-transparent" />
        </div>

        <DialogFooter className="m-0 rounded-none px-5">
          {secondary && (
            <Button onClick={secondary.onSelect} variant="ghost">
              {secondary.label}
            </Button>
          )}
          <Button onClick={action.onSelect}>{action.label}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The global update surface. It stays mounted independently of navigation so a
 *  download started in Settings keeps its progress while the learner works. */
export function UpdateExperience({ api }: { api: ConstructApi }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [offer, setOffer] = useState(false);
  const [failure, setFailure] = useState("");
  const offered = useRef<string | null>(null);

  useEffect(() => {
    void api.updateState().then(setState).catch(() => undefined);
    return api.onUpdateState(setState);
  }, [api]);

  useEffect(() => {
    if (state?.status !== "available" || !state.version || offered.current === state.version) return;
    offered.current = state.version;
    setOffer(true);
  }, [state]);

  const update = async () => {
    setFailure("");
    setOffer(false);
    try { await api.downloadUpdate(); }
    catch (cause) { setFailure(message(cause)); }
  };

  const dismissChangelog = () => {
    if (!state?.changelog) return;
    void api.dismissUpdateChangelog(state.changelog.version).catch(() => undefined);
  };

  const visible = state && ["available", "downloading", "installing", "error"].includes(state.status);
  const progress = state?.percent ?? 0;
  /* The rail runs for both busy states. Installing has no percentage to
     report — the file is already down and the app is saving open work — so it
     sits full rather than empty: an empty bar under "Installing" reads as
     stalled. */
  const rail = state?.status === "downloading" || state?.status === "installing";

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.aside
            animate={{ opacity: 1, y: 0 }}
            /* Narrower and squarer than it was. A notification is read in one
               glance from the corner of the eye, and the 24rem card with a
               2xl radius was reading as a panel that had escaped the layout. */
            className="app-no-drag fixed right-4 top-12 z-40 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover/95 shadow-[var(--app-shadow-menu)] supports-backdrop-filter:backdrop-blur-xl"
            exit={{ opacity: 0, y: -6 }}
            initial={{ opacity: 0, y: -6 }}
            role="status"
          >
            <div className="p-3.5">
              <div className="min-w-0">
                <p className="text-source-sm font-medium text-foreground">
                  {state.status === "available" && `Construct ${state.version} is available`}
                  {state.status === "downloading" && `Downloading Construct ${state.version}`}
                  {state.status === "installing" && `Installing Construct ${state.version}`}
                  {state.status === "error" && "Update could not finish"}
                </p>
                <p className="mt-0.5 text-ui leading-[1.45] text-muted-foreground">
                  {state.status === "available" && "Construct will save your work and restart."}
                  {state.status === "downloading" &&
                    metaLine([
                      `${Math.round(progress)}%`,
                      bytes(state.total) ? `${bytes(state.transferred)} of ${bytes(state.total)}` : null,
                      bytes(state.bytesPerSecond) ? `${bytes(state.bytesPerSecond)}/s` : null,
                    ])}
                  {state.status === "installing" && "Saving your open work before the restart."}
                  {state.status === "error" && (state.message ?? failure ?? "Construct could not complete the update.")}
                </p>

                {state.status === "available" && (
                  <div className="-ml-2 mt-2 flex items-center gap-0.5">
                    {/* Both are text. A filled button in a corner notification
                        is the software raising its voice for something the
                        person did not ask about. */}
                    <Button onClick={() => void update()} size="sm" variant="ghost">Update</Button>
                    {state.notes && <Button onClick={() => setOffer(true)} size="sm" variant="ghost">Details</Button>}
                  </div>
                )}
                {state.status === "error" && (
                  <div className="-ml-2 mt-2">
                    <Button onClick={() => void api.checkForUpdate()} size="sm" variant="ghost">Try again</Button>
                  </div>
                )}
              </div>
            </div>

            {/* The progress bar sits at the bottom edge, full bleed, one
                hairline tall. At the top it was a lid on the card; along the
                bottom it reads as the card filling up. */}
            {rail && (
              <div className="h-px w-full bg-border">
                <motion.div
                  animate={{ width: state.status === "installing" ? "100%" : `${progress}%` }}
                  className="h-full bg-foreground/70"
                  initial={{ width: 0 }}
                />
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      <UpdateDialog
        action={{ label: "Update and Restart", onSelect: () => void update() }}
        meta={metaLine([`You have ${state?.currentVersion}`, bytes(state?.total ?? null)])}
        notes={state?.notes ?? null}
        onOpenChange={setOffer}
        open={offer && state?.status === "available"}
        secondary={{ label: "Later", onSelect: () => setOffer(false) }}
        version={state?.version ?? ""}
      />

      <UpdateDialog
        action={{ label: "Continue", onSelect: dismissChangelog }}
        meta="Installed and running."
        notes={state?.changelog?.notes ?? null}
        onOpenChange={(open) => { if (!open) dismissChangelog(); }}
        open={Boolean(state?.changelog)}
        version={state?.changelog?.version ?? ""}
      />
    </>
  );
}
