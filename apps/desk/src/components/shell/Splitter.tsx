import {useCallback, useRef} from 'react';
import type {KeyboardEvent, PointerEvent} from 'react';

type SplitterProps = {
  /** Current width of the panel being resized, in pixels. */
  width: number;
  onResize: (width: number) => void;
  /** Which side of the handle the resized panel sits on. */
  side: 'left' | 'right';
  min?: number;
  max?: number;
  label: string;
};

const DEFAULT_MIN = 200;
const DEFAULT_MAX = 720;

/**
 * A one-pixel drag handle between panels.
 *
 * Pointer capture rather than window listeners: the handle keeps receiving
 * moves even when the cursor outruns it, and releases cleanly if the pointer is
 * cancelled, which window listeners routinely leak.
 */
export function Splitter({
  width,
  onResize,
  side,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
  label,
}: SplitterProps) {
  const origin = useRef<{x: number; width: number} | null>(null);

  const clamp = useCallback(
    function (next: number) {
      return Math.min(Math.max(next, min), max);
    },
    [min, max],
  );

  const handleDown = useCallback(
    function (event: PointerEvent<HTMLDivElement>) {
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = {x: event.clientX, width};
    },
    [width],
  );

  const handleMove = useCallback(
    function (event: PointerEvent<HTMLDivElement>) {
      const start = origin.current;
      if (start === null) return;
      const delta = event.clientX - start.x;
      onResize(clamp(start.width + (side === 'left' ? delta : -delta)));
    },
    [clamp, onResize, side],
  );

  const handleUp = useCallback(function (event: PointerEvent<HTMLDivElement>) {
    origin.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleKey = useCallback(
    function (event: KeyboardEvent<HTMLDivElement>) {
      const step = event.shiftKey ? 40 : 8;
      if (event.key === 'ArrowLeft') onResize(clamp(width + (side === 'left' ? -step : step)));
      if (event.key === 'ArrowRight') onResize(clamp(width + (side === 'left' ? step : -step)));
    },
    [clamp, onResize, side, width],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onKeyDown={handleKey}
      className="group relative w-px shrink-0 cursor-col-resize bg-ink-800 outline-none"
    >
      {/* A wider invisible target: one pixel is the look, not the hit area. */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <div className="absolute inset-y-0 left-0 w-px bg-accent opacity-0 transition-opacity duration-100 group-hover:opacity-60 group-focus:opacity-100" />
    </div>
  );
}
