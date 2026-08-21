import { useCallback, useEffect, useState } from "react";
import type { AgentMessage, AskUserQuestionRequest } from "@construct/domain";
import type { ConstructApi, ProviderInventory } from "../../../shared/api";
import { AgentThread } from "../agent/AgentThread";
import { AskUserQuestion } from "../agent/AskUserQuestion";
import { Composer } from "../agent/Composer";
import { ModelPicker } from "../agent/ModelPicker";
import { reduceRun, type AgentRun } from "../agent/agentRun";

type Props = {
  api: ConstructApi | undefined;
  projectId: string;
  onError(message: string): void;
  onOpenSettings(): void;
};

/**
 * The conversation, using Spar's transcript rather than a second one.
 *
 * `AgentThread` and the rows beneath it were written against the stream shape
 * the worker now emits, so this component only keeps the run reduced and hands
 * it over: tool rows, reasoning blocks, per-row spacing, follow behaviour and
 * jump-to-latest all belong to the thread.
 */
export function AgentPanel({ api, projectId, onError, onOpenSettings }: Props) {
  const [providers, setProviders] = useState<ProviderInventory | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [question, setQuestion] = useState<AskUserQuestionRequest | null>(null);
  /* The last turn's failure, kept in the thread rather than only in a toast.
     A message with no reply and a notification that has already faded is
     indistinguishable from the agent ignoring you. */
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    void api.agentMessages({ projectId }).then(setMessages).catch(() => setMessages([]));
  }, [api, projectId]);

  /* Which model is answering, read once and after a turn. The composer shows it
     because it is the single most useful thing to know before sending — and the
     picker is how it changes, so it belongs beside the box rather than buried in
     Settings. */
  const loadProviders = useCallback(() => {
    void api?.listProviders().then(setProviders).catch(() => setProviders(null));
  }, [api]);

  useEffect(loadProviders, [loadProviders]);

  /* The live transcript, reduced here rather than inside the thread so the run
     survives the thread remounting — resizing the panel should not clear the
     turn in flight. */
  useEffect(() => {
    return api?.onAgentStream((event) => {
      if (event.projectId && event.projectId !== projectId) return;
      setRun((current) => reduceRun(current, event));
    });
  }, [api, projectId]);

  useEffect(() => {
    return api?.onAgentEvent((event) => {
      if (event.projectId !== projectId) return;
      switch (event.kind) {
        case "message":
          setMessages((current) => [...current, event.message]);
          break;
        case "question":
          setQuestion(event.request);
          break;
        case "error":
          setFailure(event.message);
          onError(event.message);
          break;
        case "done":
          setRunning(false);
          setQuestion(null);
          break;
      }
    });
  }, [api, projectId, onError]);

  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || !api || running) return;
    setDraft("");
    setRunning(true);
    setRun(null);
    setFailure(null);
    void api.sendToAgent({ projectId, body }).catch((cause: unknown) => {
      setRunning(false);
      onError(cause instanceof Error ? cause.message : "The agent could not be reached.");
    });
  }, [api, draft, projectId, running, onError]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AgentThread
        messages={messages}
        run={running ? run : null}
        footer={
          failure ? (
            <div className="mx-1.5 mt-3 rounded-[var(--radius-lg)] border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-ui-sm font-medium text-destructive">That turn did not finish</p>
              <p className="mt-0.5 text-ui-sm leading-[1.5] text-foreground/80">{failure}</p>
            </div>
          ) : undefined
        }
        empty={
          <p className="px-1.5 text-ui text-muted-foreground">
            Ask about this project, or say what you want to build next. Construct teaches rather than writing it for you.
          </p>
        }
      />

      <div className="px-2 pb-2">
        {question ? (
          /* The composer is replaced rather than sitting disabled beside the
             card: the turn is blocked on this answer, and a second place to type
             only invites answering in the wrong one. */
          <AskUserQuestion
            request={question}
            busy={false}
            onSubmit={(answer) => {
              void api?.answerAgent({ projectId, answer });
              setQuestion(null);
            }}
          />
        ) : (
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            busy={running}
            placeholder={running ? "Construct is working…" : "Ask Construct…"}
            leading={
              <ModelPicker
                inventory={providers}
                onSelect={(provider, model) => {
                  void api
                    ?.setDefaultProvider(provider.id, model)
                    .then(loadProviders)
                    .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : "Could not switch model."));
                }}
                onOpenSettings={onOpenSettings}
              />
            }
          />
        )}
      </div>
    </div>
  );
}
