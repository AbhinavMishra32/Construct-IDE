import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { AgentMessage, AskUserQuestionRequest } from "@construct/domain";
import type { ConstructApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Composer } from "../agent/Composer";
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
  const viewport = useRef<HTMLDivElement>(null);
  /* Whether the learner has scrolled away from the end. Following the
     conversation is right until they scroll up to reread something, at which
     point yanking them back down is the worst thing the panel can do. */
  const [pinned, setPinned] = useState(true);

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

  useEffect(() => {
    if (!pinned) return;
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, step, question, pinned]);

  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || !api || running) return;
    setDraft("");
    setRunning(true);
    setPinned(true);
    void api.sendToAgent({ projectId, body }).catch((cause: unknown) => {
      setRunning(false);
      onError(cause instanceof Error ? cause.message : "The agent could not be reached.");
    });
  }, [api, draft, projectId, running, onError]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="agent-transcript relative min-h-0 min-w-0 flex-1">
        <div
          ref={viewport}
          onScroll={(event) => {
            const element = event.currentTarget;
            /* A small tolerance, because smooth scrolling lands a pixel or two
               short and an exact comparison would unpin on every message. */
            setPinned(element.scrollHeight - element.scrollTop - element.clientHeight < 24);
          }}
          className="app-scroll h-full overflow-x-hidden overflow-y-auto px-4 pb-6 pt-3"
        >
          {messages.length === 0 && !running && (
            <p className="px-1.5 text-ui text-muted-foreground">
              Ask about this project, or say what you want to build next. Construct teaches rather than writing it for you.
            </p>
          )}

          <div className="min-w-0 space-y-3">
            {messages.map((message) =>
              message.role === "learner" ? (
                <div key={message.id} className="flex min-w-0 justify-end">
                  {/* Capped at 85% and right-aligned: what the learner said reads
                      as an aside against the agent's full-width reply, which is
                      the material being studied. */}
                  <div className="min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-[var(--radius-xl)] bg-[var(--app-user-message-background)] px-3 py-2 text-content leading-[1.55]">
                    {message.body}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="min-w-0 px-1.5 text-foreground">
                  <Markdown source={message.body} />
                </div>
              ),
            )}
          </div>

          {question && <QuestionCard api={api} projectId={projectId} request={question} onAnswered={() => setQuestion(null)} />}

          {running && !question && (
            <div className="mt-2 flex items-center gap-2 px-1.5 py-0.5">
              <span className="relative grid size-5 place-items-center">
                <span className="absolute inset-0 rounded-full bg-[var(--accent)]/10 blur-sm" />
                <span className="size-1.5 rounded-full bg-foreground/60" />
              </span>
              {/* The agent's own words for what it is doing, not a generic
                  "thinking": a mentor that says what it is looking at is far
                  easier to wait for. */}
              <span className="thinking-shimmer min-w-0 truncate text-ui font-medium">{step || "Working through it"}</span>
            </div>
          )}
        </div>

        {!pinned && (
          <button
            type="button"
            aria-label="Jump to the latest message"
            onClick={() => setPinned(true)}
            className="app-no-drag absolute bottom-3 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-[var(--app-shadow-overlay)] transition hover:text-foreground"
          >
            <ArrowDown className="size-3.5" />
          </button>
        )}
      </div>

      <div className="px-2 pb-2">
        {/* Spar's composer rather than a bare textarea: it carries the pill
            layout, the send and stop affordances, the focus ring and the
            keyboard handling, all of which a second implementation would get
            subtly different. */}
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          busy={running}
          placeholder={running ? "Construct is working…" : "Ask Construct…"}
        />
      </div>
    </div>
  );
}

/**
 * A question the agent is waiting on.
 *
 * The turn is genuinely blocked here, so this is not dismissible — answering is
 * how the lesson continues. Choices appear when the agent gave any, and free
 * text is always available, because an agent asking a real question should
 * accept an answer it did not anticipate.
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
    <div className="mx-1.5 mt-3 rounded-[var(--radius-xl)] border border-border bg-card/50 p-3">
      <p className="text-ui-sm font-medium text-muted-foreground">{question.header}</p>
      <p className="mt-1 text-content leading-[1.55]">{question.question}</p>

      {question.options.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {question.options.map((option) => (
            <Button key={option.label} variant="outline" size="sm" className="h-7 text-ui" onClick={() => answer(option.label)}>
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {question.custom && (
        <div className="mt-2.5">
          <Composer
            value={value}
            onChange={setValue}
            onSubmit={() => answer(value)}
            placeholder="Answer in your own words…"
          />
        </div>
      )}
    </div>
  );
}

