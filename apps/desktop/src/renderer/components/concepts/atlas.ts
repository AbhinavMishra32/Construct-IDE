import type { AtlasConcept } from "../../../shared/api";

/**
 * The galaxy, and why it is shaped the way it is.
 *
 * Two nested claims, each spending one property of the drawing on one fact:
 *
 *   1. **A root concept is a star, and what it taught orbits it.** The agent
 *      files every concept under a topic, so the topics are the systems — and a
 *      planet's orbit is its mastery level: what the learner can actually use
 *      circles close in, what they have only been shown drifts out at the edge
 *      of the system.
 *   2. **A system's distance from the galactic core is that topic's progress.**
 *      Topics the learner has got somewhere with pull inwards; topics they have
 *      barely started sit out in the dark. So the shape of the galaxy is the
 *      shape of what they know, and "I have started six things and finished
 *      none" is a picture rather than a paragraph.
 *
 * Nothing here is random. Positions come from hashes of the topic and the
 * concept id, so a concept lands in the same place on every launch — a picture
 * that redraws itself differently each time is a picture nobody can ever learn,
 * and learning it is the whole reason to draw one.
 */
export type AtlasNode = {
  concept: AtlasConcept;
  /** World position, absolute — the system's centre plus the orbit. */
  x: number;
  y: number;
  z: number;
  /** Orbit radius within its own system, for drawing the ring it rides. */
  orbit: number;
  system: number;
};

/**
 * How the atlas is arranged.
 *
 * `web` is the main view and the one v0.7 had: clusters of connected stars, each
 * cluster a topic, every concept wired to the root concept it hangs off. It is
 * how you look at *what connects to what*.
 *
 * `solar` is the same facts arranged as systems on a disc — orbits instead of
 * wires. It is how you look at *how far along* everything is, because an orbit
 * is a distance you can compare across the whole picture at a glance and a wire
 * is not.
 *
 * Both read the same layout code, and that is the point: two views of one truth,
 * not two drawings that could disagree.
 */
export type AtlasMode = "web" | "solar";

export type AtlasSystem = {
  topic: string;
  /** The star: the root concept every node in here hangs off. */
  x: number;
  y: number;
  z: number;
  /** The best level reached anywhere in the system. Sets how bright the star
   *  burns and how close in it sits. */
  reach: number;
  nodes: AtlasNode[];
};

/** The golden angle. Successive multiples never repeat a direction, which is
 *  what spreads orbits evenly instead of into spokes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** How far out a planet rides for a given level. Level 5 hugs its star; level 0
 *  is at the system's edge. */
export function orbitRadius(level: number): number {
  const step = Math.min(5, Math.max(0, level));
  return 0.07 + ((5 - step) / 5) * 0.17;
}

/** How far a system sits from the galactic core, for the best level in it. A
 *  topic the learner is fluent in is close enough to the core to be part of it. */
export function systemRadius(reach: number): number {
  const step = Math.min(5, Math.max(0, reach));
  return 0.3 + ((5 - step) / 5) * 0.68;
}

/** A small stable integer from a string. FNV-1a: short, no dependency, and the
 *  same answer on every machine — which is the only property needed here. */
export function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/**
 * The topic a concept belongs to.
 *
 * Its first tag, or the project it was learned in when it has none — the only
 * other true thing known about it. One topic per concept and not one per tag: a
 * concept filed under three tags appearing in three systems would turn a map of
 * what you know into a map of how it was labelled.
 *
 * Exported because the index list groups by exactly this. The shelves in the
 * list and the systems in the galaxy have to be the same shelves, or clicking
 * one and looking at the other is two different answers to one question.
 */
export function topicOf(concept: AtlasConcept): string {
  const tag = concept.tags.map((value) => value.trim()).find(Boolean);
  if (!tag) return concept.projectName;
  return tag[0]!.toUpperCase() + tag.slice(1);
}

/**
 * Lays the atlas out.
 *
 * `solar` puts the systems on a thin disc and their planets on flat orbits — a
 * galaxy seen from slightly above its plane. `web` puts both on spheres instead,
 * because a cluster of wired nodes has to be a ball: on a disc every wire would
 * cross every other one and the connections, which are the whole subject of that
 * view, would be the least legible thing in it.
 */
export function galaxy(concepts: AtlasConcept[], mode: AtlasMode = "solar"): AtlasSystem[] {
  const shelves = new Map<string, AtlasConcept[]>();
  for (const concept of concepts) {
    const topic = topicOf(concept);
    const shelf = shelves.get(topic) ?? [];
    shelf.push(concept);
    shelves.set(topic, shelf);
  }

  const systems: AtlasSystem[] = [];
  /* Sorted by topic so the array's order is stable; position never depends on
     it, but a stable order keeps the draw order — and so the overlap — the
     same from frame to frame. */
  for (const [topic, members] of [...shelves.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const seed = hash(topic);
    const reach = Math.max(...members.map((member) => member.masteryLevel));
    /* Jittered off the exact ring so two topics at the same level do not sit at
       the same distance and read as one orbit of stars. */
    const radius = systemRadius(reach) * (0.88 + ((seed >>> 4) % 100) / 420);
    const angle = ((seed % 3600) / 3600) * Math.PI * 2;
    /* A thin disc, not a ball: a galaxy is flat, and a flat arrangement is also
       the one you can read at a glance once it turns. */
    const height = (((seed >>> 12) % 100) / 100 - 0.5) * 0.16;

    const centre = { x: Math.cos(angle) * radius, y: height, z: Math.sin(angle) * radius };
    const system: AtlasSystem = { topic, ...centre, reach, nodes: [] };

    /* Ordered by id, not recency: teaching a new concept must not move the ones
       already drawn. */
    const ordered = [...members].sort((a, b) => a.conceptId.localeCompare(b.conceptId));
    ordered.forEach((concept, index) => {
      const orbit = orbitRadius(concept.masteryLevel);
      const theta = index * GOLDEN_ANGLE + ((hash(concept.conceptId) % 1000) / 1000) * Math.PI * 2;
      /* A little inclination per planet, from its own hash, so a system reads as
         a system rather than as a flat target — but never enough to lose the
         disc. Applied as a rotation of the orbital plane rather than as a scale
         on y, so the planet stays exactly its orbit's distance from its star:
         the radius is the mastery level, and a radius that drifts by even a
         percent is the one number here that must not. */
      /* Where on the orbit, out of the star's plane.
         
         Solar tilts a flat orbit by a shallow inclination, so a system reads as a
         disc you are looking across. Web takes a full polar angle instead, which
         puts the concepts in a ball around their root — a cluster of wires has to
         be a ball, or every wire crosses every other one and the connections, the
         whole subject of that view, become the least legible thing in it.
         
         Written as two spherical forms rather than one clever expression, because
         both have to hold the radius *exactly*: the distance from the star is the
         mastery level, and it is the one number in this file that must not drift
         by even a percent. */
      const spin = ((hash(concept.conceptId) >>> 9) % 1000) / 1000;
      if (mode === "solar") {
        const inclination = (spin - 0.5) * 0.5;
        system.nodes.push({
          concept,
          orbit,
          system: systems.length,
          x: centre.x + Math.cos(theta) * orbit,
          y: centre.y + Math.sin(theta) * orbit * Math.sin(inclination),
          z: centre.z + Math.sin(theta) * orbit * Math.cos(inclination),
        });
      } else {
        const polar = Math.acos(1 - 2 * spin);
        system.nodes.push({
          concept,
          orbit,
          system: systems.length,
          x: centre.x + Math.sin(polar) * Math.cos(theta) * orbit,
          y: centre.y + Math.cos(polar) * orbit,
          z: centre.z + Math.sin(polar) * Math.sin(theta) * orbit,
        });
      }
    });

    systems.push(system);
  }

  return systems;
}

/** Every planet in the galaxy, flat, in draw order. */
export function planets(systems: AtlasSystem[]): AtlasNode[] {
  return systems.flatMap((system) => system.nodes);
}

export type AtlasEdge = { from: number; to: number; tag: string };

/** A wire from a topic's root concept to everything filed under it. */
export type AtlasSpoke = { hub: number; leaf: number };

/**
 * The root concept of a system.
 *
 * The furthest-along concept in the topic, tie-broken by id so it never moves
 * for a reason nobody can see. A real concept and not an invented label: the web
 * view wires everything in a topic to this one, and hanging a cluster off a
 * placeholder would be drawing a relationship the learner cannot click on.
 */
export function hubOf(system: AtlasSystem): AtlasNode | undefined {
  return [...system.nodes].sort(
    (a, b) => b.concept.masteryLevel - a.concept.masteryLevel || a.concept.conceptId.localeCompare(b.concept.conceptId),
  )[0];
}

/**
 * The wires of the web view: each topic's root concept to the rest of its topic.
 *
 * A star per cluster rather than every pair joined. Joining the pairs would say
 * that each concept in a topic relates to each other one, which is not something
 * the data knows — only that they were filed together, and the root is what they
 * were filed under.
 */
export function spokes(systems: AtlasSystem[], nodes: AtlasNode[]): AtlasSpoke[] {
  const index = new Map(nodes.map((node, position) => [node.concept.conceptId, position]));
  const wires: AtlasSpoke[] = [];
  for (const system of systems) {
    const hub = hubOf(system);
    if (!hub) continue;
    const from = index.get(hub.concept.conceptId);
    if (from === undefined) continue;
    for (const node of system.nodes) {
      const to = index.get(node.concept.conceptId);
      if (to === undefined || to === from) continue;
      wires.push({ hub: from, leaf: to });
    }
  }
  return wires;
}

/**
 * The lines between planets in different systems: a shared tag.
 *
 * Only across systems. Inside one, every planet already shares the tag that made
 * the system — drawing that would be a scribble over the thing it explains. A
 * line between systems is the interesting case: the same idea turning up in two
 * topics, which is exactly what transfer looks like.
 *
 * Capped per tag. One tag across fifteen concepts is 105 lines, which is not a
 * constellation, it is a fog.
 */
export function edges(nodes: AtlasNode[], limitPerTag = 14): AtlasEdge[] {
  const byTag = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    for (const raw of node.concept.tags) {
      const tag = raw.trim().toLowerCase();
      if (!tag) continue;
      const bucket = byTag.get(tag) ?? [];
      bucket.push(index);
      byTag.set(tag, bucket);
    }
  });

  const seen = new Set<string>();
  const found: AtlasEdge[] = [];
  for (const [tag, members] of byTag) {
    if (members.length < 2) continue;
    const chain = members.length > limitPerTag;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        if (chain && j !== i + 1) continue;
        const from = members[i]!;
        const to = members[j]!;
        if (nodes[from]!.system === nodes[to]!.system) continue;
        const key = from < to ? `${from}:${to}` : `${to}:${from}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ from, to, tag });
      }
    }
  }
  return found;
}
