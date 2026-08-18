import { ArrowLeft, ArrowRight, FileCode, Lightning, Play } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@opaline/ui";
import type { DynamicStep, DynamicStepBlock } from "../../../../shared/constructLearning";
import { normalizeGeneratedMarkdown } from "../../../../shared/generatedLiveSteps";
import type { InlineFileRef } from "../../lib/inlineRefs";
import { MarkdownBlock } from "../MarkdownBlock";

export function LiveStepPanel({
  liveStep,
  theme,
  onOpenConcept,
  onOpenFile,
  onRunCommand,
  onComplete,
  onDismiss,
  onBack
}: {
  liveStep: DynamicStep;
  theme: "light" | "dark" | "system";
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onRunCommand: (command: string, cwd: string) => void;
  onComplete: () => void;
  onDismiss: () => void;
  onBack: () => void;
}) {
  const [blockIndex, setBlockIndex] = useState(0);
  const block = liveStep.blocks[blockIndex];
  const isLastBlock = blockIndex >= liveStep.blocks.length - 1;

  useEffect(() => {
    setBlockIndex(0);
  }, [liveStep.id]);

  return (
    <aside className="flex h-full min-h-0 animate-in flex-col overflow-y-auto bg-background p-3 duration-300 fade-in slide-in-from-right-2" data-construct-explainable="dynamic-step" data-construct-explainable-label="Dynamic Step">
      <div className="mb-3 flex h-8 items-center gap-2 rounded-[8px] border bg-muted/25 px-3 text-xs font-medium text-muted-foreground">
        <Lightning size={15} weight="duotone" />
        <span>Dynamic Step</span>
      </div>
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>Adaptive tape step</span>
        <span>{liveStep.status}</span>
      </div>
      <h2 className="mt-2 text-base font-semibold">{liveStep.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{liveStep.reason}</p>
      <div className="mt-4 border-t pt-3">
        <div className="mb-3 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>{block ? blockLabel(block) : "Empty step"}</span>
          <span>{Math.min(blockIndex + 1, liveStep.blocks.length)} / {liveStep.blocks.length}</span>
        </div>
        {block ? (
          <LiveStepBlock
            block={block}
            theme={theme}
            onOpenConcept={onOpenConcept}
            onOpenFile={onOpenFile}
            onRunCommand={onRunCommand}
          />
        ) : (
          <p className="text-sm text-muted-foreground">This Dynamic Step has no blocks.</p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button type="button" variant="ghost" onClick={onBack}>Back to tape</Button>
        <Button type="button" variant="secondary" onClick={onDismiss}>Dismiss</Button>
        {blockIndex > 0 ? (
          <Button type="button" variant="secondary" onClick={() => setBlockIndex((index) => Math.max(0, index - 1))}>
            <ArrowLeft data-icon="inline-start" />
            Previous
          </Button>
        ) : null}
        {isLastBlock ? (
          <Button type="button" onClick={onComplete}>Complete Dynamic Step</Button>
        ) : (
          <Button type="button" onClick={() => setBlockIndex((index) => Math.min(liveStep.blocks.length - 1, index + 1))}>
            Next
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </div>
    </aside>
  );
}

function LiveStepBlock({
  block,
  theme,
  onOpenConcept,
  onOpenFile,
  onRunCommand
}: {
  block: DynamicStepBlock;
  theme: "light" | "dark" | "system";
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onRunCommand: (command: string, cwd: string) => void;
}) {
  const markdown = (content: string) => (
    <MarkdownBlock
      className="space-y-3 text-sm leading-6 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_li]:my-1 [&_p]:leading-6"
      content={normalizeGeneratedMarkdown(content)}
      theme={theme}
      onOpenConcept={onOpenConcept}
      onOpenFile={onOpenFile}
    />
  );
  const openPath = (path: string, anchor?: string) => onOpenFile({
    kind: "file",
    path,
    anchor,
    label: path,
    raw: `[[file:${path}${anchor ? `#${anchor}` : ""}]]`
  });

  if (block.kind === "explain") {
    return markdown(block.content);
  }
  if (block.kind === "guide") {
    return (
      <div className="space-y-4">
        {block.title ? <h3 className="text-base font-semibold">{block.title}</h3> : null}
        {markdown(block.content)}
        {block.sections?.map((section, index) => (
          <section className="rounded-[8px] border bg-muted/20 p-3" key={`${section.kind}-${index}`}>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{section.kind}</p>
            {markdown(section.content)}
          </section>
        ))}
      </div>
    );
  }
  if (block.kind === "interact") {
    return (
      <div className="space-y-3">
        {markdown(block.prompt)}
        <div className="rounded-[8px] border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
          <p className="font-medium text-foreground">What this checks</p>
          {markdown(block.understanding)}
        </div>
      </div>
    );
  }
  if (block.kind === "edit") {
    return (
      <div className="space-y-3">
        <Button type="button" variant="secondary" onClick={() => openPath(block.path, block.anchor)}>
          <FileCode data-icon="inline-start" />
          Open {block.path}
        </Button>
        {block.notes?.filter((note) => note.when === "start").map((note, index) => (
          <div className="rounded-[8px] border bg-muted/20 p-3" key={index}>{markdown(note.content)}</div>
        ))}
        <pre className="max-h-80 overflow-auto rounded-[8px] border bg-muted/30 p-3 text-xs leading-5"><code>{block.content}</code></pre>
      </div>
    );
  }
  if (block.kind === "recall") {
    const path = block.path;
    return (
      <div className="space-y-3">
        {markdown(block.task)}
        {path ? (
          <Button type="button" variant="secondary" onClick={() => openPath(path)}>
            <FileCode data-icon="inline-start" />
            Open {path}
          </Button>
        ) : null}
        {block.support ? <div className="rounded-[8px] border bg-muted/20 p-3">{markdown(block.support)}</div> : null}
      </div>
    );
  }
  if (block.kind === "run") {
    return (
      <div className="space-y-3">
        <pre className="overflow-auto rounded-[8px] border bg-muted/30 p-3 text-xs"><code>{block.command}</code></pre>
        <Button type="button" onClick={() => onRunCommand(block.command, block.cwd ?? ".")}>
          <Play data-icon="inline-start" />
          Run command
        </Button>
      </div>
    );
  }
  return markdown(block.content);
}

function blockLabel(block: DynamicStepBlock): string {
  switch (block.kind) {
    case "explain": return "Explain";
    case "guide": return block.guideKind || "Guide";
    case "interact": return "Interact";
    case "edit": return `${block.mode} file`;
    case "recall": return block.mode === "code" ? "Code recall" : "Reply recall";
    case "run": return "Run";
    case "expect": return "Expectation";
    case "checkpoint": return "Checkpoint";
  }
}
