"use client";

import { useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCw } from "lucide-react";

interface ImageZoomProps {
  src: string;
  alt?: string;
}

export function ImageZoom({ src, alt }: ImageZoomProps) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  function zoomIn() {
    setScale((s) => Math.min(s + 0.25, 3));
  }
  function zoomOut() {
    setScale((s) => Math.max(s - 0.25, 0.5));
  }
  function rotate() {
    setRotation((r) => (r + 90) % 360);
  }
  function reset() {
    setScale(1);
    setRotation(0);
  }

  return (
    <>
      <figure className="my-4">
        <div
          className="group relative cursor-pointer overflow-hidden rounded-lg border"
          onClick={() => setOpen(true)}
        >
          <img
            src={src}
            alt={alt ?? ""}
            className="block max-w-full mx-auto transition-transform duration-200 group-hover:scale-[1.02]"
            loading="lazy"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/20">
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 shadow-lg">
              <ZoomIn className="h-4 w-4" />
              Click to zoom
            </span>
          </div>
        </div>
        {alt && (
          <figcaption className="mt-1 text-center text-xs text-muted-foreground italic">
            {alt}
          </figcaption>
        )}
      </figure>

      {/* Fullscreen overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
          onClick={() => { setOpen(false); reset(); }}
        >
          {/* Controls */}
          <div
            className="absolute top-4 right-4 flex items-center gap-2 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={zoomOut}
              className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <span className="text-white text-sm tabular-nums min-w-[3rem] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <button
              onClick={rotate}
              className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
              aria-label="Rotate"
            >
              <RotateCw className="h-5 w-5" />
            </button>
            <button
              onClick={() => { setOpen(false); reset(); }}
              className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Image */}
          <div
            className="max-h-[90vh] max-w-[90vw] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={src}
              alt={alt ?? ""}
              className="transition-transform duration-200"
              style={{
                transform: `scale(${scale}) rotate(${rotation}deg)`,
                transformOrigin: "center center",
              }}
            />
          </div>

          {/* Caption */}
          {alt && (
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm bg-black/40 px-4 py-1 rounded-full">
              {alt}
            </p>
          )}
        </div>
      )}
    </>
  );
}
