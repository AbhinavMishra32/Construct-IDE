import { AgentLogService, type AgentLogChannel, type AgentLogLevel } from "./AgentLogService";
import { ConstructObservabilityService, type ConstructAgentTraceMetadata } from "../observability/ConstructObservabilityService";

export abstract class ConstructLoggedAgentService {
  protected constructor(
    protected readonly channel: AgentLogChannel,
    protected readonly logs: AgentLogService,
    protected readonly observability?: ConstructObservabilityService
  ) {}

  protected log(message: string, level: AgentLogLevel = "info"): void {
    this.logs.text(this.channel, message, level);
  }

  protected structured(title: string, payload: unknown, level: AgentLogLevel = "debug"): void {
    this.logs.structured(this.channel, title, payload, level);
  }

  protected traceAgentOperation<T>(
    name: string,
    metadata: ConstructAgentTraceMetadata,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.observability?.traceAgentOperation(name, metadata, operation) ?? operation();
  }
}
