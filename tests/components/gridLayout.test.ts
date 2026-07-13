import { describe, it, expect } from 'vitest';
import { packRanks, insertIndexForDrag, resolveDragCell, type SpanItem, type Cell } from '@/components/gridLayout';

const item = (id: string, w = 1, h = 1): SpanItem => ({ id, w, h });

describe('packRanks', () => {
  it('lays 1x1 cards out in reading order, wrapping by column count', () => {
    const ranks = packRanks([item('a'), item('b'), item('c'), item('d')], 3);
    expect(ranks.get('a')).toBe(0); // row0 col0
    expect(ranks.get('b')).toBe(1); // row0 col1
    expect(ranks.get('c')).toBe(2); // row0 col2
    expect(ranks.get('d')).toBe(3); // row1 col0
  });

  it('leaves a gap (non-dense) when a wide card cannot finish the row', () => {
    // A is 2 wide (cols 0-1); B is 2 wide and cannot fit in the lone remaining col 2,
    // so it wraps to row1 — col2 of row0 stays empty rather than being back-filled.
    const ranks = packRanks([item('a', 2, 1), item('b', 2, 1)], 3);
    expect(ranks.get('a')).toBe(0); // row0 col0
    expect(ranks.get('b')).toBe(3); // row1 col0 (col2 left empty)
  });

  it('routes later cards around a tall card that occupies lower rows', () => {
    // cols=2. A is 1x2 (occupies (0,0) and (1,0)). Subsequent cards must skip (1,0).
    const ranks = packRanks([item('a', 1, 2), item('b'), item('c'), item('d')], 2);
    expect(ranks.get('a')).toBe(0); // (0,0)
    expect(ranks.get('b')).toBe(1); // (0,1)
    expect(ranks.get('c')).toBe(3); // (1,1) — (1,0) is under A
    expect(ranks.get('d')).toBe(4); // (2,0)
  });

  it('clamps a card wider than the grid to the column count', () => {
    const ranks = packRanks([item('a', 5, 1), item('b')], 3);
    expect(ranks.get('a')).toBe(0);
    expect(ranks.get('b')).toBe(3); // A filled the whole first row
  });
});

describe('resolveDragCell', () => {
  // cellW=100, cellH=200, cols=3. Hysteresis margin: 30px horizontal, 60px vertical.
  const W = 100;
  const H = 200;
  const at = (x: number, y: number, prev: Cell | null) => resolveDragCell(x, y, W, H, 3, prev);

  it('maps a point straight to its cell when there is no previous cell', () => {
    expect(at(150, 250, null)).toEqual({ row: 1, col: 1 });
    expect(at(0, 0, null)).toEqual({ row: 0, col: 0 });
  });

  it('clamps to the grid bounds', () => {
    expect(at(-50, -50, null)).toEqual({ row: 0, col: 0 });
    expect(at(9999, 250, null)).toEqual({ row: 1, col: 2 });
  });

  it('keeps the previous cell for small wobble across a row boundary (hysteresis)', () => {
    // Row 0/1 boundary at y=200. y=230 is past it, but within the 60px margin: stay in row 0.
    const prev: Cell = { row: 0, col: 1 };
    expect(at(150, 230, prev)).toEqual({ row: 0, col: 1 });
    // Wobbling back above the boundary also stays put.
    expect(at(150, 190, prev)).toEqual({ row: 0, col: 1 });
  });

  it('re-targets once the cursor moves decisively into the next row', () => {
    const prev: Cell = { row: 0, col: 1 };
    expect(at(150, 270, prev)).toEqual({ row: 1, col: 1 }); // 70px past the boundary > 60 margin
  });

  it('applies hysteresis per axis (columns too)', () => {
    const prev: Cell = { row: 0, col: 1 };
    expect(at(220, 100, prev)).toEqual({ row: 0, col: 1 }); // 20px past col boundary < 30 margin
    expect(at(240, 100, prev)).toEqual({ row: 0, col: 2 }); // 40px past: re-target
  });

  it('adopts the raw cell immediately on a large jump', () => {
    const prev: Cell = { row: 0, col: 0 };
    expect(at(250, 450, prev)).toEqual({ row: 2, col: 2 });
  });
});

describe('insertIndexForDrag', () => {
  it('matches simple cell insertion for a 1x1 dragged card', () => {
    const others = [item('a'), item('b'), item('c')];
    expect(insertIndexForDrag(others, { w: 1, h: 1 }, 3, 0)).toBe(0);
    expect(insertIndexForDrag(others, { w: 1, h: 1 }, 3, 1)).toBe(1);
    expect(insertIndexForDrag(others, { w: 1, h: 1 }, 3, 2)).toBe(2);
    expect(insertIndexForDrag(others, { w: 1, h: 1 }, 3, 99)).toBe(3);
  });

  it('lands a tall dragged card under the target cell using the full (rendered) layout', () => {
    // cols=2, others a,b (1x1), dragging a 1x2 card. Full-layout drag ranks by index: 0,1,2.
    const others = [item('a'), item('b')];
    const drag = { w: 1, h: 2 };
    expect(insertIndexForDrag(others, drag, 2, 0)).toBe(0);
    expect(insertIndexForDrag(others, drag, 2, 1)).toBe(1);
    expect(insertIndexForDrag(others, drag, 2, 2)).toBe(2);
  });

  it('is a stable function of the target cell (no oscillation)', () => {
    const others = [item('a'), item('b'), item('c'), item('d')];
    const drag = { w: 2, h: 1 };
    for (const rank of [0, 1, 2, 3, 4, 5, 6]) {
      const first = insertIndexForDrag(others, drag, 3, rank);
      const second = insertIndexForDrag(others, drag, 3, rank);
      expect(second).toBe(first);
    }
  });
});
