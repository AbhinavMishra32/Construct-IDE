import { describe, expect, it } from "vitest";
import type { AtlasConcept } from "../../../shared/api";
import { edges, galaxy, hubOf, orbitRadius, planets, spokes, systemRadius, topicOf } from "./atlas";

function concept(id: string, level: AtlasConcept["masteryLevel"], tags: string[] = []): AtlasConcept {
  return {
    parentId: null,
    conceptId: id,
    title: id,
    masteryLevel: level,
    confidence: "medium",
    note: "",
    summary: "",
    content: "",
    docs: [],
    tags,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    projectId: "p",
    projectName: "Project",
  };
}

describe("orbits", () => {
  it("puts mastery nearer its star than ignorance", () => {
    /* The whole page rests on this. If it ever inverts, the picture says the
       opposite of what it means and nothing on screen would give it away. */
    for (let level = 1; level <= 5; level += 1) {
      expect(orbitRadius(level)).toBeLessThan(orbitRadius(level - 1));
    }
  });

  it("puts a topic the learner has got somewhere with nearer the core", () => {
    for (let reach = 1; reach <= 5; reach += 1) {
      expect(systemRadius(reach)).toBeLessThan(systemRadius(reach - 1));
    }
  });

  it("keeps every system inside the disc", () => {
    for (let reach = 0; reach <= 5; reach += 1) {
      expect(systemRadius(reach)).toBeGreaterThan(0);
      expect(systemRadius(reach)).toBeLessThanOrEqual(1);
    }
  });
});

describe("topics", () => {
  it("shelves a concept under its first tag, capitalised", () => {
    expect(topicOf(concept("a", 3, [" types ", "testing"]))).toBe("Types");
  });

  it("falls back to the project when the agent filed no tags", () => {
    expect(topicOf(concept("a", 3, []))).toBe("Project");
  });
});

describe("the galaxy", () => {
  it("makes one system per topic and loses nobody", () => {
    const systems = galaxy([concept("a", 3, ["types"]), concept("b", 1, ["types"]), concept("c", 5, ["testing"])]);
    expect(systems.map((system) => system.topic).sort()).toEqual(["Testing", "Types"]);
    expect(planets(systems)).toHaveLength(3);
  });

  it("burns each star at the best level in its system", () => {
    const systems = galaxy([concept("a", 2, ["types"]), concept("b", 4, ["types"])]);
    expect(systems[0]!.reach).toBe(4);
  });

  it("orbits each planet at the radius its level earns", () => {
    const systems = galaxy([concept("a", 5, ["types"]), concept("b", 0, ["types"])]);
    const system = systems[0]!;
    for (const node of system.nodes) {
      expect(node.orbit).toBeCloseTo(orbitRadius(node.concept.masteryLevel), 6);
      /* And the drawn position really is that far out, which is the part a
         reader of the picture is trusting. */
      const distance = Math.hypot(node.x - system.x, node.y - system.y, node.z - system.z);
      expect(distance).toBeLessThanOrEqual(node.orbit + 1e-9);
      expect(distance).toBeGreaterThan(node.orbit * 0.5);
    }
  });

  it("gives a concept the same place every time", () => {
    /* A picture you cannot learn is a picture worth nothing, so position must
       depend on the concept and not on the order the rows arrived in. */
    const first = planets(galaxy([concept("a", 3, ["t"]), concept("b", 3, ["t"]), concept("c", 3, ["t"])]));
    const shuffled = planets(galaxy([concept("c", 3, ["t"]), concept("a", 3, ["t"]), concept("b", 3, ["t"])]));
    for (const node of first) {
      const same = shuffled.find((candidate) => candidate.concept.conceptId === node.concept.conceptId)!;
      expect([same.x, same.y, same.z]).toEqual([node.x, node.y, node.z]);
    }
  });

  it("spreads a system's orbit rather than stacking it", () => {
    const systems = galaxy(Array.from({ length: 8 }, (_, index) => concept(`c${index}`, 2, ["t"])));
    const distinct = new Set(systems[0]!.nodes.map((node) => `${node.x.toFixed(4)}:${node.z.toFixed(4)}`));
    expect(distinct.size).toBe(8);
  });

  it("keeps two topics apart", () => {
    const systems = galaxy([concept("a", 3, ["types"]), concept("b", 3, ["testing"])]);
    const [first, second] = systems;
    expect(Math.hypot(first!.x - second!.x, first!.z - second!.z)).toBeGreaterThan(0.1);
  });
});

describe("transfer lines", () => {
  it("draws the same idea turning up in two systems", () => {
    const systems = galaxy([concept("a", 3, ["types", "shared"]), concept("b", 2, ["testing", "shared"])]);
    const nodes = planets(systems);
    const found = edges(nodes);
    expect(found).toHaveLength(1);
    expect(found[0]!.tag).toBe("shared");
  });

  it("draws nothing inside a system, where every planet already shares the tag", () => {
    const nodes = planets(galaxy([concept("a", 3, ["types"]), concept("b", 2, ["types"])]));
    expect(edges(nodes)).toHaveLength(0);
  });

  it("ignores case and padding, because the agent writes the tags", () => {
    const nodes = planets(galaxy([concept("a", 3, ["types", " Shared "]), concept("b", 2, ["testing", "shared"])]));
    expect(edges(nodes)).toHaveLength(1);
  });

  it("draws one line per pair however many tags they share", () => {
    const nodes = planets(galaxy([concept("a", 3, ["types", "x", "y"]), concept("b", 2, ["testing", "x", "y"])]));
    expect(edges(nodes)).toHaveLength(1);
  });

  it("chains a wide tag rather than fogging the view with it", () => {
    /* Fully connecting one tag across twenty concepts is 190 lines, which is not
       a constellation. Past the cap the tag becomes a chain. */
    const nodes = planets(galaxy(Array.from({ length: 20 }, (_, index) => concept(`c${index}`, 2, [`topic${index}`, "wide"]))));
    expect(edges(nodes, 5)).toHaveLength(19);
  });

  it("draws nothing for a lonely tag", () => {
    const nodes = planets(galaxy([concept("a", 3, ["alone"]), concept("b", 2, ["solo"])]));
    expect(edges(nodes)).toHaveLength(0);
  });
});

describe("the web view", () => {
  it("hangs a topic off its furthest-along concept", () => {
    const systems = galaxy([concept("a", 2, ["t"]), concept("b", 5, ["t"]), concept("c", 1, ["t"])], "web");
    expect(hubOf(systems[0]!)!.concept.conceptId).toBe("b");
  });

  it("breaks a tie on id, so the root never moves for an invisible reason", () => {
    const systems = galaxy([concept("b", 3, ["t"]), concept("a", 3, ["t"])], "web");
    expect(hubOf(systems[0]!)!.concept.conceptId).toBe("a");
  });

  it("wires every other concept in the topic to that root, and not to each other", () => {
    const systems = galaxy([concept("a", 5, ["t"]), concept("b", 2, ["t"]), concept("c", 1, ["t"])], "web");
    const nodes = planets(systems);
    const wires = spokes(systems, nodes);
    expect(wires).toHaveLength(2);
    expect(new Set(wires.map((wire) => nodes[wire.hub]!.concept.conceptId))).toEqual(new Set(["a"]));
  });

  it("draws no wire for a topic of one", () => {
    const systems = galaxy([concept("a", 3, ["t"])], "web");
    expect(spokes(systems, planets(systems))).toHaveLength(0);
  });

  it("still puts mastery at the radius it earns, in either arrangement", () => {
    /* The two views are two readings of one fact, so the radius has to mean the
       same thing in both. If this ever diverges the switch becomes two different
       drawings instead of two angles on one. */
    for (const mode of ["web", "solar"] as const) {
      const systems = galaxy([concept("a", 5, ["t"]), concept("b", 0, ["t"])], mode);
      const system = systems[0]!;
      for (const node of system.nodes) {
        const distance = Math.hypot(node.x - system.x, node.y - system.y, node.z - system.z);
        expect(distance).toBeCloseTo(orbitRadius(node.concept.masteryLevel), 6);
      }
    }
  });

  it("gives a concept the same place every time here too", () => {
    const first = planets(galaxy([concept("a", 3, ["t"]), concept("b", 3, ["t"])], "web"));
    const again = planets(galaxy([concept("b", 3, ["t"]), concept("a", 3, ["t"])], "web"));
    for (const node of first) {
      const same = again.find((candidate) => candidate.concept.conceptId === node.concept.conceptId)!;
      expect([same.x, same.y, same.z]).toEqual([node.x, node.y, node.z]);
    }
  });
});
