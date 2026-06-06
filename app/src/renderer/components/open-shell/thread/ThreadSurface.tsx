import { CodexMark } from "../icons/CodexMark";
import { Pill } from "../primitives/Button";
import "./thread-surface.css";

export type ThreadMessage = {
  body: string;
  role: "assistant" | "user";
  status?: string;
};

export function ThreadSurface({ messages, title }: { messages: ThreadMessage[]; title: string }) {
  return (
    <div className="codex-thread">
      <header className="codex-thread-header">
        <div>
          <h1>{title}</h1>
          <span>Component-system reconstruction</span>
        </div>
        <div className="codex-thread-header-pills">
          <Pill>non-agent</Pill>
          <Pill>library</Pill>
        </div>
      </header>

      <section className="codex-thread-brief">
        <div className="codex-thread-brief-icon">
          <CodexMark className="codex-thread-brief-logo" />
        </div>
        <div>
          <strong>Codex UI copy app</strong>
          <p>
            Static Electron shell using stripped shared UI primitives. Literal upstream assets stay in
            `src/component-library`; readable components live in `src/lib/codex-ui`.
          </p>
        </div>
      </section>

      <div className="codex-thread-messages">
        {messages.map((message, index) => (
          <article className="codex-message" data-role={message.role} key={`${message.role}-${index}`}>
            {message.role === "assistant" ? (
              <>
                <div className="codex-message-activity">
                  <CodexMark className="codex-message-logo" />
                  <span>{message.status ?? "Looked at Electron"}</span>
                </div>
                <div className="codex-message-copy">{renderBody(message.body)}</div>
              </>
            ) : (
              <div className="codex-message-user-bubble">{renderBody(message.body)}</div>
            )}
          </article>
        ))}
      </div>

      <section className="codex-run-card">
        <div className="codex-run-card-header">
          <div>
            <span className="codex-run-card-icon">
              <EditedFilesIcon />
            </span>
            <div>
              <strong>Edited 2 files</strong>
              <span>
                <span className="codex-diff-added">+162</span>
                <span className="codex-diff-removed"> -31</span>
              </span>
            </div>
          </div>
          <div className="codex-run-card-actions">
            <button type="button">Undo <UndoIcon /></button>
            <button type="button">Review</button>
          </div>
        </div>
        <div className="codex-run-rows">
          <span>packages/ui/src/app-shell/AppShell.tsx</span>
          <span>
            <span className="codex-diff-added">+50</span>
            <span className="codex-diff-removed"> -26</span>
          </span>
          <span>packages/ui/src/app-shell/app-shell.css</span>
          <span>
            <span className="codex-diff-added">+112</span>
            <span className="codex-diff-removed"> -5</span>
          </span>
        </div>
      </section>
    </div>
  );
}

function renderBody(body: string) {
  return body.split("\n").map((line, index) => (
    <p key={`${line}-${index}`}>
      {line}
    </p>
  ));
}

function EditedFilesIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4.5" y="3.5" width="11" height="13" rx="2" />
      <path d="M7.25 8.25h5.5" />
      <path d="M7.25 11.75h5.5" />
      <path d="M10 6.25v4" />
      <path d="M8 8.25h4" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 6.5H4.25V3.75" />
      <path d="M4.5 6.25A6.5 6.5 0 1 1 5.75 14" />
    </svg>
  );
}
