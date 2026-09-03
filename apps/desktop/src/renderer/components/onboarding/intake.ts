import type { LearnerFooting, LearnerLeaning, LearnerPace } from "../../../shared/api";

/**
 * The intake: what Construct asks before it teaches anybody anything.
 *
 * The copy lives here rather than in the render for the same reason the sign-in
 * screen's does. Nine steps read as a conversation or they read as a form, and
 * you can only tell which by reading them one after another, which you cannot do
 * when they are scattered through JSX.
 *
 * Two rules held throughout.
 *
 * Every question has to change what Construct does. A question whose answer goes
 * into a database and nowhere else wasted the learner's time, and the list is
 * this short because it was cut to the ones that reach the prompt.
 *
 * And nothing here is required. Someone who wants to get to their first project
 * can press through all of it, and what they get is an agent that asks for
 * itself, which is what it did before this existed. The intake buys the agent a
 * head start. It is not a gate.
 *
 * On the writing: say it the way you would say it out loud. Short sentences, no
 * dashes holding two clauses together, no summing-up line at the end of a
 * caption. A caption is one fact about why the question is being asked. If it
 * needs a second sentence, the second sentence is what the learner gets out of
 * answering, and then it stops.
 */

/* The model step comes first because nothing after it works without one: the
   adaptive question and the portrait are both written by the learner's own
   provider, and so is every turn they will ever run.

   It is shown even when a provider is already connected. That looks like a
   wasted screen until you remember providers are stored per machine and the
   intake runs per account: skipping it meant the second person to sign in on a
   shared laptop was never shown, or asked about, the model their work was about
   to be sent to. One connected row with a tick answers the step in the time it
   takes to read it. */
/* The openings step is last, and it is the reason the eight before it are worth
   answering. Everything up to the portrait is Construct finding out; that screen
   is Construct spending what it found out on three projects it would actually
   build with this person. It used to end on a button that said "Start building"
   and led to an empty project list — which asks someone who has just spent five
   minutes explaining what they want to build to explain it again, in a dialog,
   as a goal. */
export const STEPS = ["model", "name", "footing", "language", "ambition", "leanings", "research", "question", "portrait", "openings"] as const;
export type StepName = (typeof STEPS)[number];

export type StepCopy = {
  /** The question, in Construct's voice. */
  title: string;
  /** One line under it. Says why it is being asked, wherever that is not
   *  obvious. A question that explains itself is a question people answer
   *  honestly rather than strategically. */
  caption: string;
  /** What the button says. */
  action: string;
};

export const COPY: Record<StepName, StepCopy> = {
  model: {
    title: "Connect a model.",
    caption: "Construct runs on your provider and your key. Nothing you write is sent anywhere else.",
    action: "Continue",
  },
  name: {
    title: "What should I call you?",
    caption: "Construct teaches. It will not write your code for you.",
    action: "Continue",
  },
  footing: {
    title: "Where are you starting from?",
    caption: "The honest answer, not the ambitious one. It sets where explanations begin.",
    action: "Continue",
  },
  language: {
    title: "What do you want to write?",
    caption: "Your home language. New projects start here unless you say otherwise.",
    action: "Continue",
  },
  ambition: {
    title: "What do you want to be able to build?",
    caption: "Say it however it sits in your head. Vague is fine. This is what the rest is aimed at.",
    action: "Continue",
  },
  leanings: {
    title: "When does an explanation land?",
    caption: "Pick as many as are true. This changes how the teaching is shaped, not what it covers.",
    action: "Continue",
  },
  /* Optional, and after the model rather than before it, because a key here
     changes what Construct can find out about your project. It does not change
     whether Construct works at all. */
  research: {
    title: "Should I be able to read the web?",
    caption: "With an Exa key Construct reads real docs and source before it teaches, so what it tells you matches the version you actually have. Optional. Settings has this too.",
    action: "Continue",
  },
  question: {
    title: "One more, just for you.",
    caption: "Written from what you have said, not from a list.",
    action: "Continue",
  },
  portrait: {
    title: "Here is what I understood.",
    caption: "Change anything I got wrong. This is what I carry into every project.",
    action: "Continue",
  },
  openings: {
    title: "Three things I would build with you.",
    caption: "Written from what you told me. Pick one and we start on it now, together.",
    action: "Start building",
  },
};

export const FOOTINGS: Array<{ value: LearnerFooting; label: string; detail: string }> = [
  { value: "new", label: "New to this", detail: "Little or no code written yet." },
  { value: "some", label: "I can build small things", detail: "Tutorials, scripts, the odd side project." },
  { value: "working", label: "I write code for work", detail: "Fluent somewhere, here for something new." },
  { value: "returning", label: "Coming back to it", detail: "Wrote code before, and it has been a while." },
];

export const LEANINGS: Array<{ value: LearnerLeaning; label: string; detail: string }> = [
  { value: "shape-first", label: "Show me the shape first", detail: "The whole thing in outline before any detail." },
  { value: "hands-first", label: "Put me in it early", detail: "Start building, explain into the mess." },
  { value: "first-principles", label: "Derive it, don't assert it", detail: "Build up from what is underneath." },
  { value: "by-example", label: "Lead with an example", detail: "One concrete case, then the general rule." },
];

export const PACES: Array<{ value: LearnerPace; label: string }> = [
  { value: "deep", label: "Slow and thorough" },
  { value: "brisk", label: "Keep moving" },
];

/**
 * Whether a step has been answered well enough to be worth storing.
 *
 * Not whether it may be left. Every step may be left. This decides whether the
 * button says "Continue" or "Skip", which is the whole of the pressure the
 * intake applies: it tells you plainly that you are skipping something, and then
 * lets you.
 */
export function answered(
  step: StepName,
  draft: {
    name: string;
    ambition: string;
    leanings: LearnerLeaning[];
    followUpAnswer: string;
    modelReady: boolean;
    searchReady: boolean;
  },
): boolean {
  switch (step) {
    case "name":
      return draft.name.trim().length > 0;
    case "ambition":
      return draft.ambition.trim().length >= 3;
    case "leanings":
      return draft.leanings.length > 0;
    case "question":
      return draft.followUpAnswer.trim().length >= 2;
    case "model":
      return draft.modelReady;
    case "research":
      return draft.searchReady;
    /* The openings step is answered by pressing a card, not by the button under
       them — so the button is always the way past it, and always says so. */
    case "openings":
      return false;
    /* Footing, language and the portrait all start on a real value rather than
       an empty one, so there is nothing here that can be half-done. */
    default:
      return true;
  }
}
