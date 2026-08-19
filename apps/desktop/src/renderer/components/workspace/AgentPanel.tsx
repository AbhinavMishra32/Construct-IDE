import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import type { AgentMessage, AskUserQuestionRequest } from "@construct/domain";
import type { ConstructApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "../agent/Markdown";

type Props = {
  api: ConstructApi | undefined;
  projectId: string;
  onError(message: string): void;
};

export function AgentPanel({ api, projectId, onError }: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [question, setQuestion] = useState<AskUserQuestionRequest | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!api) return;
    void api.agentMessages({ projectId }).then(setMessages).catch(() => setMessages([]));
  }, [api, projectId]);

  useEffect(() => {
    return api?.onAgentEvent((event) => {
      if (event.projectId !== projectId) return;
      switch (event.kind) {
        case "message":
          setMessages((current) => [...current, event.message]);
          break;
        case "step":
          setStep(event.text);
          break;
        case "question":
          setQuestion(event.request);
          break;
        case "error":
          onError(event.message);
          break;
        case "done":
          setRunning(false);
          setStep(null);
          setQuestion(null);
          break;
      }
    });
  }, [api, projectId, onError]);

  /* Follows the conversation as it grows. Scrolling on every token would fight
     a learner who has scrolled up to reread something, so this runs only when
     a whole message or a new step arrives. */
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, step, question]);

  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || !api || running) return;
    setDraft("");
    setRunning(true);
    void api.sendToAgent({ projectId, body }).catch((cause: unknown) => {
      setRunning(false);
      onError(cause instanceof Error ? cause.message : "The agent could not be reached.");
    });
  }, [api, draft, projectId, running, onError]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !running && (
          <p className="px-1 text-ui text-muted-foreground">
            Ask about this project, or say what you want to build next. Construct teaches rather than writes it for you.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {messages.map((message) => (
            <li
              key={message.id}
              className={cn(
                "text-content",
                message.role === "learner"
                  ? "self-end rounded-xl bg-[var(--app-user-message-background)] px-3 py-2"
                  : "text-foreground",
              )}
            >
              {message.role === "learner" ? message.body : <Markdown source={message.body} />}
            </li>
          ))}
        </ul>

        {question && <QuestionCard api={api} projectId={projectId} request={question} onAnswered={() => setQuestion(null)} />}

        {running && !question && (
          <p className="mt-3 flex items-center gap-1.5 px-1 text-ui text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {/* The agent's own words for what it is doing, not a generic
                "thinking": a mentor that says what it is looking at is far
                easier to wait for. */}
            <span className="truncate">{step || "Working…"}</span>
          </p>
        )}

        <div ref={bottom} />
      </div>

      <div className="hairline-t p-2">
        <div className="relative">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              /* Enter sends, Shift+Enter breaks the line — the convention
                 everywhere a message is composed. */
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={running ? "Construct is working…" : "Ask Construct…"}
            className="resize-none pr-9 text-content"
            disabled={running}
          />
          <Button
            size="icon"
            className="absolute bottom-1.5 right-1.5 size-6"
            aria-label="Send"
            disabled={!draft.trim() || running}
            onClick={send}
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A question the agent is waiting on.
 *
 * The turn is genuinely blocked here, so this is not dismissible — answering is
 * how the lesson continues. Choices are offered when the agent gave any, and
 * free text is always available, because an agent that asks a real question
 * should accept an answer it did not anticipate.
 */
function QuestionCard({
  api,
  projectId,
  request,
  onAnswered,
}: {
  api: ConstructApi | undefined;
  projectId: string;
  request: AskUserQuestionRequest;
  onAnswered(): void;
}) {
  const [value, setValue] = useState("");
  const question = request.questions[0];
  if (!question) return null;

  const answer = (text: string) => {
    if (!text.trim()) return;
    void api?.answerAgent({ projectId, answer: text.trim() });
    onAnswered();
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-card/60 p-3">
      <p className="text-ui-sm font-medium text-muted-foreground">{question.header}</p>
      <p className="mt-1 text-content">{question.question}</p>

      {question.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {question.options.map((option) => (
            <Button key={option.label} variant="outline" size="sm" onClick={() => answer(option.label)}>
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {question.custom && (
        <div className="mt-2 flex gap-1.5">
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                answer(value);
              }
            }}
            rows={1}
            placeholder="Answer in your own words…"
            className="resize-none text-content"
          />
          <Button size="sm" disabled={!value.trim()} onClick={() => answer(value)}>
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
