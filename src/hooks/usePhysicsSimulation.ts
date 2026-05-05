import { useRef, useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Position { x: number; y: number }

interface PhysicsNode {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  pinned: boolean;
}

export interface MergeCandidateInfo {
  draggedId: string;
  targetId: string;
  angle: number; // radians, atan2(dy, dx) from dragged→target
}

export interface UsePhysicsSimulationOptions {
  /** All visible fragment ids */
  nodeIds: string[];
  /** Persisted positions to seed from on mount */
  initialPositions: Record<string, Position>;
  /** Dagre-computed rest positions (updated each layout) */
  dagrePositions: Record<string, Position>;
  /** Visible edges for spring forces */
  edges: Array<{ from: string; to: string }>;
  /** Returns node bounding box for a given id */
  nodeSize: (id: string) => { w: number; h: number };
  /** Currently dragged node (pinned in simulation) */
  pinnedId: string | null;
  /** Current manual position of pinned node (so collision can be checked) */
  pinnedPosition: Position | null;
  /** Called when simulation sleeps (stabilized) */
  onStabilize?: (positions: Record<string, Position>) => void;
  /** Called when dragged node overlaps another long enough */
  onMergeCandidate?: (info: MergeCandidateInfo) => void;
  /** Called when merge candidate is no longer valid (dragged away) */
  onMergeCancelled?: () => void;
}

export interface UsePhysicsSimulationReturn {
  /** Current physics positions (React state, updates on stabilize + periodically during sim) */
  physicsPositions: Record<string, Position>;
  /** Ref for reading positions without triggering re-render */
  physicsPositionsRef: React.MutableRefObject<Record<string, Position>>;
  /** Inject velocity on a node (e.g. after drag release) */
  inject: (id: string, vx: number, vy: number) => void;
  /** Wake the simulation (restart RAF loop) */
  wake: () => void;
  /** Remove a node from the simulation */
  killNode: (id: string) => void;
  /** Whether the simulation is currently running */
  isAwake: boolean;
  /** Pin a node's rest position to where the user dropped it */
  pinRestPosition: (id: string, pos: Position) => void;
}

// ---------------------------------------------------------------------------
// Constants — tuned for 10-50 nodes at 60fps
// ---------------------------------------------------------------------------

export const REPULSION_STRENGTH = 80000;
export const MIN_DIST = 30;
export const MAX_REPULSION_DIST = 600;

export const DAGRE_SPRING_K = 0.015;
export const EDGE_SPRING_K = 0.08;
export const EDGE_REST_EXTRA = 60; // extra gap beyond node heights

export const DAMPING = 0.88;
export const SLEEP_THRESHOLD = 0.5;

// Merge collision
export const MERGE_OVERLAP_DIST = 30;
export const MERGE_HYSTERESIS = 50; // must move this far away to cancel

// How often to flush positions to React state during active simulation
const RENDER_FLUSH_INTERVAL = 3; // every N frames

// ---------------------------------------------------------------------------
// Pure force computation (exported for testing)
// ---------------------------------------------------------------------------

export interface SimParticle {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  pinned: boolean;
}

export interface SimEdge { from: string; to: string }

/**
 * Compute one tick of the physics simulation. Mutates particles in place.
 * Returns total kinetic energy.
 */
export function simulateTick(
  particles: SimParticle[],
  dagrePositions: Record<string, Position>,
  edges: SimEdge[],
  nodeSize: (id: string) => { w: number; h: number },
): number {
  const n = particles.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  // 1. Repulsion — two passes:
  //    (a) BBox overlap: when two fragment rendering boxes actually
  //        intersect on the canvas, push apart along the shortest exit
  //        direction proportional to the overlap depth. Center-based
  //        repulsion is insufficient when fragments differ greatly in
  //        height (a 600px-tall completion and a 100px human prompt can
  //        have centers 400px apart while their boxes still overlap).
  //    (b) Center-distance repulsion as before — keeps the field gentle
  //        in the non-overlap regime.
  const BBOX_OVERLAP_FORCE = 1.4;
  const BBOX_OVERLAP_PADDING = 12;
  for (let i = 0; i < n; i++) {
    const a = particles[i];
    const sizeA = nodeSize(a.id);
    for (let j = i + 1; j < n; j++) {
      const b = particles[j];
      const sizeB = nodeSize(b.id);
      const cx = (a.x + sizeA.w / 2) - (b.x + sizeB.w / 2);
      const cy = (a.y + sizeA.h / 2) - (b.y + sizeB.h / 2);
      const halfWSum = sizeA.w / 2 + sizeB.w / 2 + BBOX_OVERLAP_PADDING;
      const halfHSum = sizeA.h / 2 + sizeB.h / 2 + BBOX_OVERLAP_PADDING;
      const overlapX = halfWSum - Math.abs(cx);
      const overlapY = halfHSum - Math.abs(cy);
      // Skip bbox-overlap when either fragment is pinned — that's the
      // user actively dragging, possibly toward a merge. The collision-
      // merge gesture (overlap-and-hold for 2s) MUST be allowed to land
      // bbox-overlap regardless of repulsion. Once user releases (no
      // more pinned particle), at-rest physics kicks in and pushes
      // any leftover overlap apart.
      const eitherPinned = a.pinned || b.pinned;
      if (overlapX > 0 && overlapY > 0 && !eitherPinned) {
        if (overlapX < overlapY) {
          const dirX = cx >= 0 ? 1 : -1;
          const force = overlapX * BBOX_OVERLAP_FORCE;
          fx[i] += force * dirX;
          fx[j] -= force * dirX;
        } else {
          const dirY = cy >= 0 ? 1 : -1;
          const force = overlapY * BBOX_OVERLAP_FORCE;
          fy[i] += force * dirY;
          fy[j] -= force * dirY;
        }
      }
      // Center-distance falloff repulsion (kept for spacing in the
      // non-overlap regime — keeps the layout breathing).
      const dist = Math.sqrt(cx * cx + cy * cy);
      if (dist > MAX_REPULSION_DIST) continue;
      const safeDist = Math.max(dist, MIN_DIST);
      const force = REPULSION_STRENGTH / (safeDist * safeDist);
      const nx = dist > 0 ? cx / dist : (Math.random() - 0.5);
      const ny = dist > 0 ? cy / dist : (Math.random() - 0.5);
      if (!a.pinned) { fx[i] += force * nx; fy[i] += force * ny; }
      if (!b.pinned) { fx[j] -= force * nx; fy[j] -= force * ny; }
    }
  }

  // 2. Dagre spring
  for (let i = 0; i < n; i++) {
    const p = particles[i];
    if (p.pinned) continue;
    const target = dagrePositions[p.id];
    if (!target) continue;
    fx[i] += DAGRE_SPRING_K * (target.x - p.x);
    fy[i] += DAGRE_SPRING_K * (target.y - p.y);
  }

  // 3. Edge springs
  const idIndex = new Map(particles.map((p, i) => [p.id, i]));
  for (const edge of edges) {
    const ai = idIndex.get(edge.from);
    const bi = idIndex.get(edge.to);
    if (ai === undefined || bi === undefined) continue;
    const a = particles[ai];
    const b = particles[bi];
    const sizeA = nodeSize(a.id);
    const sizeB = nodeSize(b.id);
    const restLen = sizeA.h / 2 + sizeB.h / 2 + EDGE_REST_EXTRA;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const safeDist = Math.max(dist, 1);
    const displacement = dist - restLen;
    const force = EDGE_SPRING_K * displacement;
    const nx = dx / safeDist;
    const ny = dy / safeDist;
    if (!a.pinned) { fx[ai] += force * nx; fy[ai] += force * ny; }
    if (!b.pinned) { fx[bi] -= force * nx; fy[bi] -= force * ny; }
  }

  // 4. Integrate + damp
  let totalKE = 0;
  for (let i = 0; i < n; i++) {
    const p = particles[i];
    if (p.pinned) continue;
    p.vx = (p.vx + fx[i]) * DAMPING;
    p.vy = (p.vy + fy[i]) * DAMPING;
    p.x += p.vx;
    p.y += p.vy;
    totalKE += p.vx * p.vx + p.vy * p.vy;
  }

  return totalKE;
}

/** Map angle (radians) to merge type based on approach direction */
export function angleToMergeType(angle: number): "prepend" | "append" | "interleave" | "summarize" {
  const deg = ((angle * 180 / Math.PI) + 360) % 360;
  if (deg < 45 || deg >= 315) return "append";
  if (deg < 135) return "summarize";
  if (deg < 225) return "prepend";
  return "interleave";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePhysicsSimulation(opts: UsePhysicsSimulationOptions): UsePhysicsSimulationReturn {
  const {
    nodeIds,
    initialPositions,
    dagrePositions,
    edges,
    nodeSize,
    pinnedId,
    pinnedPosition,
    onStabilize,
    onMergeCandidate,
    onMergeCancelled,
  } = opts;

  // ---- Refs for simulation state (not React state — updated every frame) ----
  const userRestPositionsRef = useRef<Record<string, Position>>({});
  const particlesRef = useRef<Map<string, PhysicsNode>>(new Map());
  const rafRef = useRef<number | null>(null);
  const awakeRef = useRef(false);
  const frameCountRef = useRef(0);
  const mergeTrackingRef = useRef<{ targetId: string; startedAt: number } | null>(null);
  const mountedRef = useRef(true);

  // ---- React state (updated on sleep + periodic flush) ----
  const [physicsPositions, setPhysicsPositions] = useState<Record<string, Position>>({});
  const [isAwake, setIsAwake] = useState(false);
  const physicsPositionsRef = useRef<Record<string, Position>>({});

  // ---- Stable refs for latest props (avoids stale closures in RAF) ----
  const dagreRef = useRef(dagrePositions);
  dagreRef.current = dagrePositions;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const nodeSizeRef = useRef(nodeSize);
  nodeSizeRef.current = nodeSize;
  const pinnedIdRef = useRef(pinnedId);
  pinnedIdRef.current = pinnedId;
  const pinnedPosRef = useRef(pinnedPosition);
  pinnedPosRef.current = pinnedPosition;
  const onStabilizeRef = useRef(onStabilize);
  onStabilizeRef.current = onStabilize;
  const onMergeCandidateRef = useRef(onMergeCandidate);
  onMergeCandidateRef.current = onMergeCandidate;
  const onMergeCancelledRef = useRef(onMergeCancelled);
  onMergeCancelledRef.current = onMergeCancelled;

  // ---- Helpers ----

  const flushToReact = useCallback(() => {
    const snap: Record<string, Position> = {};
    for (const [id, p] of particlesRef.current) {
      snap[id] = { x: p.x, y: p.y };
    }
    physicsPositionsRef.current = snap;
    setPhysicsPositions(snap);
  }, []);

  // ---- Core simulation tick ----

  const tick = useCallback(() => {
    const particles = particlesRef.current;
    const currentEdges = edgesRef.current;
    const getSize = nodeSizeRef.current;
    const currentPinnedId = pinnedIdRef.current;
    const currentPinnedPos = pinnedPosRef.current;

    // Update pinned node position from drag
    if (currentPinnedId && currentPinnedPos) {
      const p = particles.get(currentPinnedId);
      if (p) {
        p.x = currentPinnedPos.x;
        p.y = currentPinnedPos.y;
        p.vx = 0;
        p.vy = 0;
        p.pinned = true;
      }
    }

    // Run force simulation — user drop positions override dagre rest targets
    const effectiveDagre = { ...dagreRef.current, ...userRestPositionsRef.current };
    const particleArray = Array.from(particles.values());
    const totalKE = simulateTick(particleArray, effectiveDagre, currentEdges, getSize);

    // 5. Collision detection for merge (only when dragging)
    if (currentPinnedId && currentPinnedPos) {
      const draggedP = particles.get(currentPinnedId);
      if (draggedP) {
        const draggedSize = getSize(currentPinnedId);
        const dcx = draggedP.x + draggedSize.w / 2;
        const dcy = draggedP.y + draggedSize.h / 2;
        let closestId: string | null = null;
        let closestDist = Infinity;

        for (const [id, p] of particles) {
          if (id === currentPinnedId) continue;
          const s = getSize(id);
          const cx = p.x + s.w / 2;
          const cy = p.y + s.h / 2;
          const dist = Math.sqrt((dcx - cx) ** 2 + (dcy - cy) ** 2);
          if (dist < closestDist) {
            closestDist = dist;
            closestId = id;
          }
        }

        const tracking = mergeTrackingRef.current;
        if (closestId && closestDist < MERGE_OVERLAP_DIST) {
          if (!tracking || tracking.targetId !== closestId) {
            mergeTrackingRef.current = { targetId: closestId, startedAt: Date.now() };
          }
          // Timer check happens in the WorkspaceCanvas effect, not here
          // We just report the candidate
          const target = particles.get(closestId)!;
          const ts = getSize(closestId);
          const angle = Math.atan2(
            (target.y + ts.h / 2) - dcy,
            (target.x + ts.w / 2) - dcx
          );
          onMergeCandidateRef.current?.({
            draggedId: currentPinnedId,
            targetId: closestId,
            angle,
          });
        } else if (tracking && closestDist > MERGE_HYSTERESIS) {
          mergeTrackingRef.current = null;
          onMergeCancelledRef.current?.();
        }
      }
    } else {
      // Not dragging — clear any merge tracking
      if (mergeTrackingRef.current) {
        mergeTrackingRef.current = null;
        onMergeCancelledRef.current?.();
      }
    }

    // 6. Flush to React periodically during active sim
    frameCountRef.current++;
    if (frameCountRef.current % RENDER_FLUSH_INTERVAL === 0) {
      flushToReact();
    }

    // 7. Sleep check
    if (totalKE < SLEEP_THRESHOLD && !currentPinnedId) {
      awakeRef.current = false;
      setIsAwake(false);
      flushToReact();
      rafRef.current = null;
      onStabilizeRef.current?.(physicsPositionsRef.current);
      return;
    }

    // Continue loop
    if (mountedRef.current) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [flushToReact]);

  // ---- Start/stop the RAF loop ----

  const startLoop = useCallback(() => {
    if (awakeRef.current) return;
    awakeRef.current = true;
    setIsAwake(true);
    frameCountRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stopLoop = useCallback(() => {
    awakeRef.current = false;
    setIsAwake(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ---- Public API ----

  const wake = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const inject = useCallback((id: string, vx: number, vy: number) => {
    const p = particlesRef.current.get(id);
    if (p) {
      p.vx += vx;
      p.vy += vy;
      p.pinned = false;
    }
    wake();
  }, [wake]);

  const killNode = useCallback((id: string) => {
    particlesRef.current.delete(id);
    delete userRestPositionsRef.current[id];
  }, []);

  const pinRestPosition = useCallback((id: string, pos: Position) => {
    userRestPositionsRef.current[id] = pos;
  }, []);

  // ---- Sync particles with nodeIds + positions ----

  useEffect(() => {
    const particles = particlesRef.current;
    const currentIds = new Set(nodeIds);

    // Remove particles no longer in nodeIds
    for (const id of particles.keys()) {
      if (!currentIds.has(id)) particles.delete(id);
    }

    // Add new particles (seed from initial → dagre → origin)
    let addedNew = false;
    for (const id of nodeIds) {
      if (!particles.has(id)) {
        const pos = initialPositions[id] || dagrePositions[id] || { x: 0, y: 0 };
        particles.set(id, {
          id,
          x: pos.x, y: pos.y,
          vx: 0, vy: 0,
          pinned: false,
        });
        addedNew = true;
      }
    }

    // Always wake when new nodes appear so they settle properly
    if (addedNew) {
      requestAnimationFrame(() => {
        if (mountedRef.current) wake();
      });
    }
  }, [nodeIds, initialPositions, dagrePositions, wake]);

  // ---- Wake when dagre positions change (e.g. semantic zoom) ----

  const prevDagreRef = useRef(dagrePositions);
  useEffect(() => {
    if (prevDagreRef.current !== dagrePositions) {
      prevDagreRef.current = dagrePositions;
      if (particlesRef.current.size > 0) wake();
    }
  }, [dagrePositions, wake]);

  // ---- Handle pinned state changes ----

  useEffect(() => {
    const particles = particlesRef.current;
    // Unpin all first
    for (const p of particles.values()) {
      p.pinned = false;
    }
    // Pin the dragged node
    if (pinnedId) {
      const p = particles.get(pinnedId);
      if (p) p.pinned = true;
      // Wake sim so other nodes react to the drag
      wake();
    }
  }, [pinnedId, wake]);

  // ---- Cleanup on unmount ----

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return {
    physicsPositions,
    physicsPositionsRef,
    inject,
    wake,
    killNode,
    isAwake,
    pinRestPosition,
  };
}
