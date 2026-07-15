/** Source chat chrome shared by Construct-only cards embedded in the transcript. */
export const FLOW_CHAT_EVENT_CARD_CLASS_NAME =
  "w-full max-w-[46rem] min-w-0 rounded-[var(--radius-user-message,0.8rem)] border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)] shadow-none";

export const FLOW_CHAT_EVENT_ROW_CLASS_NAME =
  `${FLOW_CHAT_EVENT_CARD_CLASS_NAME} transition-colors hover:bg-[var(--color-background-button-secondary-hover)]`;

export const FLOW_CHAT_EVENT_ICON_CLASS_NAME =
  "grid size-7 shrink-0 place-items-center rounded-[0.5rem] border border-[color:var(--color-border)] bg-[var(--color-background-surface)] text-muted-foreground";
