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
} from "@opaline/ui/v2";
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
        className="construct-knowledge-dialog"
        data-construct-explainable="knowledge-dialog"
        data-construct-explainable-label={concept.title}
      >
        <ShadcnDialogHeader>
          <ShadcnDialogTitle>{concept.title}</ShadcnDialogTitle>
          <ShadcnDialogDescription>{concept.kind} · {concept.tags.join(" · ")}</ShadcnDialogDescription>
        </ShadcnDialogHeader>
        <ShadcnScrollArea className="construct-knowledge-dialog__scroll"><div className="construct-knowledge-dialog__body">
          <Card size="sm"><CardContent>
            <p className="construct-knowledge-dialog__label">Summary</p>
            <MarkdownBlock content={concept.summary} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </CardContent></Card>
          {concept.why ? <Card size="sm"><CardContent>
            <p className="construct-knowledge-dialog__label">Why it matters</p>
            <MarkdownBlock content={concept.why} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </CardContent></Card> : null}
          {concept.commonMistake ? <Card size="sm"><CardContent>
            <p className="construct-knowledge-dialog__label">Common mistake</p>
            <MarkdownBlock content={concept.commonMistake} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </CardContent></Card> : null}
          {concept.guides.map((guide) => <Card size="sm" key={guide.id}><CardContent>
            <p className="construct-knowledge-dialog__label">{guideLabel(guide.guideKind)}</p>
            {guide.content ? <MarkdownBlock content={guide.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} /> : null}
            {guide.sections.map((section) => <MarkdownBlock key={section.kind} content={section.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />)}
          </CardContent></Card>)}
          {concept.example ? <Card size="sm"><CardContent>
            <p className="construct-knowledge-dialog__label">Example</p>
            <MarkdownBlock content={`\`\`\`ts\n${concept.example}\n\`\`\``} theme={theme} onOpenConcept={() => undefined} />
          </CardContent></Card> : null}
          {concept.docs.length > 0 ? <Card size="sm"><CardContent>
            <p className="construct-knowledge-dialog__label">Resources</p>
            <div className="construct-knowledge-dialog__docs">
              {concept.docs.map((doc) => <a href={doc.url} key={doc.url} rel="noreferrer" target="_blank">
                <span><strong>{doc.title}</strong>{doc.why ? <small>{doc.why}</small> : null}</span>
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
