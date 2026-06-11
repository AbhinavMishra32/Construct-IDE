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
        background: var(--opaline-bg-primary, #1e1e1e);
        border: 1px solid var(--opaline-border-subtle, #454545);
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--opaline-text-primary, #ddd);
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        max-width: 440px;
        width: max-content;
        margin-left: 32px;
        pointer-events: none;
        user-select: none;
        white-space: normal;
        word-wrap: break-word;
        overflow: hidden;
        z-index: 100;
      }
    `;
    document.head.appendChild(style);
  }

  disposeTokenListener = onCodeGhostToken((payload) => {
    const { requestId, token, done, error } = payload;
    if (requestId !== currentRequestId) return;
    if (error) { console.warn("[code ghost] err:", error); return; }

    if (token) {
      accumulatedText += token;
      if (widget) widget.render(accumulatedText);
    }

    if (done) {
      if (widget && accumulatedText) {
        widget.render(accumulatedText);
      } else if (!accumulatedText) {
        hideWidget();
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
    editor.addContentWidget(widget);
  } else {
    widget.setLine(lineNumber);
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
