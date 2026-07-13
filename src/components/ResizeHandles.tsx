'use client';

/** Which edge/corner of a card is being dragged to change its grid span. */
export type ResizeEdge = 'right' | 'bottom' | 'corner';

interface Props {
  /** Begin a span-resize drag from the given edge. */
  onResize: (edge: ResizeEdge, e: React.PointerEvent) => void;
}

/**
 * The right / bottom / corner drag handles a card exposes to resize its grid span. Left/top are
 * omitted deliberately: cards flow in order, so a card can only grow to the right and down, not
 * move its top-left origin. Handles fade in on card hover (see the `group/card` parent).
 */
export default function ResizeHandles({ onResize }: Props) {
  return (
    <>
      <div
        onPointerDown={(e) => onResize('right', e)}
        className="absolute right-0 top-0 flex h-full w-2.5 cursor-col-resize touch-none items-center justify-center opacity-0 transition-opacity group-hover/card:opacity-100"
        aria-hidden
      >
        <span className="h-10 w-1 rounded-full bg-border" />
      </div>
      <div
        onPointerDown={(e) => onResize('bottom', e)}
        className="absolute bottom-0 left-0 flex h-2.5 w-full cursor-row-resize touch-none items-center justify-center opacity-0 transition-opacity group-hover/card:opacity-100"
        aria-hidden
      >
        <span className="h-1 w-10 rounded-full bg-border" />
      </div>
      <div
        onPointerDown={(e) => onResize('corner', e)}
        className="absolute bottom-0 right-0 z-10 flex h-4 w-4 cursor-nwse-resize touch-none items-end justify-end p-0.5 opacity-0 transition-opacity group-hover/card:opacity-100"
        aria-hidden
      >
        <span className="h-2 w-2 rounded-sm border-b-2 border-r-2 border-border" />
      </div>
    </>
  );
}
