import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { ConstructAgentRuntime } from "../constructAgentRuntime";
import type { ConstructLearningStore } from "../constructLearningStore";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import type { StoredSettings } from "../config/constructConfig";
import {
  type ConstructConceptArtifactAudit,
  type ConstructConceptMasteryLevel,
  type ConstructConceptProjectEventKind,
  type KnowledgeBaseRecord
} from "../../shared/constructLearning";

export const CONSTRUCT_CONCEPT_ARTIFACT_KINDS = [
  "teaching",
  "task",
  "assessment",
  "file-write",
  "file-edit",
  "scaffold",
  "next-step"
] as const;

export type ConstructConceptArtifactKind = typeof CONSTRUCT_CONCEPT_ARTIFACT_KINDS[number];

export type ConstructConceptPolicyInput = {
  project: StoredFlowProject;
  artifactKind: ConstructConceptArtifactKind;
  artifactRef?: string;
  content: string;
  declaredConceptIds?: string[];
  requireTaskReady?: boolean;
  semanticAudit?: boolean;
};

export type ConstructConceptPolicyDecision = {
  allowed: boolean;
  declaredConceptIds: string[];
  matchedConceptIds: string[];
  blockedCapabilities: string[];
  reason: string;
  auditId: string;
};

export type ConstructConceptPolicyMemorySnapshot = {
  file: string;
  content: string;
};

const capabilityAuditSchema = z.object({
  capabilities: z.array(z.object({
    name: z.string().min(1).max(160),
    evidence: z.string().min(1).max(500),
    matchedConceptIds: z.array(z.string().min(1)).max(12),
    matchedPriorEvidenceIds: z.array(z.string().min(1)).max(12).optional().transform((value) => value ?? [])
  })).max(40),
  uncoveredCapabilities: z.array(z.object({
    name: z.string().min(1).max(160),
    evidence: z.string().min(1).max(500),
    reason: z.string().min(1).max(700)
  })).max(30),
  summary: z.string().min(1).max(1_000)
}).strict();

type CapabilityAudit = z.infer<typeof capabilityAuditSchema>;

type RawCapabilityAudit = {
  summary: string;
  capabilities: Array<{
    name: string;
    evidence: string;
    matchedConceptIds: string[];
    matchedPriorEvidenceIds?: string[];
  }>;
  uncoveredCapabilities: Array<{
    name: string;
    evidence: string;
    reason: string;
  }>;
};

type DetectedCapability = {
  name: string;
  aliases: string[];
  evidence: string;
};

type LearnerPriorEvidence = {
  id: string;
  sourceFile: string;
  label: string;
  text: string;
  coverage: "known" | "weak";
};

export class ConstructConceptPolicyService {
  constructor(private readonly options: {
    learningStore: () => ConstructLearningStore;
    agentRuntime?: () => ConstructAgentRuntime;
    readSettings?: () => Promise<StoredSettings>;
    readProjectMemory?: (project: StoredFlowProject) => Promise<ConstructConceptPolicyMemorySnapshot[]>;
  }) {}

  async authorize(input: ConstructConceptPolicyInput): Promise<ConstructConceptPolicyDecision> {
    const declaredConceptIds = uniqueConceptIds(input.declaredConceptIds ?? []);
    if (this.options.readSettings) {
      const settings = await this.options.readSettings();
      if (settings?.ai.conceptFirewallEnabled === false) {
        return {
          allowed: true,
          declaredConceptIds,
          matchedConceptIds: declaredConceptIds,
          blockedCapabilities: [],
          reason: "Concept firewall is disabled in settings.",
          auditId: ""
        };
      }
    }
    const store = this.options.learningStore();
    const projectConcepts = await store.getProjectConceptRecords(input.project.id);
    const projectState = await store.getProjectLearnerState(input.project.id);
    const learnerPriorEvidence = await this.readLearnerPriorEvidence(input.project);
    const knownPriorEvidence = learnerPriorEvidence.filter((entry) => entry.coverage === "known");
    const weakPriorEvidence = learnerPriorEvidence.filter((entry) => entry.coverage === "weak");
    const relations = projectState.conceptRelations ?? {};
    const missingRelations = declaredConceptIds.filter((conceptId) => !relations[conceptId]?.introducedAt);
    const minimumMastery = input.requireTaskReady || input.artifactKind === "task" ? 3 : 0;
    const belowMastery = declaredConceptIds.filter((conceptId) => (
      (relations[conceptId]?.masteryLevel ?? 0) < minimumMastery
    ));
    const requiresDeclaredConcept = [
      "task",
      "assessment",
      "file-write",
      "file-edit",
      "scaffold"
    ].includes(input.artifactKind);

    if (requiresDeclaredConcept && declaredConceptIds.length === 0) {
      return this.block(input, [], [], ["No project concepts were declared."], "This artifact must declare the project concepts that make every part understandable.");
    }
    if (missingRelations.length > 0) {
      return this.block(
        input,
        declaredConceptIds,
        [],
        missingRelations.map((conceptId) => `Concept ${conceptId} has not been taught in this project.`),
        `Concepts from another project or the global library do not count here: ${missingRelations.join(", ")}.`
      );
    }
    if (belowMastery.length > 0) {
      return this.block(
        input,
        declaredConceptIds,
        [],
        belowMastery.map((conceptId) => `${conceptId} is below Mastery Level ${minimumMastery}.`),
        `This artifact requires project-local Mastery Level ${minimumMastery}: ${belowMastery.join(", ")}.`
      );
    }

    const allowedConcepts = input.artifactKind === "next-step"
      ? projectConcepts
      : projectConcepts.filter((concept) => declaredConceptIds.includes(concept.id));
    const deterministic = detectCapabilities(input.content);
    const deterministicBlocked = deterministic.filter((capability) => (
      !allowedConcepts.some((concept) => conceptCoversCapability(concept, capability))
      && !learnerPriorCoversCapability(knownPriorEvidence, weakPriorEvidence, capability)
    ));

    let semanticAudit: CapabilityAudit = {
      capabilities: deterministic
        .filter((capability) => !deterministicBlocked.includes(capability))
        .map((capability) => ({
          name: capability.name,
          evidence: capability.evidence,
          matchedConceptIds: allowedConcepts
            .filter((concept) => conceptCoversCapability(concept, capability))
            .map((concept) => concept.id),
          matchedPriorEvidenceIds: learnerPriorEvidenceIdsForCapability(knownPriorEvidence, weakPriorEvidence, capability)
        })),
      uncoveredCapabilities: deterministicBlocked.map((capability) => ({
        name: capability.name,
        evidence: capability.evidence,
        reason: "No declared project concept body or project-local learner prior evidence covers this construct."
      })),
      summary: deterministicBlocked.length
        ? "Deterministic syntax audit found uncovered constructs."
        : "Deterministic syntax audit passed."
    };

    let semanticAuditUnavailableReason: string | null = null;
    if (input.semanticAudit !== false && this.options.agentRuntime) {
      try {
        const generatedAudit = await this.options.agentRuntime().generateStructured({
          id: `concept-policy-${randomUUID()}`,
          featureId: "construct-flow",
          name: "Construct Project Concept Firewall",
          purpose: "Verify that a proposed learning artifact only uses concepts taught in this exact project.",
          instructions: [
            "Act as a fail-closed curriculum capability auditor.",
            "Identify every programming, framework, API, tooling, architecture, and reasoning capability a learner must understand to read or complete the proposed artifact.",
            "A capability is covered only when the supplied concept body or examples actually teach it. Similar names are not enough.",
            "Project-local learner prior evidence may cover prerequisite fluency only when it explicitly records the learner as comfortable, solid, fluent, or experienced with that capability.",
            "Do not use learner prior evidence for capabilities recorded as weak, fragile, confused, needing introduction, or current learning targets.",
            "Do not use learner prior evidence to cover a newer version-specific feature unless the evidence names that feature/version clearly.",
            "Do not treat global knowledge, common sense, imports, generated boilerplate, or concepts from other projects as covered.",
            "For example, a generic functions concept does not cover C++ lambdas unless its body or examples explicitly teach lambda syntax and semantics.",
            "If a capability is covered by learner prior evidence rather than a concept body, return that evidence id in matchedPriorEvidenceIds.",
            "Return uncovered capabilities whenever any syntax, API, pattern, command, assessment expectation, or hidden prerequisite is not explicitly covered.",
            "Administrative prose with no learning or implementation requirement may have zero capabilities."
          ].join("\n"),
          prompt: [
            `Artifact kind: ${input.artifactKind}`,
            input.artifactRef ? `Artifact reference: ${input.artifactRef}` : null,
            `Project: ${input.project.title} (${input.project.id})`,
            "",
            "Allowed project concept bodies:",
            JSON.stringify(allowedConcepts.map(serializeConceptForAudit), null, 2),
            "",
            "Project-local learner prior evidence that may cover prerequisites:",
            JSON.stringify(knownPriorEvidence.map(serializePriorEvidenceForAudit), null, 2),
            "",
            "Project-local weak or needs-learning evidence that must not cover prerequisites:",
            JSON.stringify(weakPriorEvidence.map(serializePriorEvidenceForAudit), null, 2),
            "",
            "Proposed artifact:",
            input.content.slice(0, 24_000)
          ].filter(Boolean).join("\n"),
          schema: capabilityAuditSchema,
          maxRetries: 1
        });
        semanticAudit = normalizeCapabilityAudit(generatedAudit);
      } catch (error) {
        semanticAuditUnavailableReason = semanticAuditFailureReason(error);
      }
    }

    const blockedCapabilities = uniqueStrings([
      ...deterministicBlocked.map((capability) => `${capability.name}: ${capability.evidence}`),
      ...semanticAudit.capabilities
        .filter((capability) => capability.matchedConceptIds.length === 0 && (capability.matchedPriorEvidenceIds ?? []).length === 0)
        .map((capability) => `${capability.name}: no project concept body or learner prior evidence covers ${capability.evidence}`),
      ...semanticAudit.uncoveredCapabilities.map((capability) => `${capability.name}: ${capability.reason}`)
    ]);
    const matchedConceptIds = uniqueConceptIds([
      ...semanticAudit.capabilities.flatMap((capability) => capability.matchedConceptIds),
      ...deterministic.flatMap((capability) => allowedConcepts
        .filter((concept) => conceptCoversCapability(concept, capability))
        .map((concept) => concept.id))
    ]).filter((conceptId) => allowedConcepts.some((concept) => concept.id === conceptId));

    if (blockedCapabilities.length > 0) {
      return this.block(
        input,
        declaredConceptIds,
        matchedConceptIds,
        blockedCapabilities,
        auditSummaryWithSemanticStatus(semanticAudit.summary, semanticAuditUnavailableReason)
      );
    }

    const auditId = randomUUID();
    const reason = auditSummaryWithSemanticStatus(
      semanticAudit.summary || "Every detected capability is covered by concepts taught in this project.",
      semanticAuditUnavailableReason
    );
    await store.recordConceptArtifactAudit({
      id: auditId,
      projectId: input.project.id,
      artifactKind: input.artifactKind,
      artifactRef: input.artifactRef,
      declaredConceptIds,
      matchedConceptIds,
      blockedCapabilities: [],
      status: "allowed",
      reason,
      createdAt: new Date().toISOString()
    });
    await this.recordUsageEvents(input, matchedConceptIds.length ? matchedConceptIds : declaredConceptIds, auditId);
    return {
      allowed: true,
      declaredConceptIds,
      matchedConceptIds,
      blockedCapabilities: [],
      reason,
      auditId
    };
  }

  private async block(
    input: ConstructConceptPolicyInput,
    declaredConceptIds: string[],
    matchedConceptIds: string[],
    blockedCapabilities: string[],
    reason: string
  ): Promise<ConstructConceptPolicyDecision> {
    const auditId = randomUUID();
    const audit: ConstructConceptArtifactAudit = {
      id: auditId,
      projectId: input.project.id,
      artifactKind: input.artifactKind,
      artifactRef: input.artifactRef,
      declaredConceptIds,
      matchedConceptIds,
      blockedCapabilities,
      status: "blocked",
      reason,
      createdAt: new Date().toISOString()
    };
    await this.options.learningStore().recordConceptArtifactAudit(audit);
    return {
      allowed: false,
      declaredConceptIds,
      matchedConceptIds,
      blockedCapabilities,
      reason,
      auditId
    };
  }

  private async recordUsageEvents(
    input: ConstructConceptPolicyInput,
    conceptIds: string[],
    auditId: string
  ): Promise<void> {
    const kind = eventKindForArtifact(input.artifactKind);
    const store = this.options.learningStore();
    const projectState = await store.getProjectLearnerState(input.project.id);
    for (const conceptId of conceptIds) {
      const relation = projectState.conceptRelations?.[conceptId];
      await store.recordConceptProjectEvent({
        id: randomUUID(),
        projectId: input.project.id,
        projectTitle: input.project.title,
        conceptId,
        kind,
        previousMasteryLevel: relation?.masteryLevel,
        masteryLevel: relation?.masteryLevel ?? 0,
        reason: `Authorized ${input.artifactKind} through concept audit ${auditId}.`,
        evidence: [input.artifactRef ?? input.content.slice(0, 300)],
        artifactKind: input.artifactKind,
        artifactRef: input.artifactRef,
        createdAt: new Date().toISOString()
      });
    }
  }

  private async readLearnerPriorEvidence(project: StoredFlowProject): Promise<LearnerPriorEvidence[]> {
    if (!this.options.readProjectMemory) return [];
    try {
      const memory = await this.options.readProjectMemory(project);
      return memory.flatMap((entry) => extractLearnerPriorEvidence(entry));
    } catch {
      return [];
    }
  }
}

export function assertConceptPolicyAllowed(decision: ConstructConceptPolicyDecision): void {
  if (decision.allowed) return;
  throw new Error([
    "Project concept firewall blocked this artifact.",
    decision.reason,
    decision.blockedCapabilities.length
      ? `Uncovered capabilities: ${decision.blockedCapabilities.join("; ")}`
      : null,
    "Teach and record the missing capability in this project before trying again."
  ].filter(Boolean).join(" "));
}

function eventKindForArtifact(kind: ConstructConceptArtifactKind): ConstructConceptProjectEventKind {
  if (kind === "task") return "task-used";
  if (kind === "assessment") return "assessed";
  if (kind === "file-write" || kind === "file-edit" || kind === "scaffold") return "write-used";
  return "referenced";
}

function serializeConceptForAudit(concept: KnowledgeBaseRecord) {
  return {
    id: concept.id,
    title: concept.title,
    language: concept.language,
    technology: concept.technology,
    summary: concept.summary,
    content: concept.content?.slice(0, 5_000),
    examples: concept.examples?.slice(0, 5),
    relatedConcepts: concept.relatedConcepts,
    masteryLevel: concept.masteryLevel
  };
}

function serializePriorEvidenceForAudit(evidence: LearnerPriorEvidence) {
  return {
    id: evidence.id,
    sourceFile: evidence.sourceFile,
    label: evidence.label,
    coverage: evidence.coverage,
    text: evidence.text.slice(0, 1_000)
  };
}

function normalizeCapabilityAudit(audit: RawCapabilityAudit): CapabilityAudit {
  return {
    ...audit,
    capabilities: audit.capabilities.map((capability) => ({
      ...capability,
      matchedPriorEvidenceIds: capability.matchedPriorEvidenceIds ?? []
    }))
  };
}

function semanticAuditFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() || "The semantic concept audit returned no usable result.";
}

function auditSummaryWithSemanticStatus(summary: string, semanticAuditUnavailableReason: string | null): string {
  if (!semanticAuditUnavailableReason) return summary;
  return `${summary} Semantic concept audit unavailable; using deterministic project-local audit only. ${semanticAuditUnavailableReason}`;
}

function conceptCoversCapability(concept: KnowledgeBaseRecord, capability: DetectedCapability): boolean {
  const body = normalizeCoverageText([
    concept.id,
    concept.title,
    concept.summary,
    concept.content,
    ...(concept.examples ?? []),
    ...(concept.relatedConcepts ?? [])
  ].filter(Boolean).join("\n"));
  return capability.aliases.some((alias) => body.includes(normalizeCoverageText(alias)));
}

function learnerPriorCoversCapability(
  knownEvidence: LearnerPriorEvidence[],
  weakEvidence: LearnerPriorEvidence[],
  capability: DetectedCapability
): boolean {
  const blockers = learnerPriorEvidenceIdsForCapability(weakEvidence, [], capability);
  if (blockers.length > 0) return false;
  return learnerPriorEvidenceIdsForCapability(knownEvidence, [], capability).length > 0;
}

function learnerPriorEvidenceIdsForCapability(
  evidence: LearnerPriorEvidence[],
  weakEvidence: LearnerPriorEvidence[],
  capability: DetectedCapability
): string[] {
  const weakMatches = matchingLearnerPriorEvidenceIds(weakEvidence, capability);
  if (weakMatches.length > 0) return [];
  return matchingLearnerPriorEvidenceIds(evidence, capability);
}

function matchingLearnerPriorEvidenceIds(evidence: LearnerPriorEvidence[], capability: DetectedCapability): string[] {
  return evidence
    .filter((entry) => {
      const body = normalizeCoverageText(`${entry.label}\n${entry.text}`);
      return capability.aliases.some((alias) => body.includes(normalizeCoverageText(alias)));
    })
    .map((entry) => entry.id);
}

function normalizeCoverageText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractLearnerPriorEvidence(snapshot: ConstructConceptPolicyMemorySnapshot): LearnerPriorEvidence[] {
  if (!snapshot.file.endsWith("learner.md")) return [];
  const sections = extractMarkdownEvidenceSections(snapshot.content);
  return [
    ...evidenceFromSections(snapshot.file, sections, [
      "known concepts",
      "recent learning evidence",
      "preferences and constraints",
      "autonomy and tooling preferences"
    ], "known"),
    ...evidenceFromSections(snapshot.file, sections, [
      "weak concepts",
      "current help level"
    ], "weak")
  ];
}

function extractMarkdownEvidenceSections(content: string): Map<string, string> {
  const fields = new Map<string, string[]>();
  let currentHeading: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      currentHeading = normalizeCoverageText(heading[1].replace(/:$/, ""));
      continue;
    }

    const field = line.match(/^\s*([^:#]{2,80}):\s*(.+?)\s*$/);
    if (field) {
      appendEvidenceSectionValue(fields, normalizeCoverageText(field[1]), field[2]);
      if (currentHeading && currentHeading === normalizeCoverageText(field[1])) {
        appendEvidenceSectionValue(fields, currentHeading, field[2]);
      }
      continue;
    }

    if (currentHeading) {
      appendEvidenceSectionValue(fields, currentHeading, line);
    }
  }
  return new Map([...fields.entries()].map(([key, values]) => [key, values.join("\n")]));
}

function appendEvidenceSectionValue(fields: Map<string, string[]>, key: string, rawValue: string): void {
  const value = rawValue
    .replace(/^\s*[-*+]\s+/, "")
    .trim();
  if (!value || /\bnone recorded yet\b/i.test(value)) return;
  fields.set(key, [...(fields.get(key) ?? []), value]);
}

function evidenceFromSections(
  sourceFile: string,
  sections: Map<string, string>,
  labels: string[],
  coverage: LearnerPriorEvidence["coverage"]
): LearnerPriorEvidence[] {
  return labels.flatMap((label) => {
    const text = sections.get(normalizeCoverageText(label));
    if (!text) return [];
    return [{
      id: `${sourceFile}:${normalizeCoverageText(label).replace(/\s+/g, "-")}`,
      sourceFile,
      label,
      text,
      coverage
    }];
  });
}

function detectCapabilities(content: string): DetectedCapability[] {
  const detectors: Array<{
    name: string;
    aliases: string[];
    pattern: RegExp;
  }> = [
    { name: "C++ lambda expressions", aliases: ["lambda", "lambda expression", "closure"], pattern: /\[[^\]\n]*\]\s*(?:\([^)]*\))?\s*(?:mutable\s*)?(?:->\s*[^{]+)?\s*\{/m },
    { name: "JavaScript or TypeScript arrow functions", aliases: ["arrow function", "lambda", "function expression"], pattern: /(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/m },
    { name: "Python lambda expressions", aliases: ["lambda", "anonymous function"], pattern: /\blambda\s+[^:\n]+:/m },
    { name: "Async and await", aliases: ["async", "await", "asynchronous"], pattern: /\b(?:async|await)\b/m },
    { name: "Generic types or templates", aliases: ["generic", "generics", "template"], pattern: /\btemplate\s*<|<[A-Z][A-Za-z0-9_,\s]*>\s*(?:\(|\{|[A-Za-z_$])/m },
    { name: "Classes and object construction", aliases: ["class", "object", "constructor"], pattern: /\bclass\s+[A-Za-z_]\w*|\bnew\s+[A-Z_$][\w$]*/m },
    { name: "Pointers or address semantics", aliases: ["pointer", "address", "dereference"], pattern: /(?:\b[A-Za-z_]\w*(?:::\w+)?\s*\*\s*[A-Za-z_]\w*(?=\s*(?:[=,;)\[\]{}]|$))|\&[A-Za-z_]\w*|(?:[=({[,;:+\-\/!~<>]|\breturn\b)\s*\*\s*[A-Za-z_]\w*)/m },
    { name: "Exception handling", aliases: ["exception", "try catch", "error handling"], pattern: /\btry\s*\{|\bcatch\s*\(|\bthrow\b/m },
    { name: "React hooks", aliases: ["react hook", "hooks", "usestate", "useeffect"], pattern: /\buse(?:State|Effect|Memo|Callback|Ref|Reducer|Context)\s*\(/m },
    { name: "Python comprehensions", aliases: ["comprehension", "list comprehension", "dictionary comprehension"], pattern: /[\[\{][^\]\}\n]+\bfor\b[^\]\}\n]+\bin\b[^\]\}\n]+[\]\}]/m },
    { name: "Decorators or annotations", aliases: ["decorator", "annotation"], pattern: /^\s*@[A-Za-z_]\w*/m },
    { name: "Swift closure expressions", aliases: ["closure", "swift closure", "trailing closure"], pattern: /\{[^\n{}]*\bin\b/m }
  ];
  return detectors
    .filter((detector) => detector.pattern.test(content))
    .map((detector) => ({
      name: detector.name,
      aliases: detector.aliases,
      evidence: content.match(detector.pattern)?.[0]?.slice(0, 240) ?? detector.name
    }));
}

function uniqueConceptIds(values: string[]): string[] {
  return uniqueStrings(values.map((value) => value.trim()).filter(Boolean));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function normalizePolicyMasteryLevel(value: unknown): ConstructConceptMasteryLevel {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  return 0;
}
