import type { AgentMessage } from "@construct/domain";

/** Combines a database snapshot with events that may have arrived after that
 * snapshot began. An id is a message's identity; a later copy wins so this also
 * supports durable in-place checkpoints without duplicate transcript rows. */
export function mergeMessages(base: AgentMessage[], incoming: AgentMessage[]): AgentMessage[] {
  const byId = new Map(base.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
