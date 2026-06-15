import type { ConstructInteractResult } from "../shared/constructLearning";

export function selectLearnerFacingReply(
  result: Pick<ConstructInteractResult, "reply" | "requestedOutcome" | "dynamicSteps" | "generatedLiveSteps" | "actions">,
  streamedReply: string
): string {
  const structured = result.reply.trim();
  const streamed = streamedReply.trim();

  if (result.requestedOutcome === "clarify") {
    if (isCompleteLearnerFacingReply(structured) && structured.includes("?")) {
      return structured;
    }
    const question = firstStandaloneQuestion(streamed);
    if (question) {
      return question;
    }
  }

  if (isCompleteLearnerFacingReply(structured)) {
    return structured;
  }
  if (isCompleteLearnerFacingReply(streamed)) {
    return streamed;
  }

  const generatedSteps = result.dynamicSteps ?? result.generatedLiveSteps ?? [];
  if ((result.requestedOutcome === "create-dynamic-steps" || result.requestedOutcome === "generate-learning-steps") && generatedSteps.length > 0) {
    const titles = generatedSteps.map((step) => step.title.trim()).filter(Boolean);
    const summary = titles.length > 0 ? `: ${titles.join(", ")}` : "";
    return `Created ${generatedSteps.length} Dynamic Step${generatedSteps.length === 1 ? "" : "s"}${summary}. Review ${generatedSteps.length === 1 ? "it" : "them"} below.`;
  }

  if ((result.actions?.length ?? 0) > 0) {
    return "The requested work is ready. Use the action below to continue.";
  }

  return "The agent finished the run, but its written response was incomplete. Please retry this request.";
}

export function isLearnerFacingReply(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return false;
  }
  return !/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/i.test(trimmed);
}

export function isCompleteLearnerFacingReply(value: string): boolean {
  if (!isLearnerFacingReply(value)) {
    return false;
  }

  const trimmed = value.trim();
  const withoutFences = removeBalancedTokenPairs(trimmed, "```");
  if (withoutFences === null) {
    return false;
  }
  const withoutBold = removeBalancedTokenPairs(withoutFences, "**");
  if (withoutBold === null) {
    return false;
  }
  const withoutStrong = removeBalancedTokenPairs(withoutBold, "__");
  if (withoutStrong === null) {
    return false;
  }
  if (countUnescapedTokens(withoutStrong, "`") % 2 !== 0) {
    return false;
  }

  return !/(?:\*\*|__|```|`|\[|\(|\{)\s*$/.test(trimmed);
}

function firstStandaloneQuestion(value: string): string | undefined {
  return value.match(/[^.!?\n]{3,220}\?/g)?.[0]?.trim();
}

function removeBalancedTokenPairs(value: string, token: string): string | null {
  if (countUnescapedTokens(value, token) % 2 !== 0) {
    return null;
  }
  return value.split(token).join("");
}

function countUnescapedTokens(value: string, token: string): number {
  let count = 0;
  let cursor = 0;
  while (cursor <= value.length - token.length) {
    const index = value.indexOf(token, cursor);
    if (index < 0) {
      break;
    }
    let slashCount = 0;
    for (let slashIndex = index - 1; slashIndex >= 0 && value[slashIndex] === "\\"; slashIndex -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) {
      count += 1;
    }
    cursor = index + token.length;
  }
  return count;
}
