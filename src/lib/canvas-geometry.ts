/**
 * Pure geometry helpers extracted from WorkspaceCanvas.
 *
 * These three computations were inline useMemos in the canvas
 * component, where they couldn't be unit-tested in isolation
 * (positions and sizes came from physics + dagre runtime state).
 * Lifting them to module scope means we can feed in synthetic
 * positions and assert exact outputs.
 *
 * No React, no DOM. Inputs are positions / sizes / content;
 * outputs are plain data.
 */

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// snapToInsertionBoundary
// ---------------------------------------------------------------------------

/**
 * Snap a raw character offset to the nearest sane insertion point in
 * `text`. Preference order: paragraph break (\n\n) within a window,
 * then sentence end, then word boundary. Falls back to the raw offset.
 * Used by precision-insert mode so the splice lands between paragraphs
 * / sentences rather than mid-word.
 */
export function snapToInsertionBoundary(text: string, pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= text.length) return text.length;

  // 1. paragraph break (\n\n)
  const PARA_WINDOW = 60;
  let bestPara = -1;
  let bestParaDist = Infinity;
  for (let i = Math.max(0, pos - PARA_WINDOW); i <= Math.min(text.length - 2, pos + PARA_WINDOW); i++) {
    if (text[i] === "\n" && text[i + 1] === "\n") {
      const offset = i + 2;
      const dist = Math.abs(offset - pos);
      if (dist < bestParaDist) {
        bestParaDist = dist;
        bestPara = offset;
      }
    }
  }
  if (bestPara !== -1) return bestPara;

  // 2. sentence end (. ! ? followed by whitespace)
  const SENT_WINDOW = 30;
  let bestSent = -1;
  let bestSentDist = Infinity;
  for (const m of text.matchAll(/[.!?]\s+/g)) {
    const end = (m.index ?? 0) + m[0].length;
    const dist = Math.abs(end - pos);
    if (dist <= SENT_WINDOW && dist < bestSentDist) {
      bestSentDist = dist;
      bestSent = end;
    }
  }
  if (bestSent !== -1) return bestSent;

  // 3. word boundary
  const WORD_WINDOW = 20;
  for (let i = pos; i >= Math.max(0, pos - WORD_WINDOW); i--) {
    if (/\s/.test(text[i])) return i + 1;
  }
  for (let i = pos; i <= Math.min(text.length - 1, pos + WORD_WINDOW); i++) {
    if (/\s/.test(text[i])) return i + 1;
  }
  return pos;
}

// ---------------------------------------------------------------------------
// computeMergeIntent
// ---------------------------------------------------------------------------

export type MergeType = "prepend" | "append" | "interleave" | "summarize" | "insert";

export interface MergeIntent {
  mergeType: MergeType;
  insertOffset?: number;
}

/**
 * Given the dragged + target fragments' bboxes, decide which merge
 * mode the gesture should fire and (for insert) which character offset
 * the splice should land at.
 *
 * Vertical position of A's center within B's bbox is the determinant:
 *   above target           → SUMMARIZE
 *   top edge   (≤15%)      → PREPEND
 *   body       (15..85%)   → INSERT @ char offset (snapped)
 *   bottom edge (≥85%)     → APPEND
 *   below target           → INTERLEAVE
 */
export function computeMergeIntent(args: {
  draggedPos: Position;
  draggedSize: Size;
  targetPos: Position;
  targetSize: Size;
  targetContent: string;
}): MergeIntent {
  const { draggedPos, draggedSize, targetPos, targetSize, targetContent } = args;
  const draggedCenterY = draggedPos.y + draggedSize.h / 2;
  const t = (draggedCenterY - targetPos.y) / Math.max(1, targetSize.h);

  if (t < 0) return { mergeType: "summarize" };
  if (t < 0.15) return { mergeType: "prepend" };
  if (t > 1) return { mergeType: "interleave" };
  if (t > 0.85) return { mergeType: "append" };

  if (targetContent.length === 0) return { mergeType: "prepend" };
  const fraction = (t - 0.15) / 0.7;
  const rawOffset = Math.round(Math.max(0, Math.min(1, fraction)) * targetContent.length);
  const offset = snapToInsertionBoundary(targetContent, rawOffset);
  return { mergeType: "insert", insertOffset: offset };
}

// ---------------------------------------------------------------------------
// computeEffectiveWidths
// ---------------------------------------------------------------------------

export interface FragmentBox {
  id: string;
  pos: Position;
  height: number;
}

/**
 * For each fragment, compute the visible text-column width allowing
 * for left/right encroachment by neighbors that overlap vertically.
 *
 * Algorithm: each fragment has a canonical baseWidth column. For each
 * other fragment that vertically overlaps, check whether its
 * horizontal silhouette intrudes into the column on the left or
 * right. Subtract the deepest intrusion on each side from baseWidth,
 * floored at minWidth.
 *
 * Pure function — fragments come pre-resolved with positions +
 * heights (computed from DOM measurement or estimator at the call
 * site). No physics/dagre coupling.
 */
export function computeEffectiveWidths(args: {
  fragments: FragmentBox[];
  baseWidth: number;
  minWidth: number;
}): Record<string, number> {
  const { fragments, baseWidth, minWidth } = args;
  const out: Record<string, number> = {};
  for (const a of fragments) {
    const aTop = a.pos.y;
    const aBottom = a.pos.y + a.height;
    const aLeft = a.pos.x;
    const aRight = a.pos.x + baseWidth;
    let leftEnc = 0;
    let rightEnc = 0;
    for (const b of fragments) {
      if (b.id === a.id) continue;
      const bTop = b.pos.y;
      const bBottom = b.pos.y + b.height;
      // Vertical overlap is required for horizontal encroachment to matter
      if (bBottom <= aTop || bTop >= aBottom) continue;
      const bLeft = b.pos.x;
      const bRight = b.pos.x + baseWidth;
      // Right-side encroachment: B's left edge has crossed into A's column.
      if (bLeft > aLeft && bLeft < aRight) {
        rightEnc = Math.max(rightEnc, aRight - bLeft);
      }
      // Left-side encroachment: B's right edge has crossed into A's column.
      if (bRight > aLeft && bRight < aRight) {
        leftEnc = Math.max(leftEnc, bRight - aLeft);
      }
    }
    out[a.id] = Math.max(minWidth, baseWidth - leftEnc - rightEnc);
  }
  return out;
}

// ---------------------------------------------------------------------------
// computeProximityPairs
// ---------------------------------------------------------------------------

export interface ProximityPair {
  a: string;
  b: string;
  dist: number;
  intensity: number;
}

/**
 * Pairs of fragments within `rFlow` of each other, with an intensity
 * value that ramps from 0 at the rFlow boundary to 1 at rMerge.
 *
 * The visual cue this drives is the proximity gradient — the first
 * phase transition before the merge gesture is primed. Pure render
 * signal, no physics here.
 */
export function computeProximityPairs(args: {
  fragments: FragmentBox[];
  baseWidth: number;
  rFlow: number;
  rMerge: number;
}): ProximityPair[] {
  const { fragments, baseWidth, rFlow, rMerge } = args;
  const pairs: ProximityPair[] = [];
  for (let i = 0; i < fragments.length; i++) {
    for (let j = i + 1; j < fragments.length; j++) {
      const a = fragments[i];
      const b = fragments[j];
      const cxA = a.pos.x + baseWidth / 2;
      const cyA = a.pos.y + a.height / 2;
      const cxB = b.pos.x + baseWidth / 2;
      const cyB = b.pos.y + b.height / 2;
      const dx = cxA - cxB;
      const dy = cyA - cyB;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < rFlow) {
        const intensity = Math.min(1, Math.max(0, (rFlow - dist) / Math.max(1, rFlow - rMerge)));
        pairs.push({ a: a.id, b: b.id, dist, intensity });
      }
    }
  }
  return pairs;
}
