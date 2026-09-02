import { cn } from "@/lib/utils";

/**
 * The navigation glyphs, drawn rather than imported.
 *
 * Lucide draws on a 24-unit grid at stroke-width 2, which is a weight built for
 * 24px. Rendered at 16 — where every one of these sits — that is a 3-unit stroke
 * relative to the glyph, and it reads thick and blunt beside the hairlines the
 * rest of the window is made of. The platform's own chrome is nearer 1.2px at
 * this size, which is what makes it look drawn rather than stamped.
 *
 * So these are 1.6 on the same grid, with round caps and joins, which lands at
 * about 1.2px once scaled to the 18px they draw at. The geometry is SF Symbols' proportions and
 * not Lucide's: shorter chevrons with a wider opening, and a house whose roof
 * overhangs its walls the way a roof does.
 */
function Glyph({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      className={cn("size-[1.125rem]", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

/* Sized against the house beside them rather than to their own box.
   
   A chevron drawn to the same inset as a full glyph is optically much smaller —
   it has no width to speak of, so the eye reads its height alone and the pair
   looked shrunken next to Home. These run 12 of the 24 units tall against the
   house's 15.6, which is what makes the three read as one set. */
export const ChevronLeftGlyph = ({ className }: { className?: string }) => (
  <Glyph className={className}>
    <path d="M14.5 6 9 12l5.5 6" />
  </Glyph>
);

export const ChevronRightGlyph = ({ className }: { className?: string }) => (
  <Glyph className={className}>
    <path d="M9.5 6 15 12l-5.5 6" />
  </Glyph>
);

/**
 * The sidebar toggle: a pane with its leading column ruled off.
 *
 * Lucide's `PanelLeftClose` puts an arrow *inside* the panel, so at 16px it is a
 * box with a smudge in it — unreadable, and it was the ugliest thing in the
 * title bar. This is the shape every application on the platform uses for the
 * same control: the window, and the column being hidden. Nothing has to be
 * decoded, because the icon is a picture of the layout rather than of the
 * action.
 */
export const SidebarGlyph = ({ className }: { className?: string }) => (
  <Glyph className={className}>
    <rect height="14.5" rx="2.6" ry="2.6" width="17.5" x="3.25" y="4.75" />
    <path d="M9.4 4.75v14.5" />
  </Glyph>
);

/**
 * A house, in two strokes: the roof over the walls.
 *
 * Drawn as separate paths rather than one closed outline because the roof has
 * to overhang — a single path makes the eaves meet the walls at a corner, which
 * is the detail that makes most house icons look like a pentagon.
 */
export const HomeGlyph = ({ className }: { className?: string }) => (
  <Glyph className={className}>
    <path d="M3.4 11.1 12 4.4l8.6 6.7" />
    <path d="M5.6 9.6v9a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4v-9" />
  </Glyph>
);

/** A terminal: the window, and a prompt inside it. */
export const TerminalGlyph = ({ className }: { className?: string }) => (
  <Glyph className={className}>
    <rect height="14.5" rx="2.6" ry="2.6" width="17.5" x="3.25" y="4.75" />
    <path d="M7.6 9.6l2.6 2.4-2.6 2.4" />
    <path d="M12.9 14.9h3.5" />
  </Glyph>
);

/** A conversation. One rounded speech shape, no tail flourish — at this size a
 *  tail is three pixels of noise. */
export const ChatGlyph = ({ className }: { className?: string }) => (
  <Glyph className={className}>
    <path d="M20.5 12.4c0 3.9-3.8 7-8.5 7-1 0-2-.15-2.9-.42L4.2 20.3l1.4-3.7C4.3 15.4 3.5 14 3.5 12.4c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z" />
  </Glyph>
);
