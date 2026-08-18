import { z } from "zod";

export const id = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });

/**
 * A question the Construct agent puts to the learner mid-turn, pausing until it
 * is answered.
 *
 * The agent is a teaching system, so asking is a first-class move rather than a
 * fallback for a failed tool call: it is how the agent finds out what the
 * learner already understands before deciding what to introduce next. Ported
 * from the v0.7 `ask_user_question` tool so stored turns keep parsing.
 */
export const askUserQuestionInputSchema = z.object({
  questions: z
    .array(
      z.object({
        header: z.string().trim().min(1).max(40),
        question: z.string().trim().min(3).max(1000),
        options: z.array(z.object({ label: z.string().trim().min(1).max(160) })).min(2).max(6),
        multiple: z.boolean().default(false),
        custom: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(3),
});
export const askUserQuestionRequestSchema = askUserQuestionInputSchema.extend({ id });
export type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;
export type AskUserQuestionRequest = z.infer<typeof askUserQuestionRequestSchema>;

/**
 * One settled step of agent work, kept with the reply it helped produce.
 *
 * The live stream shows these while a turn runs, and a turn that has ended is
 * still the only account of how its answer was reached — so steps are stored
 * rather than discarded when the stream closes. Every field carries a default
 * so a turn written by an earlier build still parses.
 */
export const agentActivityStepSchema = z.object({
  /** `note` is a sentence the agent said mid-turn, before one of its calls. */
  kind: z.enum(["tool", "reasoning", "note"]).default("tool"),
  tool: z.string().default(""),
  /** What the call was about, in the learner's terms. Never a raw argument. */
  label: z.string().default(""),
  /** The agent's own name for this step, falling back to the per-tool label. */
  actionTitle: z.string().default(""),
  /** What it returned, already reduced to one line by the worker. */
  detail: z.string().default(""),
  ok: z.boolean().default(true),
  /** The reasoning itself, for a step that is thinking rather than a call. */
  text: z.string().default(""),
  /** How long that thinking took, so the folded row can say it. */
  seconds: z.number().nonnegative().default(0),
  /** Arguments and result as formatted JSON, so a turn read back from storage
   *  can be opened up to exactly what it did. */
  input: z.string().default(""),
  output: z.string().default(""),
});
export type AgentActivityStep = z.infer<typeof agentActivityStepSchema>;

export const agentMessageSchema = z.object({
  id,
  role: z.enum(["learner", "agent", "system"]),
  body: z.string(),
  createdAt: isoDate,
  activity: z.array(agentActivityStepSchema).default([]),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

/** A notice the main process raises for the shell to surface — an update, a
 *  credential problem, a provider that stopped answering. */
export type ConstructNotice = {
  kind: "info" | "warning" | "error";
  title: string;
  body: string;
};
