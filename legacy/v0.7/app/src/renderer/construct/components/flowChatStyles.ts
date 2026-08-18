/**
 * Chat chrome for the Construct-owned cards embedded in the vendored transcript.
 *
 * These sit in a column of plain text on the pane's glass, so they carry the
 * least surface that still reads as a card: the elevated fill and a hairline, no
 * shadow. A drop shadow would lift them off a transcript they are part of, and
 * lifted cards in a scrolling conversation read as notifications rather than as
 * moments in it.
 *
 * The hairline is an inset ring rather than a border so it does not add a pixel
 * to the box — these are laid out against the 46rem reading measure, and a
 * border would put them one pixel wider than the text beside them.
 */
export const FLOW_CHAT_EVENT_CARD_CLASS_NAME =
  "w-full max-w-[46rem] min-w-0 rounded-[var(--radius-xl)] bg-[var(--color-background-elevated-secondary)] shadow-[inset_0_0_0_1px_var(--border)]";

export const FLOW_CHAT_EVENT_ROW_CLASS_NAME =
  `${FLOW_CHAT_EVENT_CARD_CLASS_NAME} transition-colors hover:bg-[var(--accent)]`;

/** 28px tile at the app's control radius, one step brighter than the card it sits
 *  on so the glyph reads without an outline drawn around it. */
export const FLOW_CHAT_EVENT_ICON_CLASS_NAME =
  "grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--surface-primary)] text-muted-foreground";
