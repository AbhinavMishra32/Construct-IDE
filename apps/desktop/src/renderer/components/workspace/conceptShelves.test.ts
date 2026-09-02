import { describe, expect, it } from "vitest";

import type { ConceptSummary } from "../../../shared/api";
import { branchTo, buildConceptTree, type ConceptTreeNode } from "./conceptShelves";

const concept = (conceptId: string, parentId: string | null, masteryLevel = 2): ConceptSummary =>
  ({
    conceptId,
    parentId,
    title: conceptId,
    masteryLevel,
    confidence: "",
    note: "",
    summary: "",
    content: "",
    docs: [],
    tags: [],
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as ConceptSummary;

const ids = (nodes: ConceptTreeNode[]): string[] => nodes.map((node) => node.concept.conceptId);

/** Every concept the tree actually renders, at any depth. */
const flatten = (nodes: ConceptTreeNode[]): string[] =>
  nodes.flatMap((node) => [node.concept.conceptId, ...flatten(node.children)]);

describe("buildConceptTree", () => {
  it("nests as deep as the parents go", () => {
    const tree = buildConceptTree([
      concept("oop", null),
      concept("polymorphism", "oop"),
      concept("virtual-dispatch", "polymorphism"),
      concept("vtables", "virtual-dispatch"),
    ]);
    expect(ids(tree)).toEqual(["oop"]);
    expect(ids(tree[0]!.children)).toEqual(["polymorphism"]);
    expect(ids(tree[0]!.children[0]!.children)).toEqual(["virtual-dispatch"]);
    expect(ids(tree[0]!.children[0]!.children[0]!.children)).toEqual(["vtables"]);
  });

  it("counts a concept and everything under it", () => {
    const tree = buildConceptTree([
      concept("oop", null),
      concept("polymorphism", "oop"),
      concept("virtual-dispatch", "polymorphism"),
    ]);
    expect(tree[0]!.total).toBe(3);
    expect(tree[0]!.children[0]!.total).toBe(2);
  });

  it("roots a concept whose parent has not been recorded yet", () => {
    /* The agent may record a child before the parent it names. Dropping it
       would hide a concept because of a link that will exist next turn. */
    const tree = buildConceptTree([concept("polymorphism", "oop")]);
    expect(ids(tree)).toEqual(["polymorphism"]);
  });

  it("roots a concept that points at itself", () => {
    const tree = buildConceptTree([concept("oop", "oop")]);
    expect(ids(tree)).toEqual(["oop"]);
  });

  it("keeps every concept when two point at each other", () => {
    /* A cycle must not recurse forever, and must not lose either concept. */
    const tree = buildConceptTree([concept("a", "b"), concept("b", "a")]);
    expect(flatten(tree).sort()).toEqual(["a", "b"]);
  });

  it("keeps every concept in a longer cycle", () => {
    const tree = buildConceptTree([concept("a", "c"), concept("b", "a"), concept("c", "b")]);
    expect(flatten(tree).sort()).toEqual(["a", "b", "c"]);
  });

  it("orders siblings strongest first, then by title", () => {
    const tree = buildConceptTree([
      concept("weak", null, 1),
      concept("zebra", null, 5),
      concept("alpha", null, 5),
    ]);
    expect(ids(tree)).toEqual(["alpha", "zebra", "weak"]);
  });

  it("nests under a parent that has no note of its own", () => {
    /* A parent is often a container the agent never writes an entry for — "Cpp"
       holding the C++ ideas. It is a concept row like any other: the tree does
       not read `content`, so an empty one still parents, still counts, and
       still opens (to the card's "no entry written yet" state). */
    const bare = { ...concept("cpp", null, 0), content: "", summary: "", note: "" } as ConceptSummary;
    const tree = buildConceptTree([bare, concept("pointers", "cpp"), concept("templates", "cpp")]);

    expect(ids(tree)).toEqual(["cpp"]);
    expect(ids(tree[0]!.children)).toEqual(["pointers", "templates"]);
    expect(tree[0]!.total).toBe(3);
  });

  it("returns nothing for no concepts", () => {
    expect(buildConceptTree([])).toEqual([]);
  });
});

describe("branchTo", () => {
  it("names every concept above one, so its branch can be opened", () => {
    const tree = buildConceptTree([
      concept("oop", null),
      concept("polymorphism", "oop"),
      concept("virtual-dispatch", "polymorphism"),
    ]);
    expect(branchTo(tree, "virtual-dispatch")).toEqual(["oop", "polymorphism"]);
  });

  it("returns nothing for a root, and for a concept not in the tree", () => {
    const tree = buildConceptTree([concept("oop", null)]);
    expect(branchTo(tree, "oop")).toEqual([]);
    expect(branchTo(tree, "missing")).toEqual([]);
  });
});
