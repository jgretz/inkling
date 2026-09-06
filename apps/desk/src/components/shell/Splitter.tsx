import {useCallback, useRef} from 'react';
import type {KeyboardEvent, PointerEvent} from 'react';

/**
 * Which side of the handle the thing being resized sits on.
 *
 * It carries the axis with it: left and right make a vertical bar dragged
 * sideways, top and bottom a horizontal bar dragged up and down.
 */
export type SplitterSide = 'left' | 'right' | 'top' | 'bottom';

type SplitterProps = {
  /** Current size of the panel being resized, in pixels. */
  size: number;
  onResize: (size: number) => void;
  side: SplitterSide;
  min?: number;
  max?: number;
  label: string;
};

const DEFAULT_MIN = 200;
const DEFAULT_MAX = 720;

/**
 * A one-pixel drag handle between panels, on either axis.
 *
 * Pointer capture rather than window listeners: the handle keeps receiving
 * moves even when the cursor outruns it, and releases cleanly if the pointer is
 * cancelled, which window listeners routinely leak.
 *
 * The handle sits on the edge its panel grows from, which is why the composer's
 * is above it rather than a corner grip below. A grip at the bottom of
 * something already at the bottom of the window grows it in the one direction
 * there is no room to grow.
 */
export function Splitter({
  size,
  onResize,
  side,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
  label,
}: SplitterProps) {
  const origin = useRef<{along: number; size: number} | null>(null);
  const horizontal = side === 'left' || side === 'right';
  // Dragging away from the panel grows it: rightwards for a panel on the left,
  // upwards for one below.
  const grows = side === 'left' || side === 'top' ? 1 : -1;

  const clamp = useCallback(
    function (next: number) {
      return Math.min(Math.max(next, min), max);
    },
    [min, max],
  );

  const along = useCallback(
    function (event: PointerEvent<HTMLDivElement>) {
      return horizontal ? event.clientX : event.clientY;
    },
    [horizontal],
  );

  const handleDown = useCallback(
    function (event: PointerEvent<HTMLDivElement>) {
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = {along: along(event), size};
    },
    [along, size],
  );

  const handleMove = useCallback(
    function (event: PointerEvent<HTMLDivElement>) {
      const start = origin.current;
      if (start === null) return;
      onResize(clamp(start.size + (along(event) - start.along) * grows));
    },
    [along, clamp, grows, onResize],
  );

  const handleUp = useCallback(function (event: PointerEvent<HTMLDivElement>) {
    origin.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleKey = useCallback(
    function (event: KeyboardEvent<HTMLDivElement>) {
      const step = event.shiftKey ? 40 : 8;
      const [back, forward] = horizontal
        ? (['ArrowLeft', 'ArrowRight'] as const)
        : (['ArrowUp', 'ArrowDown'] as const);
      if (event.key === back) onResize(clamp(size - step * grows));
      if (event.key === forward) onResize(clamp(size + step * grows));
    },
    [clamp, grows, horizontal, onResize, size],
  );

  return (
    <div
      role="separator"
      // A separator's orientation is the line it draws, not the axis it travels
      // along, so a handle dragged sideways is a vertical one.
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onKeyDown={handleKey}
      className={`group relative shrink-0 bg-ink-800 outline-none ${
        horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
      }`}
    >
      {/* A wider invisible target: one pixel is the look, not the hit area. */}
      <div
        className={
          horizontal
            ? 'absolute inset-y-0 -left-1.5 -right-1.5'
            : 'absolute inset-x-0 -top-1.5 -bottom-1.5'
        }
      />
      <div
        className={`absolute bg-accent opacity-0 transition-opacity duration-100 group-hover:opacity-60 group-focus:opacity-100 ${
          horizontal ? 'inset-y-0 left-0 w-px' : 'inset-x-0 top-0 h-px'
        }`}
      />
    </div>
  );
}
