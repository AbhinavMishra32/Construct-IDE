import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Absolute path of the project, so a file inside it is placed by where it
   *  sits in the project rather than by where the disk happens to keep it. */
  directory: string;
  /** The file being described — the one under the pointer while the strip is
   *  being surveyed, the open one otherwise. */
  path: string;
  /** True for a file outside the project, followed into from a definition. */
  external: boolean;
  /** True while the pointer is resting on a tab. A survey lasts as long as the
   *  pointer does; everything else is a flash. */
  peeking: boolean;
};

/** How long the path stays up after you land in a file. Long enough to read a
 *  few segments, short enough that it is gone before it becomes furniture. */
const FLASH_MS = 2400;
/** Segments kept when a path is too long to show whole. The tail is what
 *  locates a file; the head is almost always the same for every file you have
 *  open, so it is the first thing worth losing. */
const MAX_SEGMENTS = 3;

/**
 * Where the open file sits, said quietly and only when it is worth saying.
 *
 * Construct is a mentor, not an IDE, and a permanent breadcrumb bar is a row of
 * chrome charging rent against a window whose real subject is the conversation.
 * But a filename on its own stops being an address the moment two `index.ts`
 * are open, or the moment a definition drops you into a package you did not
 * choose to visit. So the path is real, and it earns its appearance:
 *
 *   - hovering a tab shows where that file lives, so the strip can be surveyed
 *     without opening anything;
 *   - landing in a file flashes its path and then lets it go, which is exactly
 *     the moment after following a definition when you need to know where you
 *     ended up;
 *   - a file outside the project keeps its path for as long as it is open,
 *     because out there the path is the only thing that identifies it —
 *     `lib.dom.d.ts` alone says nothing about which of them you are reading.
 *
 * It renders the ancestry and not the leaf, since the tab beside it is already
 * showing the filename. Two places naming the same file is how a breadcrumb
 * bar starts to feel like noise.
 *
 * It sits in the empty trailing half of the tab strip — space the strip was
 * already holding open — so nothing reflows when it comes and goes.
 */
export function FilePath({ directory, path, external, peeking }: Props) {
  const reduced = useReducedMotion();
  const [flash, setFlash] = useState(true);

  useEffect(() => {
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [path]);

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const absolute = external ? path : `${directory}/${path}`;
  const segments = useMemo(() => {
    /* The leaf is dropped — the tab has it. What is left is the ancestry, and
       only its tail: the head of an absolute path into a package manager's
       store is a hash nobody reads. */
    const all = path.split(/[\\/]/).filter(Boolean).slice(0, -1);
    return { shown: all.slice(-MAX_SEGMENTS), elided: all.length > MAX_SEGMENTS };
  }, [path]);

  /* A file at the top of the project has no ancestry to give, so it says
     nothing rather than saying it emptily. */
  if (segments.shown.length === 0 && !external) return null;

  const visible = peeking || external || flash;

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.button
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "flex min-w-0 shrink items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-sm outline-none transition-colors",
            "text-muted-foreground hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-foreground",
          )}
          exit={{ opacity: 0, y: reduced ? 0 : -2 }}
          initial={{ opacity: 0, y: reduced ? 0 : -2 }}
          onClick={() => {
            /* Nothing is said when the clipboard refuses. A path readout that
               throws an error banner is a worse trade than one that quietly
               does not confirm. */
            void navigator.clipboard.writeText(absolute).then(() => setCopied(true)).catch(() => undefined);
          }}
          title={absolute}
          transition={reduced ? { duration: 0 } : { duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
          type="button"
        >
          {/* The one mark that says this file is not the learner's. Outside the
              project nothing else in the window distinguishes it, and the
              editor being read-only is a thing you find out by trying. */}
          {external && <ExternalLink className="size-3 shrink-0 opacity-60" />}
          {copied ? (
            <span className="truncate">Path copied</span>
          ) : (
            <span className="flex min-w-0 items-center truncate font-mono">
              {segments.elided && <span className="opacity-50">…/</span>}
              {segments.shown.map((segment, index) => (
                <span className="truncate" key={`${segment}-${index}`}>
                  {index > 0 && <span className="opacity-50">/</span>}
                  {segment}
                </span>
              ))}
            </span>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
