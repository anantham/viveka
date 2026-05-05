"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface PanZoomState {
  panX: number;
  panY: number;
  zoom: number;
}

interface UsePanZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  zoomSensitivity?: number;
}

export function usePanZoom(options: UsePanZoomOptions = {}) {
  const { minZoom = 0.15, maxZoom = 3, zoomSensitivity = 0.001 } = options;

  const [state, setState] = useState<PanZoomState>({
    panX: 0,
    panY: 0,
    zoom: 1,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panStateAtStart = useRef({ panX: 0, panY: 0 });

  // Wheel: zoom with Ctrl/Meta held, pan otherwise. Two-finger trackpad
  // swipe fires wheel events with deltaX/deltaY and no modifiers, so this
  // gives natural pan on Mac trackpads. Mouse-wheel (no modifiers) also
  // pans, which is fine — Ctrl/Cmd+wheel is the unambiguous zoom gesture.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const isZoom = e.ctrlKey || e.metaKey;

      if (isZoom) {
        e.preventDefault();
        e.stopPropagation();

        const rect = container.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        setState((prev) => {
          const delta = -e.deltaY * zoomSensitivity;
          const newZoom = Math.min(maxZoom, Math.max(minZoom, prev.zoom * (1 + delta)));
          const scaleFactor = newZoom / prev.zoom;
          const newPanX = cursorX - scaleFactor * (cursorX - prev.panX);
          const newPanY = cursorY - scaleFactor * (cursorY - prev.panY);
          return { panX: newPanX, panY: newPanY, zoom: newZoom };
        });
      } else {
        // Pan via wheel/trackpad. Sign convention: deltaX>0 means content
        // should move LEFT under the cursor (typical trackpad behavior).
        e.preventDefault();
        setState((prev) => ({
          ...prev,
          panX: prev.panX - e.deltaX,
          panY: prev.panY - e.deltaY,
        }));
      }
    },
    [minZoom, maxZoom, zoomSensitivity]
  );

  // Pointer-down pan: middle-click anywhere, OR left-click on empty canvas
  // background (not on a fragment / button / input). Fragments stop
  // propagation in their own handlers so events that reach this listener
  // are background events by default — the closest() check is defensive.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const isMiddle = e.button === 1;
      const isLeft = e.button === 0;
      if (!isMiddle && !isLeft) return;

      if (isLeft) {
        const target = e.target as HTMLElement;
        // Don't pan when the click landed on a fragment or interactive control.
        if (
          target.closest(
            ".group.absolute, button, textarea, input, [data-text-content]"
          )
        ) {
          return;
        }
      }

      e.preventDefault();
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      panStateAtStart.current = { panX: state.panX, panY: state.panY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [state.panX, state.panY]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setState((prev) => ({
      ...prev,
      panX: panStateAtStart.current.panX + dx,
      panY: panStateAtStart.current.panY + dy,
    }));
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (isPanning.current) {
      isPanning.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }, []);

  // Start panning via hand tool drag on empty canvas
  const startCanvasPan = useCallback(
    (e: React.PointerEvent) => {
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      panStateAtStart.current = { panX: state.panX, panY: state.panY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [state.panX, state.panY]
  );

  const resetView = useCallback(() => {
    setState({ panX: 0, panY: 0, zoom: 1 });
  }, []);

  // Fit a content bounding box (in canvas-content coordinates, before pan/zoom)
  // into the viewport, with optional padding. Pan + zoom are computed so the
  // bbox is centered. `maxFitZoom` caps the auto-zoom-in case so a single
  // tiny fragment doesn't fill the whole screen — defaults to 1.5x; the
  // user can still zoom in further manually.
  const fitToBox = useCallback(
    (
      bbox: { minX: number; minY: number; maxX: number; maxY: number },
      viewport: { width: number; height: number },
      paddingFraction = 0.1,
      maxFitZoom = 1.5
    ) => {
      const bboxW = Math.max(1, bbox.maxX - bbox.minX);
      const bboxH = Math.max(1, bbox.maxY - bbox.minY);
      const padX = viewport.width * paddingFraction;
      const padY = viewport.height * paddingFraction;
      const availW = Math.max(1, viewport.width - 2 * padX);
      const availH = Math.max(1, viewport.height - 2 * padY);
      const rawZoom = Math.min(availW / bboxW, availH / bboxH);
      const fitZoom = Math.min(maxFitZoom, Math.min(maxZoom, Math.max(minZoom, rawZoom)));

      // Pan so that the bbox center lands at the viewport center after zoom
      const bboxCenterX = (bbox.minX + bbox.maxX) / 2;
      const bboxCenterY = (bbox.minY + bbox.maxY) / 2;
      const panX = viewport.width / 2 - fitZoom * bboxCenterX;
      const panY = viewport.height / 2 - fitZoom * bboxCenterY;

      setState({ panX, panY, zoom: fitZoom });
    },
    [minZoom, maxZoom]
  );

  // Attach wheel listener with { passive: false } so we can preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  return {
    state,
    containerRef,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
    },
    startCanvasPan,
    resetView,
    fitToBox,
    isPanning,
  };
}
