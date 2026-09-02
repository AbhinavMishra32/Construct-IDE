import type { AgentActivityStep } from "@construct/domain";

/** Converts append-only live parts into the stored message shape. */
export function settleTurnActivity(
  source: AgentActivityStep[] | undefined,
  preferredBody: string,
): { activity: AgentActivityStep[]; body: string } {
  const activity = (source ?? []).map((step) => ({ ...step }));
  const tail = activity[activity.length - 1];

  /* Only prose at the actual end of the turn becomes the reply body. Earlier
     prose stays ordered among reasoning and tools. */
  if (tail?.kind === "note" && tail.text.trim()) {
    activity.pop();
    return { activity, body: tail.text };
  }

  const body = preferredBody.trim();
  const alreadyOrdered = Boolean(body) && activity.some((step) => step.kind === "note" && step.text.trim() === body);
  return { activity, body: alreadyOrdered ? "" : preferredBody };
}

/** How much of one step's result is worth replaying. Long enough for a stack
 *  trace's first line or a file's shape, short enough that ten of them do not
 *  crowd out the conversation itself. */
const DETAIL = 240;
/** Steps replayed per turn, newest kept. A turn that made forty calls is
 *  summarised by its last ten; the earlier ones were setup for those. */
const STEPS = 10;

/**
 * What an earlier agent turn replays as, on the next turn.
 *
 * The body alone is not the turn. An agent that read `main.py` and ran the
 * program last turn, and is handed back only the sentence it said about it,
 * has no record that it looked — so it looks again, says the same thing again,
 * and the learner watches it verify the same fact four times in a row. Every
 * turn was starting from nothing but its own prose.
 *
 * So the calls come back too, as one compact line each: what was called, what
 * it was about, and what it returned. Not the full output — that would refill
 * the window with file contents the agent can read again if it needs them —
 * but enough to know the question was already asked and what the answer was.
 *
 * Reasoning is deliberately left out. It is not a fact about the project, it
 * is how this turn arrived at one, and replaying it invites the agent to
 * relitigate a decision it already made.
 */
export function replayTurn(message: { body: string; activity: readonly AgentActivityStep[] }): string {
  const done = message.activity
    .filter((step) => step.kind === "tool" && step.tool)
    .slice(-STEPS)
    .map((step) => {
      const what = step.label.trim() || step.tool;
      const got = step.detail.trim().replace(/\s+/g, " ").slice(0, DETAIL);
      return `- ${step.ok ? "" : "failed: "}${step.tool} — ${what}${got ? ` → ${got}` : ""}`;
    });

  const said = message.body.trim();
  if (!done.length) return said;
  return [said, said ? "" : null, "[Work you already did this turn — do not repeat it:", ...done, "]"]
    .filter((line) => line !== null)
    .join("\n");
}
