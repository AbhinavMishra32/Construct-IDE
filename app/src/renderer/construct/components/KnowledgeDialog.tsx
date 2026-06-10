import { BookmarkCheckIcon, BookmarkIcon, ExternalLinkIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogSection
} from "@opaline/ui";
import type { ConceptCard } from "../types";
import { MarkdownBlock } from "./MarkdownBlock";

export function KnowledgeDialog({
  concept,
  open,
  saved,
  theme,
  onOpenChange,
  onSaveChange
}: {
  concept: ConceptCard | null;
  open: boolean;
  saved: boolean;
  theme: "light" | "dark" | "system";
  onOpenChange: (open: boolean) => void;
  onSaveChange: (saved: boolean) => void;
}) {
  if (!concept) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="wide"
        contentClassName="construct-knowledge-dialog"
        data-construct-explainable="knowledge-dialog"
        data-construct-explainable-label={concept.title}
        style={{ height: "min(720px, calc(100vh - 48px))" }}
      >
        <DialogHeader title={concept.title} subtitle={`${concept.kind} · ${concept.tags.join(" · ")}`} />
        <DialogBody className="construct-knowledge-dialog__body">
          <DialogSection>
            <p className="construct-knowledge-dialog__label">Summary</p>
            <MarkdownBlock content={concept.summary} theme={theme} onOpenConcept={() => undefined} />
          </DialogSection>
          {concept.why ? <DialogSection>
            <p className="construct-knowledge-dialog__label">Why it matters</p>
            <MarkdownBlock content={concept.why} theme={theme} onOpenConcept={() => undefined} />
          </DialogSection> : null}
          {concept.commonMistake ? <DialogSection>
            <p className="construct-knowledge-dialog__label">Common mistake</p>
            <MarkdownBlock content={concept.commonMistake} theme={theme} onOpenConcept={() => undefined} />
          </DialogSection> : null}
          {concept.example ? <DialogSection>
            <p className="construct-knowledge-dialog__label">Example</p>
            <MarkdownBlock content={`\`\`\`ts\n${concept.example}\n\`\`\``} theme={theme} onOpenConcept={() => undefined} />
          </DialogSection> : null}
          {concept.docs.length > 0 ? <DialogSection>
            <p className="construct-knowledge-dialog__label">Resources</p>
            <div className="construct-knowledge-dialog__docs">
              {concept.docs.map((doc) => <a href={doc.url} key={doc.url} rel="noreferrer" target="_blank">
                <span><strong>{doc.title}</strong>{doc.why ? <small>{doc.why}</small> : null}</span>
                <ExternalLinkIcon />
              </a>)}
            </div>
          </DialogSection> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant={saved ? "secondary" : "primary"} onClick={() => onSaveChange(!saved)}>
            {saved ? <BookmarkCheckIcon /> : <BookmarkIcon />}
            {saved ? "Saved" : "Save to knowledge base"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
