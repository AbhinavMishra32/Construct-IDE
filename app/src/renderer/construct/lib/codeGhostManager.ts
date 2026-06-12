import { monaco } from "../../monaco";
import { startCodeGhostStream, onCodeGhostToken } from "./bridge";

let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null;
let widget: GhostWidget | null = null;
let currentLine = 0;
let currentRequestId = "";
let requestCounter = 0;
let disposeTokenListener: (() => void) | null = null;
let editorDisposables: monaco.IDisposable[] = [];
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let accumulatedText = "";

class GhostWidget implements monaco.editor.IContentWidget {
  domNode: HTMLDivElement;
  private lineNumber: number;
  private visible = false;

  constructor(lineNumber: number) {
    this.lineNumber = lineNumber;
    this.domNode = document.createElement("div");
    this.domNode.className = "code-ghost-widget";
    this.hide();
  }

  getId() { return "code-ghost-widget"; }
  getDomNode() { return this.domNode; }

  getPosition() {
    const model = activeEditor?.getModel();
    if (!model) return null;
    return {
      position: { lineNumber: this.lineNumber, column: model.getLineMaxColumn(this.lineNumber) },
      preference: [monaco.editor.ContentWidgetPositionPreference.EXACT]
    };
  }

  show() {
    if (!this.visible) {
      this.visible = true;
      this.domNode.style.display = "inline-block";
    }
    activeEditor?.layoutContentWidget(this);
  }

  hide() {
    this.visible = false;
    this.domNode.style.display = "none";
  }

  render(text: string) {
    this.domNode.textContent = text;
    this.show();
  }

  renderError(text: string) {
    this.domNode.dataset.state = "error";
    this.render(text);
  }

  setLine(line: number) {
    this.lineNumber = line;
    activeEditor?.layoutContentWidget(this);
  }

  dispose() {
    if (activeEditor) activeEditor.removeContentWidget(this);
    this.domNode.remove();
  }
}

export function initializeCodeGhost(editor: monaco.editor.IStandaloneCodeEditor) {
  activeEditor = editor;
  cleanup();

  if (!document.getElementById("code-ghost-styles")) {
    const style = document.createElement("style");
    style.id = "code-ghost-styles";
    style.textContent = `
      .code-ghost-widget {
        background: color-mix(in srgb, var(--opaline-bg-elevated, #ffffff) 94%, transparent);
        border: 1px solid var(--opaline-border-subtle, #d0d0d0);
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 11px;
        line-height: 1.45;
        color: var(--opaline-text-secondary, #3d3d3d);
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.10);
        max-width: 360px;
        width: max-content;
        margin-left: 18px;
        pointer-events: none;
        user-select: none;
        white-space: normal;
        word-break: break-word;
        overflow: hidden;
        z-index: 100;
        backdrop-filter: blur(14px);
      }

      .code-ghost-widget[data-state="error"] {
        color: var(--opaline-text-tertiary, #757575);
      }
    `;
    document.head.appendChild(style);
  }

  disposeTokenListener = onCodeGhostToken((payload) => {
    const { requestId, token, done, error } = payload;
    if (requestId !== currentRequestId) return;
    if (error) {
      console.warn("[code ghost] err:", error);
      if (widget) {
        widget.renderError("Inline help unavailable. Check AI settings.");
      }
      return;
    }

    if (token) {
      accumulatedText += token;
      const nextText = accumulatedText.trim();
      if (widget && nextText.length > 0) {
        widget.domNode.dataset.state = "ready";
        widget.render(nextText);
      }
    }

    if (done) {
      const finalText = accumulatedText.trim();
      if (widget && finalText.length > 0) {
        widget.domNode.dataset.state = "ready";
        widget.render(finalText);
      } else if (widget) {
        widget.renderError("Inline help unavailable. Check AI settings.");
      }
    }
  });

  editorDisposables.push(
    editor.onDidChangeModelContent(() => {
      if (scheduleTimer) clearTimeout(scheduleTimer);
      scheduleTimer = setTimeout(() => {
        if (!activeEditor) return;
        const pos = activeEditor.getPosition();
        if (pos) fetchExplanation(pos.lineNumber);
      }, 400);
    })
  );

  editorDisposables.push(
    editor.onDidChangeCursorPosition((e) => {
      if (e.position.lineNumber !== currentLine) {
        currentLine = e.position.lineNumber;
        if (widget) widget.setLine(currentLine);
      }
    })
  );

  editorDisposables.push(
    editor.onDidChangeModel(() => {
      hideWidget();
      currentLine = 0;
    })
  );

  setTimeout(() => {
    const pos = editor.getPosition();
    if (pos) fetchExplanation(pos.lineNumber);
  }, 800);
}

function fetchExplanation(lineNumber: number) {
  const editor = activeEditor;
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;

  const lineContent = model.getLineContent(lineNumber);
  if (!lineContent.trim()) { hideWidget(); return; }

  currentLine = lineNumber;
  currentRequestId = `ghost-${++requestCounter}`;
  accumulatedText = "";

  if (!widget) {
    widget = new GhostWidget(lineNumber);
    widget.domNode.dataset.state = "loading";
    editor.addContentWidget(widget);
  } else {
    widget.setLine(lineNumber);
    widget.domNode.dataset.state = "loading";
    widget.hide();
  }

  const linesBefore: string[] = [];
  const linesAfter: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const above = model.getLineContent(lineNumber - i);
    if (above) linesBefore.unshift(above);
    const below = model.getLineContent(lineNumber + i);
    if (below) linesAfter.push(below);
  }

  startCodeGhostStream({
    requestId: currentRequestId,
    lineNumber,
    lineContent,
    language: model.getLanguageId(),
    linesBefore,
    linesAfter
  });
}

function hideWidget() {
  if (widget) { widget.dispose(); widget = null; }
  accumulatedText = "";
}

function cleanup() {
  if (disposeTokenListener) { disposeTokenListener(); disposeTokenListener = null; }
  for (const d of editorDisposables) d.dispose();
  editorDisposables = [];
  if (scheduleTimer) { clearTimeout(scheduleTimer); scheduleTimer = null; }
}

export function disposeCodeGhost() {
  cleanup();
  hideWidget();
  activeEditor = null;
}
