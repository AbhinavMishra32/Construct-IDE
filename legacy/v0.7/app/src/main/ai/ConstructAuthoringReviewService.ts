import { runConstructAuthoringReviewAgent } from "../constructAuthoringReviewAgent";
import { ConstructObservabilityService } from "../observability/ConstructObservabilityService";
import { AgentLogService } from "./AgentLogService";
import { ConstructLoggedAgentService } from "./ConstructLoggedAgentService";

export class ConstructAuthoringReviewService extends ConstructLoggedAgentService {
  constructor(logs: AgentLogService, observability?: ConstructObservabilityService) {
    super("authoring-review", logs, observability);
  }

  async review(input: any): Promise<unknown> {
    return this.traceAgentOperation(
      "construct.authoringReview.review",
      {
        spec: String(input?.spec ?? "tape-0.3"),
        diagnosticCount: Array.isArray(input?.diagnostics) ? input.diagnostics.length : 0,
        snippetCount: Array.isArray(input?.snippets) ? input.snippets.length : 0
      },
      () => this.runReview(input)
    );
  }

  private async runReview(input: any): Promise<unknown> {
    const diagnosticCount = Array.isArray(input?.diagnostics) ? input.diagnostics.length : 0;
    const snippetCount = Array.isArray(input?.snippets) ? input.snippets.length : 0;
    this.log(`Reviewing tape (spec=${input?.spec ?? "tape-0.3"}, ${diagnosticCount} diagnostics, ${snippetCount} snippets)`);
    this.structured("Authoring review request", {
      spec: String(input?.spec ?? "tape-0.3"),
      projectView: input?.projectView ?? {},
      diagnostics: Array.isArray(input?.diagnostics) ? input.diagnostics : [],
      snippets: Array.isArray(input?.snippets) ? input.snippets : []
    });
    console.log("[construct authoring] reviewing compact project view", {
      spec: input?.spec,
      diagnosticCount,
      snippetCount
    });
    try {
      const result = await runConstructAuthoringReviewAgent({
        spec: String(input?.spec ?? "tape-0.3"),
        projectView: input?.projectView ?? {},
        diagnostics: Array.isArray(input?.diagnostics) ? input.diagnostics : [],
        snippets: Array.isArray(input?.snippets) ? input.snippets : []
      }, (entry) => {
        if (entry.payload !== undefined) {
          this.structured(entry.title, entry.payload, entry.level ?? "debug");
          return;
        }
        this.log(`${entry.title}\n${entry.detail}`, entry.level ?? "debug");
      });
      this.log(`Review complete: ${Array.isArray(result) ? result.length : 0} suggestions`);
      this.structured("Authoring review result payload", result);
      return result;
    } catch (error) {
      this.log(`Review failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      throw error;
    }
  }
}
