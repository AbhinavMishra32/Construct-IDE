import { BookmarkCheckIcon, BookmarkIcon, ExternalLinkIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  ShadcnDialog,
  ShadcnDialogContent,
  ShadcnDialogDescription,
  ShadcnDialogFooter,
  ShadcnDialogHeader,
  ShadcnDialogTitle,
  ShadcnScrollArea
} from "@opaline/ui";
import type { ConceptCard } from "../types";
import type { InlineFileRef } from "../lib/inlineRefs";
import { MarkdownBlock } from "./MarkdownBlock";

export function KnowledgeDialog({
  concept,
  open,
  saved,
  theme,
  onOpenChange,
  onOpenConcept,
  onOpenFile,
  onSaveChange
}: {
  concept: ConceptCard | null;
  open: boolean;
  saved: boolean;
  theme: "light" | "dark" | "system";
  onOpenChange: (open: boolean) => void;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onSaveChange: (saved: boolean) => void;
}) {
  if (!concept) return null;
  return (
    <ShadcnDialog open={open} onOpenChange={onOpenChange}>
      <ShadcnDialogContent
        className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden rounded-[10px]"
        data-construct-explainable="knowledge-dialog"
        data-construct-explainable-label={concept.title}
      >
        <ShadcnDialogHeader>
          <ShadcnDialogTitle>{concept.title}</ShadcnDialogTitle>
          <ShadcnDialogDescription>{concept.kind} · {concept.tags.join(" · ")}</ShadcnDialogDescription>
        </ShadcnDialogHeader>
        <ShadcnScrollArea className="min-h-0 flex-1"><div className="space-y-3 pr-3">
          <Card className="bg-card/70 shadow-none" size="sm"><CardContent>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Summary</p>
            <MarkdownBlock content={concept.summary} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </CardContent></Card>
          {concept.why ? <Card className="bg-card/70 shadow-none" size="sm"><CardContent>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Why it matters</p>
            <MarkdownBlock content={concept.why} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </CardContent></Card> : null}
          {concept.commonMistake ? <Card className="bg-card/70 shadow-none" size="sm"><CardContent>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Common mistake</p>
            <MarkdownBlock content={concept.commonMistake} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </CardContent></Card> : null}
          {concept.guides.map((guide) => <Card className="bg-card/70 shadow-none" size="sm" key={guide.id}><CardContent>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{guideLabel(guide.guideKind)}</p>
            {guide.content ? <MarkdownBlock content={guide.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} /> : null}
            {guide.sections.map((section) => <MarkdownBlock key={section.kind} content={section.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />)}
          </CardContent></Card>)}
          {concept.example ? <Card className="bg-card/70 shadow-none" size="sm"><CardContent>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Example</p>
            <MarkdownBlock content={`\`\`\`ts\n${concept.example}\n\`\`\``} theme={theme} onOpenConcept={() => undefined} />
          </CardContent></Card> : null}
          {concept.docs.length > 0 ? <Card className="bg-card/70 shadow-none" size="sm"><CardContent>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Resources</p>
            <div className="space-y-1">
              {concept.docs.map((doc) => <a className="flex items-center justify-between gap-3 rounded-[7px] px-2 py-1.5 text-xs hover:bg-muted" href={doc.url} key={doc.url} rel="noreferrer" target="_blank">
                <span className="min-w-0"><strong className="block truncate font-medium">{doc.title}</strong>{doc.why ? <small className="block truncate text-muted-foreground">{doc.why}</small> : null}</span>
                <ExternalLinkIcon />
              </a>)}
            </div>
          </CardContent></Card> : null}
        </div></ShadcnScrollArea>
        <ShadcnDialogFooter>
          <Button variant={saved ? "secondary" : "primary"} onClick={() => onSaveChange(!saved)}>
            {saved ? <BookmarkCheckIcon /> : <BookmarkIcon />}
            {saved ? "Saved" : "Save to knowledge base"}
          </Button>
        </ShadcnDialogFooter>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
}

function guideLabel(kind: string): string {
  return kind.replace(/^guide\./, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
