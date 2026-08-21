import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MASTERY_RUBRIC } from "@construct/domain";
import type { AtlasConcept } from "../../../shared/api";
import { resolveToken } from "@/lib/mastery";
import { edges, galaxy, hubOf, planets, spokes, type AtlasEdge, type AtlasMode, type AtlasNode, type AtlasSpoke, type AtlasSystem } from "./atlas";
import { conceptColor } from "./palette";

/** Camera distance in world units, and the focal length as a multiple of the
 *  viewport's short side. Together they set two things: how big the galaxy is —
 *  the outermost system lands at about a third of the short side, so the disc
 *  fills the pane without touching it — and how much perspective there is. At
 *  this pair a planet at the front of a system is about 40% larger than the same
 *  planet at the back, which is enough to read depth and little enough that the
 *  outer systems do not fisheye. */
const CAMERA = 3.1;
/** How close and how far the wheel may take you. In at 1.6 a single system fills
 *  the pane, which is the useful limit — closer and you are inside one orbit with
 *  no context. Out at 7 the whole thing is a coin, which is the other. */
const NEAREST = 1.05;
const FURTHEST = 7;
const FOCAL = 1.45;
/** Radians per second of idle drift. Slow enough to be a drift rather than a
 *  carousel: this is something you read, and text that moves is text you cannot
 *  read. */
const DRIFT = 0.05;

type Props = {
  concepts: AtlasConcept[];
  selectedId: string | null;
  mode: AtlasMode;
  onSelect(concept: AtlasConcept | null): void;
};

/**
 * The atlas: everything the learner understands, as a galaxy.
 *
 * A star per root concept, its sub-concepts in orbit around it, and the systems
 * themselves arranged on a disc by how far that topic has got. What each
 * distance means is in `atlas.ts`, which is where the layout lives; this file
 * turns it into pixels.
 *
 * Painted to a 2D canvas with the projection done by hand — no WebGL, no graph
 * library. That is not asceticism. A force-directed graph puts a concept wherever
 * the simulation settles, which means the same knowledge draws a different
 * picture every time and a node's position means nothing; here every coordinate
 * is a fact about the learner, so the image is stable enough to become familiar
 * and every part of it carries information. A library that solved the drawing
 * would have taken the meaning with it.
 */
export function ConceptAtlas({ concepts, selectedId, mode, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hovered, setHovered] = useState<AtlasConcept | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const systems = useMemo(() => galaxy(concepts, mode), [concepts, mode]);
  const nodes = useMemo(() => planets(systems), [systems]);
  const links = useMemo(() => edges(nodes), [nodes]);
  const wires = useMemo(() => spokes(systems, nodes), [systems, nodes]);
  /* The root concepts, by index, so the draw loop can size and label them
     without searching its own system for each one. */
  const hubs = useMemo(() => {
    const found = new Set<string>();
    for (const system of systems) {
      const hub = hubOf(system);
      if (hub) found.add(hub.concept.conceptId);
    }
    return found;
  }, [systems]);

  /* Everything the frame loop mutates lives in refs. State here would mean a
     React render per frame at 60fps, and a render per frame is how a canvas
     animation ends up costing more than the app around it. */
  /* No bounds on either angle. Pitch used to be clamped short of the poles,
     which felt exactly like what it was — the galaxy hitting a wall mid-drag —
     and there is nothing at a pole worth protecting: the disc turns edge-on and
     then over, which is a thing you might want to look at. */
  const camera = useRef({
    yaw: 0.6,
    pitch: -0.5,
    /* Radians per second, carried over from a drag: a body with mass does not
       stop the instant you let go of it. */
    spinYaw: 0,
    spinPitch: 0,
    /* What the view turns around, and how far back it sits. Focusing a concept
       moves the pivot onto it and pulls in; clicking empty space puts both back.
       Animated rather than set, because a camera that teleports loses the one
       thing the pivot is for — you have to see *which* dot it went to. */
    pivot: { x: 0, y: 0, z: 0 },
    pivotTo: { x: 0, y: 0, z: 0 },
    distance: CAMERA,
    distanceTo: CAMERA,
  });
  const dragging = useRef<{ x: number; y: number; at: number } | null>(null);
  const projected = useRef<Array<{ node: AtlasNode; x: number; y: number }>>([]);
  const hoveredIndex = useRef<number | null>(null);
  const systemsRef = useRef<AtlasSystem[]>(systems);
  const nodesRef = useRef<AtlasNode[]>(nodes);
  const linksRef = useRef<AtlasEdge[]>(links);
  const wiresRef = useRef<AtlasSpoke[]>(wires);
  const hubsRef = useRef<Set<string>>(hubs);
  const modeRef = useRef<AtlasMode>(mode);
  const selectedRef = useRef<string | null>(selectedId);

  systemsRef.current = systems;
  nodesRef.current = nodes;
  linksRef.current = links;
  wiresRef.current = wires;
  hubsRef.current = hubs;
  modeRef.current = mode;
  selectedRef.current = selectedId;

  /* Focus: the view swings its centre onto a concept and pulls in, then keeps
     turning slowly around it.
     
     Without this, choosing a concept in the list asks the learner to find, in a
     turning galaxy of forty dots, the one they just clicked — a puzzle, not a
     navigation. With it the thing you picked is the thing in the middle, and its
     neighbours are the wires and orbits around it, which is the only view in
     which "what is this connected to" has an answer you can see.
     
     Clicking empty space puts the camera back where it started but leaves the
     entry open: the reading and the camera are different things, and losing a
     page you were halfway through because you clicked past a dot would be a
     rotten trade. */
  const focus = useCallback((node: AtlasNode | null) => {
    const state = camera.current;
    state.pivotTo = node ? { x: node.x, y: node.y, z: node.z } : { x: 0, y: 0, z: 0 };
    /* Well in: a focused concept should fill its neighbourhood, which is also
       the range where the labels have faded up and its wires are readable. */
    state.distanceTo = node ? 1.35 : CAMERA;
    state.spinYaw = 0;
    state.spinPitch = 0;
  }, []);

  useEffect(() => {
    focus(nodes.find((candidate) => candidate.concept.conceptId === selectedId) ?? null);
  }, [focus, nodes, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    /* Read from the live computed style rather than hard-coding: the ramp and the
       ink are theme tokens, and a canvas that keeps its own copy of them is a
       canvas that stays in light mode after the window goes dark. */
    let ink = resolveToken("--foreground") || "#fff";
    let brand = resolveToken("--brand") || "#f59e0b";
    /* Which way the value channel runs: on a dark ground mastery brightens, on a
       light one it deepens — see `palette.ts`. */
    let dark = document.documentElement.classList.contains("dark");
    const theme = new MutationObserver(() => {
      ink = resolveToken("--foreground") || "#fff";
      brand = resolveToken("--brand") || "#f59e0b";
      dark = document.documentElement.classList.contains("dark");
    });
    theme.observe(document.documentElement, { attributeFilter: ["class"] });

    let width = 0;
    let height = 0;
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    /* Bound natively, not through React, because React attaches wheel listeners
       passively at the root: without a non-passive listener the browser scrolls
       the page instead and `preventDefault` warns rather than works.
       
       Multiplicative, not additive. Zoom is a ratio — a notch should cover the
       same proportion of the way in whether you are close or far — and an additive
       step crawls when you are near and lurches when you are out. */
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = camera.current;
      state.distance = Math.max(NEAREST, Math.min(FURTHEST, state.distance * Math.exp(event.deltaY * 0.0016)));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame = requestAnimationFrame(draw);

      const state = camera.current;
      /* Pivot and distance always ease, drag or no drag: you should be able to
         turn the view while it is still flying to what you picked. */
      const approach = Math.min(1, delta * 3.6);
      state.pivot.x += (state.pivotTo.x - state.pivot.x) * approach;
      state.pivot.y += (state.pivotTo.y - state.pivot.y) * approach;
      state.pivot.z += (state.pivotTo.z - state.pivot.z) * approach;
      state.distance += (state.distanceTo - state.distance) * approach;

      if (!dragging.current) {
        if (Math.abs(state.spinYaw) > 0.02 || Math.abs(state.spinPitch) > 0.02) {
          /* Coasting after a flick. The decay is applied as a power of delta so
             the feel does not change with the frame rate — a flick that spins for
             a second at 60fps has to spin for a second at 30. */
          state.yaw += state.spinYaw * delta;
          state.pitch += state.spinPitch * delta;
          const damping = Math.pow(0.12, delta);
          state.spinYaw *= damping;
          state.spinPitch *= damping;
        } else if (!reduced) {
          state.yaw += DRIFT * delta;
        }
      }

      const cx = width / 2;
      const cy = height / 2;
      const scale = Math.min(width, height) * FOCAL;
      const cosYaw = Math.cos(state.yaw);
      const sinYaw = Math.sin(state.yaw);
      const cosPitch = Math.cos(state.pitch);
      const sinPitch = Math.sin(state.pitch);

      /* Yaw about the vertical, then pitch about the horizontal. Two rotations
         and no roll: a galaxy is a disc, so a third axis would add nothing you
         could see and one more way for a drag to feel wrong. */
      const project = (worldX: number, worldY: number, worldZ: number) => {
        const x = worldX - state.pivot.x;
        const y = worldY - state.pivot.y;
        const z = worldZ - state.pivot.z;
        const rx = x * cosYaw - z * sinYaw;
        const rz = x * sinYaw + z * cosYaw;
        const ry = y * cosPitch - rz * sinPitch;
        const rzz = y * sinPitch + rz * cosPitch;
        const factor = scale / (rzz + state.distance);
        return { x: cx + rx * factor, y: cy + ry * factor, depth: rzz };
      };

      context.clearRect(0, 0, width, height);

      /* --- the galactic core ----------------------------------------------
         What every system's distance is measured from, drawn as light rather
         than as an object: it is the origin, not a thing in the picture.
         
         Solar only. In the web view there is nothing at the origin to light —
         the clusters sit all round it — so a glow there is just a nebula behind
         whichever cluster happens to be in front of it, and the web view is
         meant to be a clean wired graph rather than a sky. */
      if (modeRef.current === "solar") {
        const core = project(0, 0, 0);
        const halo = context.createRadialGradient(core.x, core.y, 0, core.x, core.y, 80);
        halo.addColorStop(0, withAlpha(brand, 0.26));
        halo.addColorStop(0.45, withAlpha(brand, 0.07));
        halo.addColorStop(1, withAlpha(brand, 0));
        context.fillStyle = halo;
        context.beginPath();
        context.arc(core.x, core.y, 80, 0, Math.PI * 2);
        context.fill();
      }

      const points = nodesRef.current.map((node) => ({ node, ...project(node.x, node.y, node.z) }));
      const activeId = hoveredIndex.current !== null ? points[hoveredIndex.current]?.node.concept.conceptId : selectedRef.current;

      /* --- the systems -----------------------------------------------------
         A star per root concept, and one ring per orbit its planets ride. The
         rings sit in the galaxy's plane, which is what makes a system read as a
         system: a ring seen edge-on says "this is flat and you are looking along
         it", and that is the whole reason the layout is a disc. */
      const stars = systemsRef.current
        .map((system) => ({ system, ...project(system.x, system.y, system.z) }))
        .sort((a, b) => b.depth - a.depth);

      for (const { system, x, y, depth } of stars) {
        const near = 1 - (depth + 1) / 2;
        const fog = 0.4 + near * 0.6;
        const holds = system.nodes.some((node) => node.concept.conceptId === activeId);

        /* Rings belong to the solar view only. In the web view the wires do this
           job, and drawing both would be two claims about the same relationship
           laid on top of each other. */
        for (const orbit of modeRef.current === "solar" ? new Set(system.nodes.map((node) => node.orbit)) : []) {
          context.beginPath();
          for (let step = 0; step <= 72; step += 1) {
            const angle = (step / 72) * Math.PI * 2;
            const point = project(system.x + Math.cos(angle) * orbit, system.y, system.z + Math.sin(angle) * orbit);
            if (step === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
          }
          context.strokeStyle = withAlpha(holds ? brand : ink, holds ? 0.22 : 0.07 * fog);
          context.lineWidth = 1;
          context.stroke();
        }

        /* The star burns at the colour of the best level anywhere in its system,
           so a topic's state is legible from the star alone. Solar only: in the
           web view the root concept is itself a node and gets drawn as one,
           because a cluster hanging off a marker you cannot click is a
           relationship you cannot follow. */
        const heat = conceptColor(system.topic, system.reach, dark);
        const size = bodySize(0.0075 + system.reach * 0.0016, depth, scale, state.distance);
        if (modeRef.current === "solar") {
          const shine = context.createRadialGradient(x, y, 0, x, y, size * 7);
          shine.addColorStop(0, withAlpha(heat, 0.5 * fog));
          shine.addColorStop(1, withAlpha(heat, 0));
          context.fillStyle = shine;
          context.beginPath();
          context.arc(x, y, size * 7, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = withAlpha(ink, 0.7 + near * 0.3);
          context.beginPath();
          context.arc(x, y, size, 0, Math.PI * 2);
          context.fill();
        }

        /* The topics are the one label always worth printing: there is a handful
           of them, they are short, and they are the level at which anybody first
           scans this. The planets stay silent until hovered — a concept title is
           a sentence, and a sentence per planet is a page of text pretending to
           be a picture. */
        context.font = "600 9.5px -apple-system, BlinkMacSystemFont, sans-serif";
        context.textAlign = "center";
        context.fillStyle = withAlpha(holds ? heat : ink, holds ? 0.95 : 0.28 + near * 0.34);
        context.fillText(
          system.topic.toUpperCase(),
          x,
          y - (modeRef.current === "solar" ? size + 8 : (maxOrbit(system) * scale) / (depth + state.distance) + 10),
        );
      }

      /* --- the wires ------------------------------------------------------
         What the web view is for: every concept joined to the root concept of
         its topic. Brighter than the transfer lines below, because this is the
         relation the agent actually asserted — it filed them together — while a
         shared tag between topics is an inference. */
      if (modeRef.current === "web") {
        for (const wire of wiresRef.current) {
          const hub = points[wire.hub];
          const leaf = points[wire.leaf];
          if (!hub || !leaf) continue;
          const touched = activeId != null && (hub.node.concept.conceptId === activeId || leaf.node.concept.conceptId === activeId);
          const fog = 0.4 + (1 - (leaf.depth + 1) / 2) * 0.6;
          context.beginPath();
          context.moveTo(hub.x, hub.y);
          context.lineTo(leaf.x, leaf.y);
          context.strokeStyle = touched ? withAlpha(brand, 0.55) : withAlpha(ink, 0.16 * fog);
          context.lineWidth = touched ? 1.3 : 0.9;
          context.stroke();
        }
      }

      /* --- transfer --------------------------------------------------------
         A line where the same tag turns up in two different systems. Under
         everything and barely there: the moment they are legible enough to trace
         one by one they are louder than the concepts they connect. */
      for (const link of linksRef.current) {
        const from = points[link.from];
        const to = points[link.to];
        if (!from || !to) continue;
        const touched = activeId != null && (from.node.concept.conceptId === activeId || to.node.concept.conceptId === activeId);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.strokeStyle = touched ? withAlpha(brand, 0.45) : withAlpha(ink, 0.05);
        context.lineWidth = touched ? 1.1 : 0.7;
        context.stroke();
      }

      /* --- the planets -----------------------------------------------------
         Back to front, so a near one covers a far one, and fogged by depth:
         without the fog a disc of dots is a flat scatter of dots. */
      for (const point of [...points].sort((a, b) => b.depth - a.depth)) {
        const level = point.node.concept.masteryLevel;
        const colour = conceptColor(systemsRef.current[point.node.system]?.topic ?? "", level, dark);
        const fog = 0.42 + (1 - (point.depth + 1) / 2) * 0.58;
        const selected = point.node.concept.conceptId === selectedRef.current;
        const isHovered = hoveredIndex.current !== null && points[hoveredIndex.current]?.node === point.node;
        /* A root concept is drawn half again as large as what hangs off it: in a
           cluster of equal dots there is no telling which one the wires converge
           on, and that is the one fact the web view is built to show. */
        const root = modeRef.current === "web" && hubsRef.current.has(point.node.concept.conceptId);
        const radius = bodySize((0.0075 + level * 0.0019) * (root ? 1.7 : 1), point.depth, scale, state.distance);

        /* Bloom in the orbits view, where the nodes are bodies in space and a
           lit one reads as burning. Not in the web view: a wired graph wants
           flat, solid marks — glow on every third node turns the wires into a
           smear of light and the whole thing into a screensaver. There, only
           the node under the pointer or the one being read gets it. */
        if (modeRef.current === "solar" ? level >= 3 || selected || isHovered : selected || isHovered) {
          const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 5);
          glow.addColorStop(0, withAlpha(colour, 0.42 * fog));
          glow.addColorStop(1, withAlpha(colour, 0));
          context.fillStyle = glow;
          context.beginPath();
          context.arc(point.x, point.y, radius * 5, 0, Math.PI * 2);
          context.fill();
        }

        context.fillStyle = withAlpha(colour, modeRef.current === "web" ? 0.55 + fog * 0.45 : fog);
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();

        if (selected || isHovered) {
          context.strokeStyle = withAlpha(brand, 0.9);
          context.lineWidth = 1.4;
          context.beginPath();
          context.arc(point.x, point.y, radius + 4.5, 0, Math.PI * 2);
          context.stroke();
        }
      }

      /* --- the names ------------------------------------------------------
         Level of detail, driven by how big a node has become on screen — which
         is to say, by how close you have zoomed to it.
         
         Wide out, nothing is labelled but the topics: forty sentences over a
         turning body is not a picture, it is a page. Come in and each planet
         takes its name; come further and the name is joined by its level and the
         one-line gloss the agent wrote. The information appears where the
         attention already is, at the size the attention can use, and nothing has
         to be clicked to find out what a dot is.
         
         Drawn in a pass after the nodes so a name is never half-covered by the
         next planet along, and only on the near half: a label behind the cluster
         is a label written over the thing it is behind. */
      for (const point of [...points].sort((a, b) => b.depth - a.depth)) {
        const near = 1 - (point.depth + 1) / 2;
        if (near < 0.34) continue;

        const level = point.node.concept.masteryLevel;
        const root = modeRef.current === "web" && hubsRef.current.has(point.node.concept.conceptId);
        const radius = bodySize((0.0075 + level * 0.0019) * (root ? 1.7 : 1), point.depth, scale, state.distance);
        const selected = point.node.concept.conceptId === selectedRef.current;
        const isHovered = hoveredIndex.current !== null && points[hoveredIndex.current]?.node === point.node;

        /* Named from 3.6px of radius, glossed from 6.5px. The thresholds are in
           apparent size rather than in zoom level so a planet out at the rim
           earns its name at the same *legibility*, not at the same wheel
           position. */
        const named = radius > 3.6 || selected || isHovered;
        if (!named) continue;
        const glossed = radius > 6.5 || selected || isHovered;
        const reveal = selected || isHovered ? 1 : Math.min(1, (radius - 3.6) / 2.4);
        const strong = selected || isHovered;
        const dim = (alpha: number) => withAlpha(ink, alpha * (0.5 + near * 0.5));

        context.font = `${strong ? 600 : 500} ${glossed ? 11.5 : 10}px -apple-system, BlinkMacSystemFont, sans-serif`;
        /* Flips to the other side of the node rather than running off the pane,
           then trims to the room that side actually has. The atlas lives in a
           narrow column and focusing puts the subject in the middle of it, so a
           label that only ever sits to the right, at whatever length it happens
           to be, is a label cut off by the window exactly when it matters most. */
        const flip = width - (point.x + radius + 9) < context.measureText(point.node.concept.title).width;
        const anchor = flip ? point.x - radius - 5 : point.x + radius + 5;
        const room = (flip ? anchor : width - anchor) - 8;
        context.textAlign = flip ? "right" : "left";

        context.fillStyle = dim(strong ? 0.95 : 0.42 + reveal * 0.4);
        context.fillText(fit(context, point.node.concept.title, room), anchor, point.y + 3.5);

        if (glossed) {
          /* The level in its own colour, so every label teaches the ramp as well
             as the legend does. */
          const rubric = LEVEL_NAMES[level] ?? "";
          context.font = "500 9.5px -apple-system, BlinkMacSystemFont, sans-serif";
          context.fillStyle = withAlpha(
            conceptColor(systemsRef.current[point.node.system]?.topic ?? "", level, dark),
            (strong ? 0.95 : 0.7) * (0.5 + near * 0.5),
          );
          context.fillText(rubric, anchor, point.y + 16);

          const gloss = point.node.concept.summary.trim();
          const offset = context.measureText(rubric).width + 7;
          if (gloss && room - offset > 40) {
            context.fillStyle = dim(strong ? 0.55 : 0.3);
            context.fillText(fit(context, gloss, room - offset), flip ? anchor - offset : anchor + offset, point.y + 16);
          }
        }
      }

      projected.current = points.map((point) => ({ node: point.node, x: point.x, y: point.y }));
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("wheel", onWheel);
      observer.disconnect();
      theme.disconnect();
    };
  }, []);

  const pick = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let best: { index: number; distance: number } | null = null;
    projected.current.forEach((point, index) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= 13 && (!best || distance < best.distance)) best = { index, distance };
    });
    return { x, y, hit: best as { index: number; distance: number } | null };
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas
        aria-label="Concept atlas"
        className="h-full w-full touch-none select-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
          camera.current.spinYaw = 0;
          camera.current.spinPitch = 0;
        }}
        onPointerLeave={() => {
          hoveredIndex.current = null;
          setHovered(null);
          setPointer(null);
        }}
        onPointerMove={(event) => {
          const drag = dragging.current;
          if (drag) {
            /* A drag turns the galaxy under the pointer rather than moving a
               camera around it: 0.006 radians per pixel puts a half turn at
               roughly the width of the pane, which is the ratio that makes the
               thing feel like it has mass. Pitch is clamped short of the poles,
               where a disc collapses to a line. */
            const dx = (event.clientX - drag.x) * 0.006;
            const dy = (event.clientY - drag.y) * 0.005;
            camera.current.yaw += dx;
            camera.current.pitch += dy;
            /* The velocity to coast on, in radians per second, taken from the
               event's own interval rather than an assumed frame time: a trackpad
               fires several times more often than a mouse, and dividing by 16ms
               either way would make one gesture fling differently on each. */
            const elapsed = Math.max(4, event.timeStamp - drag.at);
            camera.current.spinYaw = (dx / elapsed) * 1000;
            camera.current.spinPitch = (dy / elapsed) * 1000;
            dragging.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
            return;
          }
          const { x, y, hit } = pick(event);
          hoveredIndex.current = hit?.index ?? null;
          setHovered(hit ? projected.current[hit.index]?.node.concept ?? null : null);
          setPointer(hit ? { x, y } : null);
        }}
        onPointerUp={(event) => {
          const drag = dragging.current;
          dragging.current = null;
          /* A click is a drag that went nowhere. Without the threshold every
             spin of the galaxy would also select whatever was under the finger
             when it stopped. */
          if (!drag || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) return;
          const { hit } = pick(event);
          const node = hit ? projected.current[hit.index]?.node ?? null : null;
          if (node) onSelect(node.concept);
          else focus(null);
        }}
        ref={canvasRef}
        style={{ cursor: hovered ? "pointer" : "grab" }}
      />

      {hovered && pointer && (
        /* Follows the pointer rather than sitting in a corner: the question is
           always "what is *that* one", and an answer printed away from the thing
           asked about makes you look twice. */
        <div
          className="pointer-events-none absolute z-10 max-w-[15rem] rounded-lg border border-border/70 bg-popover/95 px-2.5 py-1.5 shadow-[var(--app-shadow-menu)] backdrop-blur"
          style={{ left: Math.min(pointer.x + 14, 40), top: pointer.y + 12 }}
        >
          <p className="text-ui font-medium leading-snug text-foreground">{hovered.title}</p>
          {hovered.summary && <p className="mt-0.5 line-clamp-2 text-ui-sm leading-snug text-muted-foreground">{hovered.summary}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * How big a body is on screen.
 *
 * Sized in world units and projected like everything else, rather than as a
 * constant number of pixels. This was the bug the zoom exposed: a node whose
 * radius was fixed in pixels stayed exactly the same size as you zoomed into it,
 * so the whole gesture spread the layout out and magnified nothing — and the
 * labels, which appear when a node gets big enough to carry one, could never
 * appear at all.
 */
function bodySize(world: number, depth: number, scale: number, distance: number): number {
  return (world * scale) / (depth + distance);
}

/** The rubric's names, flattened for the canvas. Imported rather than retyped:
 *  the labels a learner reads on the map have to be the labels the agent is held
 *  to. */
const LEVEL_NAMES = MASTERY_RUBRIC.map((step) => step.title);

/**
 * Text cut to the pixels available, measured in the font that will draw it.
 *
 * By width and not by a character count, because a character count is a guess
 * about a proportional face: "Illiterate" and "Wallpaper" are the same ten
 * letters and nowhere near the same label. Binary search rather than a loop per
 * character — this runs for every visible node, every frame.
 */
function fit(context: CanvasRenderingContext2D, text: string, room: number): string {
  if (room <= 0) return "";
  if (context.measureText(text).width <= room) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, middle).trimEnd()}…`).width <= room) low = middle;
    else high = middle - 1;
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}…` : "";
}

/** The outer edge of a system, for placing its label clear of it. */
function maxOrbit(system: AtlasSystem): number {
  return system.nodes.reduce((widest, node) => Math.max(widest, node.orbit), 0);
}

/** A colour with an alpha, whatever notation the token arrived in. `color-mix`
 *  rather than string surgery: the ramp is authored in oklch and canvas has no
 *  opinion about how a colour was spelled, so mixing towards transparent is the
 *  one form that works for every token in the theme. */
function withAlpha(colour: string, alpha: number): string {
  return `color-mix(in oklab, ${colour} ${Math.round(Math.max(0, Math.min(1, alpha)) * 100)}%, transparent)`;
}
