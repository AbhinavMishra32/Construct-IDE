import type { ConceptSummary } from "../../../shared/api";

/**
 * The project's concepts, as the tree the agent recorded.
 *
 * Built from each concept's `parentId` — a real edge the agent sets when it
 * records the concept — so the tree is as deep as the subject is: virtual
 * dispatch under polymorphism under object orientation. The first cut of this
 * shelved by tags instead, two levels deep, because there was no parent to read;
 * that is a filing system, not a structure, and it could not say that one idea
 * lives inside another.
 *
 * Everything here is defensive, because the tree is written a concept at a time
 * by a model. A concept may name a parent that has not been recorded yet, or one
 * that has since been deleted, and two concepts can end up pointing at each
 * other. None of those may lose a concept: a concept missing from this list is
 * one the learner cannot open and the agent will record twice.
 */
export type ConceptTreeNode = {
  concept: ConceptSummary;
  depth: number;
  children: ConceptTreeNode[];
  /** This concept and everything under it. What the row counts. */
  total: number;
};

/** Strongest first, then alphabetical: the list answers "what do I hold" before
 *  it answers "what is it called", and ties have to order stably or the tree
 *  reshuffles on every refresh. */
function byHold(a: ConceptTreeNode, b: ConceptTreeNode): number {
  return b.concept.masteryLevel - a.concept.masteryLevel || a.concept.title.localeCompare(b.concept.title);
}

export function buildConceptTree(concepts: ConceptSummary[]): ConceptTreeNode[] {
  const known = new Set(concepts.map((concept) => concept.conceptId));

  /* A parent that does not resolve makes the concept a root. Dropping it
     instead would hide a concept because of a link, which is the one outcome
     this must never have. */
  const childrenOf = new Map<string | null, ConceptSummary[]>();
  for (const concept of concepts) {
    const parent =
      concept.parentId && concept.parentId !== concept.conceptId && known.has(concept.parentId) ? concept.parentId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), concept]);
  }

  /* `seen` is what makes a cycle safe: a → b → a would otherwise recurse until
     the stack gives out. A concept is placed the first time it is reached, and
     anything a cycle kept unreachable is collected as a root below. */
  const seen = new Set<string>();
  const build = (concept: ConceptSummary, depth: number): ConceptTreeNode => {
    seen.add(concept.conceptId);
    const children = (childrenOf.get(concept.conceptId) ?? [])
      .filter((child) => !seen.has(child.conceptId))
      .map((child) => build(child, depth + 1))
      .sort(byHold);
    return { concept, depth, children, total: 1 + children.reduce((sum, child) => sum + child.total, 0) };
  };

  const roots = (childrenOf.get(null) ?? []).filter((concept) => !seen.has(concept.conceptId)).map((concept) => build(concept, 0));

  /* Marooned by a cycle. Shown at the top rather than lost. */
  for (const concept of concepts) {
    if (!seen.has(concept.conceptId)) roots.push(build(concept, 0));
  }

  return roots.sort(byHold);
}

/** Every concept between the roots and this one, so opening a card can reveal
 *  the branch it lives on rather than leaving it highlighted somewhere
 *  collapsed. */
export function branchTo(tree: ConceptTreeNode[], conceptId: string): string[] {
  const walk = (nodes: ConceptTreeNode[], trail: string[]): string[] | null => {
    for (const node of nodes) {
      if (node.concept.conceptId === conceptId) return trail;
      const found = walk(node.children, [...trail, node.concept.conceptId]);
      if (found) return found;
    }
    return null;
  };
  return walk(tree, []) ?? [];
}
