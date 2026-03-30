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

  // Zoom toward cursor position
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Only zoom with Ctrl/Meta held
      if (!e.ctrlKey && !e.metaKey) return;

      e.preventDefault();
      e.stopPropagation();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      // Cursor position relative to the container
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      setState((prev) => {
        const delta = -e.deltaY * zoomSensitivity;
        const newZoom = Math.min(maxZoom, Math.max(minZoom, prev.zoom * (1 + delta)));
        const scaleFactor = newZoom / prev.zoom;

        // Adjust pan so the point under the cursor stays fixed
        const newPanX = cursorX - scaleFactor * (cursorX - prev.panX);
        const newPanY = cursorY - scaleFactor * (cursorY - prev.panY);

        return { panX: newPanX, panY: newPanY, zoom: newZoom };
      });
    },
    [minZoom, maxZoom, zoomSensitivity]
  );

  // Middle-click or Space+click to pan
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Middle mouse button (button 1)
      if (e.button === 1) {
        e.preventDefault();
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY };
        panStateAtStart.current = { panX: state.panX, panY: state.panY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
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
    isPanning,
  };
}
