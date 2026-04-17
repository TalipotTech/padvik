"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, RotateCcw, Maximize2 } from "lucide-react";

/**
 * Fullscreen image lightbox with:
 * - Navigation: ←/→ arrows, swipe
 * - Zoom: +/- keys, mouse wheel, pinch
 * - Rotate: R key, button (90° increments)
 * - Esc to close, click outside to close
 */
export function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Reset transform when navigating between images
  const resetTransform = useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  const prev = useCallback(() => {
    if (index > 0) {
      setIndex((i) => i - 1);
      resetTransform();
    }
  }, [index, resetTransform]);

  const next = useCallback(() => {
    if (index < images.length - 1) {
      setIndex((i) => i + 1);
      resetTransform();
    }
  }, [index, images.length, resetTransform]);

  const zoomIn = useCallback(() => setScale((s) => Math.min(s + 0.25, 5)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(s - 0.25, 0.25)), []);
  const rotateCW = useCallback(() => setRotation((r) => (r + 90) % 360), []);
  const rotateCCW = useCallback(() => setRotation((r) => (r - 90 + 360) % 360), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape": onClose(); break;
        case "ArrowRight": next(); break;
        case "ArrowLeft": prev(); break;
        case "+":
        case "=": zoomIn(); break;
        case "-":
        case "_": zoomOut(); break;
        case "r":
        case "R": rotateCW(); break;
        case "0": resetTransform(); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, next, prev, zoomIn, zoomOut, rotateCW, resetTransform]);

  // Mouse wheel zoom
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }

  // Drag to pan when zoomed in
  function handleMouseDown(e: React.MouseEvent) {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  if (images.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 select-none"
      onClick={onClose}
      onWheel={handleWheel}
    >
      {/* Top toolbar */}
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 backdrop-blur rounded-full px-2 py-1 z-20"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={zoomOut}
          className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          title="Zoom out (-)"
          aria-label="Zoom out"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
        <span className="text-white/80 text-xs tabular-nums min-w-[3.5rem] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={zoomIn}
          className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <div className="w-px h-5 bg-white/20 mx-1" />
        <button
          onClick={rotateCCW}
          className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          title="Rotate left"
          aria-label="Rotate left"
        >
          <RotateCcw className="h-5 w-5" />
        </button>
        <button
          onClick={rotateCW}
          className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          title="Rotate right (R)"
          aria-label="Rotate right"
        >
          <RotateCw className="h-5 w-5" />
        </button>
        <div className="w-px h-5 bg-white/20 mx-1" />
        <button
          onClick={resetTransform}
          className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          title="Reset (0)"
          aria-label="Reset"
        >
          <Maximize2 className="h-5 w-5" />
        </button>
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white z-20 rounded-full p-2 bg-black/60 backdrop-blur hover:bg-black/80 transition-colors"
        title="Close (Esc)"
        aria-label="Close"
      >
        <X className="h-6 w-6" />
      </button>

      {/* Counter */}
      {images.length > 1 && (
        <div className="absolute top-4 left-4 text-white/80 text-sm bg-black/60 backdrop-blur rounded-full px-3 py-1.5 z-10">
          {index + 1} / {images.length}
        </div>
      )}

      {/* Previous button */}
      {index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); prev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white z-10 rounded-full p-2 bg-black/60 backdrop-blur hover:bg-black/80 transition-colors"
          title="Previous (←)"
          aria-label="Previous image"
        >
          <ChevronLeft className="h-8 w-8" />
        </button>
      )}

      {/* Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[index]}
        alt=""
        className="max-h-[85vh] max-w-[85vw] object-contain rounded-lg transition-transform duration-150"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
          transformOrigin: "center center",
          cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        draggable={false}
      />

      {/* Next button */}
      {index < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white z-10 rounded-full p-2 bg-black/60 backdrop-blur hover:bg-black/80 transition-colors"
          title="Next (→)"
          aria-label="Next image"
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      )}

      {/* Keyboard hints */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-[10px] select-none pointer-events-none">
        ← → navigate · +/- zoom · R rotate · scroll to zoom · Esc close
      </div>
    </div>
  );
}
