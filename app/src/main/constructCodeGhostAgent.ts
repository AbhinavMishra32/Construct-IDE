import { BrowserWindow } from "electron";
import { resolveConstructAiSettings } from "./constructAiSettings";
import { modelForAiFeature } from "./constructAiFeatures";

export type CodeGhostStreamInput = {
  lineContent: string;
  language: string;
  linesBefore: string[];
  linesAfter: string[];
};

export type CodeGhostTraceEntry = {
  title: string;
  detail: string;
  level?: "info" | "warn" | "error" | "debug";
};

function buildModelConfig() {
  const settings = resolveConstructAiSettings();
  const apiKey = settings.provider === "openrouter"
    ? settings.openRouterApiKey
    : settings.openAiApiKey;

  if (!apiKey) {
    throw new Error(`${settings.provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key is required`);
  }

  return {
    modelId: settings.provider === "openrouter"
      ? modelForAiFeature(settings, "code-explain")
      : modelForAiFeature(settings, "code-explain"),
    apiKey,
    baseUrl: settings.provider === "openrouter"
      ? (process.env.CONSTRUCT_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1")
      : ((process.env.CONSTRUCT_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""))
  };
}

function buildMessages(input: CodeGhostStreamInput) {
  const beforeLines = input.linesBefore.length > 0
    ? input.linesBefore.map((l) => `  ${l}`).join("\n")
    : "  (no preceding lines)";

  const afterLines = input.linesAfter.length > 0
    ? input.linesAfter.map((l) => `  ${l}`).join("\n")
    : "  (no following lines)";

  const context = [
    `Language: ${input.language}`,
    "",
    "Context:",
    beforeLines,
    `> ${input.lineContent}`,
    afterLines,
  ].join("\n");

  return [
    {
      role: "system",
      content: [
        "You explain code in plain, beginner-friendly language.",
        "Given a line of code with surrounding context, explain what it does.",
        "Keep explanations to 1-2 sentences. Be concise and accurate.",
        "Start your answer directly with the explanation, no preamble."
      ].join("\n")
    },
    {
      role: "user",
      content: `${context}\n\nExplain this line of code concisely (1-2 sentences):`
    }
  ];
}

export async function fetchCodeGhostExplanation(
  input: CodeGhostStreamInput,
  signal?: AbortSignal
): Promise<string> {
  const config = buildModelConfig();
  console.log("[code ghost] fetching from", config.baseUrl, "model:", config.modelId);

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: buildMessages(input),
      stream: true,
      max_tokens: 120,
      temperature: 0.3
    }),
    signal
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[code ghost] API error", response.status, body.slice(0, 200));
    throw new Error(`API error (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Failed to get response stream reader");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;

      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          text += content;
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  console.log("[code ghost] got response length:", text.length);
  return text.trim();
}

export async function sendCodeGhostStreamToRenderer(
  sender: BrowserWindow["webContents"],
  input: CodeGhostStreamInput,
  channel: string,
  requestId: string,
  lineNumber: number,
  onTrace?: (entry: CodeGhostTraceEntry) => void
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    onTrace?.({
      title: "Code ghost request",
      level: "debug",
      detail: JSON.stringify({
        requestId,
        lineNumber,
        input
      }, null, 2)
    });

    const text = await fetchCodeGhostExplanation(input, controller.signal);
    clearTimeout(timeout);
    onTrace?.({
      title: "Code ghost response",
      level: "debug",
      detail: JSON.stringify({ requestId, lineNumber, text }, null, 2)
    });

    if (text) {
      // Send word by word for live feel
      const words = text.split(/(?<=\s)/);
      for (const word of words) {
        if (sender.isDestroyed()) return;
        sender.send(channel, { requestId, lineNumber, token: word, done: false });
        await new Promise(r => setTimeout(r, 15));
      }
    }

    if (!sender.isDestroyed()) {
      sender.send(channel, { requestId, lineNumber, token: "", done: true });
    }
  } catch (error) {
    console.error("[code ghost] request failed:", error);
    onTrace?.({
      title: "Code ghost error",
      level: "error",
      detail: error instanceof Error ? error.stack || error.message : String(error)
    });
    if (!sender.isDestroyed()) {
      sender.send(channel, {
        requestId, lineNumber, token: "", done: true,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
