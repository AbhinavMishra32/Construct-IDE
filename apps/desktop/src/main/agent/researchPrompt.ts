/**
 * The research agent, run once before Construct teaches a new project.
 *
 * v0.7's `FLOW_RESEARCH_AGENT_PROMPT`, kept nearly word for word. Only the tool
 * names differ, because 1.0's tools are named for what they do rather than for
 * the network they use — the instructions themselves are the behaviour, and
 * rewriting them would be rewriting the behaviour.
 *
 * Why a separate agent at all, rather than letting the mentor look things up as
 * it goes: a mentor that has to research mid-lesson either stops teaching to
 * search or teaches from whatever it already knew. Doing the reading up front
 * means the first thing the learner hears is already grounded in what this
 * domain actually is — and it happens while they are still reading the goal they
 * just typed, so it costs them nothing.
 */
export const RESEARCH_AGENT_PROMPT = `You are the Construct Research Agent.

Your job is to prepare concise project/domain/technology background for a new Construct project.

You may use web-search, web-fetch, read-file, list-files, flow-memory-fetch, and flow-memory-patch.
You do not teach the learner directly.
You do not create a learner profile.
You do not create a deterministic project plan.
You do not modify project code.
Do not ask the learner clarifying questions. If the project goal is broad or ambiguous, preserve the researched interpretations, state the assumption that is most useful for a mentor handoff, and let the main mentor clarify later only when the next teaching step depends on it.

Create useful markdown for research.md. Explain what the project/domain is, relevant technology, how it works practically, terminology, common libraries/tools, important caveats, source references when useful, and what a mentor agent should know before teaching/building this project.

Keep it concise and source-grounded. Use short search queries, low result counts, and no raw web dumps. Prefer official docs or primary project sources when available. Use web-fetch when you already have exact URLs and need the page contents. Put citations next to the sentences or bullets they support using markdown links.

Use flow-memory-patch to replace the starter research note or append a dated research note. Then reply with a short summary of what you saved, not a question.`;

/** What the research agent is asked to do, for a project that has just been
 *  created. The goal is the learner's own words; nothing else is known yet. */
export function researchRequest(project: { name: string; goal: string; language: string }): string {
  return [
    `Research this new Construct project and write research.md.`,
    ``,
    `Project: ${project.name}`,
    `Goal: ${project.goal}`,
    `Language: ${project.language}`,
  ].join("\n");
}

/**
 * What the mentor is told once research is done — or once it has been skipped.
 *
 * A message rather than an empty turn, because the agent's first move should be
 * teaching rather than greeting: v0.7 handed off with exactly this instruction,
 * and the difference it makes is whether the learner's first screen is "hello,
 * what would you like to do?" or the first real step of their project.
 */
export function openingRequest(researched: boolean): string {
  return [
    `Start this new project ${researched ? "now that research is complete" : "without prior research"}.`,
    `Read your memory files first — research.md holds the project background, so continue from its assumptions instead of redoing discovery.`,
    `Greet the learner in one line, then take the next useful mentor step without waiting for another message: look at the workspace, plan the path with plan-learning-path, and begin teaching or ask one focused question if the goal is genuinely ambiguous.`,
  ].join("\n");
}

/** Whether a turn's activity includes a successful write to research.md. What
 *  decides if the host has to save the research itself. */
export function wroteResearch(step: { kind: string; tool: string; ok: boolean; input: string }): boolean {
  return step.kind === "tool" && step.tool === "flow-memory-patch" && step.ok && step.input.includes("research.md");
}

/**
 * The research reply, wrapped as the document the mentor reads.
 *
 * The heading and the handoff paragraph are v0.7's, and they earn their place:
 * without them the mentor treats research.md as background reading and asks the
 * learner project-direction questions it already has answers to. The paragraph
 * tells it to continue from the assumptions rather than re-open them.
 */
export function researchDocument(reply: string): string {
  return [
    `# Research`,
    "",
    "## Mentor handoff",
    "",
    "Use these notes as project context before teaching, planning, or asking project-direction questions. If the goal has more than one reasonable reading, continue from the assumptions below and clarify later only when the learner's next step depends on it.",
    "",
    "## Summary",
    "",
    reply.trim(),
  ].join("\n");
}
