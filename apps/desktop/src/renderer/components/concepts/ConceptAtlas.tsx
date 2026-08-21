import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AtlasConcept } from "../../../shared/api";
import { resolveMasteryRamp, resolveToken } from "@/lib/mastery";
import { edges, galaxy, planets, type AtlasEdge, type AtlasNode, type AtlasSystem } from "./atlas";

/** Camera distance in world units, and the focal length as a multiple of the
 *  viewport's short side. Together they set two things: how big the galaxy is —
 *  the outermost system lands at about a third of the short side, so the disc
 *  fills the pane without touching it — and how much perspective there is. At
 *  this pair a planet at the front of a system is about 40% larger than the same
 *  planet at the back, which is enough to read depth and little enough that the
 *  outer systems do not fisheye. */
const CAMERA = 3.1;
const FOCAL = 1.45;
/** Radians per second of idle drift. Slow enough to be a drift rather than a
 *  carousel: this is something you read, and text that moves is text you cannot
 *  read. */
const DRIFT = 0.05;

type Props = {
  concepts: AtlasConcept[];
  selectedId: string | null;
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
export function ConceptAtlas({ concepts, selectedId, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hovered, setHovered] = useState<AtlasConcept | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const systems = useMemo(() => galaxy(concepts), [concepts]);
  const nodes = useMemo(() => planets(systems), [systems]);
  const links = useMemo(() => edges(nodes), [nodes]);

  /* Everything the frame loop mutates lives in refs. State here would mean a
     React render per frame at 60fps, and a render per frame is how a canvas
     animation ends up costing more than the app around it. */
  const camera = useRef({ yaw: 0.6, pitch: -0.5, targetYaw: 0.6, targetPitch: -0.5 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const projected = useRef<Array<{ node: AtlasNode; x: number; y: number }>>([]);
  const hoveredIndex = useRef<number | null>(null);
  const systemsRef = useRef<AtlasSystem[]>(systems);
  const nodesRef = useRef<AtlasNode[]>(nodes);
  const linksRef = useRef<AtlasEdge[]>(links);
  const selectedRef = useRef<string | null>(selectedId);

  systemsRef.current = systems;
  nodesRef.current = nodes;
  linksRef.current = links;
  selectedRef.current = selectedId;

  /* Turns the selected concept's system to the front. The alternative is asking
     the learner to find, in a turning galaxy, the planet they just clicked in a
     list — which is a puzzle, not a navigation. */
  useEffect(() => {
    const node = nodes.find((candidate) => candidate.concept.conceptId === selectedId);
    if (!node) return;
    camera.current.targetYaw = Math.atan2(node.x, node.z);
  }, [nodes, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    /* Read from the live computed style rather than hard-coding: the ramp and the
       ink are theme tokens, and a canvas that keeps its own copy of them is a
       canvas that stays in light mode after the window goes dark. */
    let ramp = resolveMasteryRamp();
    let ink = resolveToken("--foreground") || "#fff";
    let brand = resolveToken("--brand") || "#f59e0b";
    const theme = new MutationObserver(() => {
      ramp = resolveMasteryRamp();
      ink = resolveToken("--foreground") || "#fff";
      brand = resolveToken("--brand") || "#f59e0b";
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

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame = requestAnimationFrame(draw);

      const state = camera.current;
      if (!dragging.current) {
        /* Ease towards the target when there is one, drift when there is not.
           Both go through the same term so a selection made mid-drift arrives
           smoothly rather than snapping out of it. */
        state.yaw += (state.targetYaw - state.yaw) * Math.min(1, delta * 3.4);
        state.pitch += (state.targetPitch - state.pitch) * Math.min(1, delta * 3.4);
        if (Math.abs(state.targetYaw - state.yaw) < 0.002 && !reduced) {
          state.yaw += DRIFT * delta;
          state.targetYaw = state.yaw;
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
      const project = (x: number, y: number, z: number) => {
        const rx = x * cosYaw - z * sinYaw;
        const rz = x * sinYaw + z * cosYaw;
        const ry = y * cosPitch - rz * sinPitch;
        const rzz = y * sinPitch + rz * cosPitch;
        const factor = scale / (rzz + CAMERA);
        return { x: cx + rx * factor, y: cy + ry * factor, depth: rzz };
      };

      context.clearRect(0, 0, width, height);

      /* --- the galactic core ----------------------------------------------
         What every system's distance is measured from. Drawn as light rather
         than as an object: it is the origin, not a thing in the picture. */
      const core = project(0, 0, 0);
      const halo = context.createRadialGradient(core.x, core.y, 0, core.x, core.y, 80);
      halo.addColorStop(0, withAlpha(brand, 0.26));
      halo.addColorStop(0.45, withAlpha(brand, 0.07));
      halo.addColorStop(1, withAlpha(brand, 0));
      context.fillStyle = halo;
      context.beginPath();
      context.arc(core.x, core.y, 80, 0, Math.PI * 2);
      context.fill();

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

        for (const orbit of new Set(system.nodes.map((node) => node.orbit))) {
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
           so a topic's state is legible from the star alone. */
        const heat = ramp[system.reach] ?? brand;
        const size = (2.6 + system.reach * 0.45) * (CAMERA / (depth + CAMERA));
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

        /* The topics are the one label always worth printing: there is a handful
           of them, they are short, and they are the level at which anybody first
           scans this. The planets stay silent until hovered — a concept title is
           a sentence, and a sentence per planet is a page of text pretending to
           be a picture. */
        context.font = "600 9.5px -apple-system, BlinkMacSystemFont, sans-serif";
        context.textAlign = "center";
        context.fillStyle = withAlpha(ink, holds ? 0.9 : 0.28 + near * 0.34);
        context.fillText(system.topic.toUpperCase(), x, y - size - 8);
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
        const colour = ramp[level] ?? ink;
        const fog = 0.42 + (1 - (point.depth + 1) / 2) * 0.58;
        const selected = point.node.concept.conceptId === selectedRef.current;
        const isHovered = hoveredIndex.current !== null && points[hoveredIndex.current]?.node === point.node;
        const radius = (2.4 + level * 0.6) * (CAMERA / (point.depth + CAMERA));

        if (level >= 3 || selected || isHovered) {
          const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 5);
          glow.addColorStop(0, withAlpha(colour, 0.42 * fog));
          glow.addColorStop(1, withAlpha(colour, 0));
          context.fillStyle = glow;
          context.beginPath();
          context.arc(point.x, point.y, radius * 5, 0, Math.PI * 2);
          context.fill();
        }

        context.fillStyle = withAlpha(colour, fog);
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

      projected.current = points.map((point) => ({ node: point.node, x: point.x, y: point.y }));
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
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
          dragging.current = { x: event.clientX, y: event.clientY };
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
            camera.current.yaw += (event.clientX - drag.x) * 0.006;
            camera.current.pitch = Math.max(-1.2, Math.min(-0.06, camera.current.pitch + (event.clientY - drag.y) * 0.005));
            camera.current.targetYaw = camera.current.yaw;
            camera.current.targetPitch = camera.current.pitch;
            dragging.current = { x: event.clientX, y: event.clientY };
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
          if (hit) onSelect(projected.current[hit.index]?.node.concept ?? null);
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

/** A colour with an alpha, whatever notation the token arrived in. `color-mix`
 *  rather than string surgery: the ramp is authored in oklch and canvas has no
 *  opinion about how a colour was spelled, so mixing towards transparent is the
 *  one form that works for every token in the theme. */
function withAlpha(colour: string, alpha: number): string {
  return `color-mix(in oklab, ${colour} ${Math.round(Math.max(0, Math.min(1, alpha)) * 100)}%, transparent)`;
}
