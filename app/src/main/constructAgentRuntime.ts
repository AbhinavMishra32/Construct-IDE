import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import type { z } from "zod";

import { resolveConstructAgentModel } from "./constructAgentModels";
import type { ConstructAiFeatureId } from "./constructAiFeatures";

export type ConstructAgentRuntimeRequest<T> = {
  id: string;
  featureId?: ConstructAiFeatureId;
  name: string;
  purpose: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxRetries?: number;
};

export type ConstructAgentRuntime = {
  generateStructured<T>(request: ConstructAgentRuntimeRequest<T>): Promise<T>;
};

export function createConstructAgentRuntime(): ConstructAgentRuntime {
  const runtime = (process.env.CONSTRUCT_AGENT_RUNTIME ?? "mastra").trim().toLowerCase();

  switch (runtime) {
    case "mastra":
      return new MastraConstructAgentRuntime();
    default:
      throw new Error(`Unsupported CONSTRUCT_AGENT_RUNTIME "${runtime}". Available runtime: mastra.`);
  }
}

class MastraConstructAgentRuntime implements ConstructAgentRuntime {
  async generateStructured<T>(request: ConstructAgentRuntimeRequest<T>): Promise<T> {
    const agent = new Agent({
      id: request.id,
      name: request.name,
      instructions: request.instructions,
      model: resolveConstructAgentModel(request.purpose, request.featureId),
      maxRetries: request.maxRetries ?? 1
    });

    new Mastra({ agents: { [request.id]: agent }, logger: false });
    const output = await agent.generate(request.prompt, {
      structuredOutput: { schema: request.schema }
    });

    return request.schema.parse(output.object);
  }
}
