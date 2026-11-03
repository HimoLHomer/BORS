import { describe, expect, it } from 'vitest';
import {
  ALLOCATION_DONUT_CENTER,
  ALLOCATION_DONUT_GAP_DEG,
  allocationDonutArcs,
  donutSegmentPath,
  hitTestAllocationDonut,
} from './allocationPieLabels';

describe('allocationDonutArcs', () => {
  it('puts every boundary exactly where the percentages say (gaps are centred on them)', () => {
    const arcs = allocationDonutArcs([{ value: 75 }, { value: 20 }, { value: 5 }]);
    expect(arcs.map((a) => [a.trueStartDeg, a.trueEndDeg])).toEqual([
      [0, 270],
      [270, 342],
      [342, 360],
    ]);
    // A 75% slice spans 3/4 of the circle from gap centre to gap centre.
    expect(arcs[0]!.trueEndDeg - arcs[0]!.trueStartDeg).toBe(270);
  });

  it('takes the same gap from every slice, half at each end', () => {
    const arcs = allocationDonutArcs([{ value: 60 }, { value: 40 }]);
    for (const a of arcs) {
      expect(a.startDeg - a.trueStartDeg).toBeCloseTo(ALLOCATION_DONUT_GAP_DEG / 2);
      expect(a.trueEndDeg - a.endDeg).toBeCloseTo(ALLOCATION_DONUT_GAP_DEG / 2);
    }
  });

  it('keeps drawn arcs in proportion: each loses the same fixed gap, not a share of the circle', () => {
    const arcs = allocationDonutArcs([{ value: 50 }, { value: 30 }, { value: 20 }]);
    const drawn = arcs.map((a) => a.endDeg - a.startDeg);
    expect(drawn[0]).toBeCloseTo(180 - ALLOCATION_DONUT_GAP_DEG);
    expect(drawn[1]).toBeCloseTo(108 - ALLOCATION_DONUT_GAP_DEG);
    expect(drawn[2]).toBeCloseTo(72 - ALLOCATION_DONUT_GAP_DEG);
  });

  it('draws a single slice as a full ring with no gap', () => {
    const [arc] = allocationDonutArcs([{ value: 1 }]);
    expect([arc!.startDeg, arc!.endDeg]).toEqual([0, 360]);
  });

  it('limits the gap on a tiny slice so it stays visible', () => {
    const arcs = allocationDonutArcs([{ value: 999 }, { value: 1 }]);
    const tiny = arcs[1]!;
    expect(tiny.endDeg).toBeGreaterThan(tiny.startDeg);
    expect(tiny.trueEndDeg).toBe(360);
  });

  it('skips zero and invalid values without shifting the others', () => {
    const arcs = allocationDonutArcs([{ value: 50 }, { value: 0 }, { value: NaN }, { value: 50 }]);
    expect(arcs.map((a) => [a.index, a.trueStartDeg, a.trueEndDeg])).toEqual([
      [0, 0, 180],
      [3, 180, 360],
    ]);
  });
});

describe('hitTestAllocationDonut', () => {
  const arcs = allocationDonutArcs([{ value: 75 }, { value: 25 }]);
  const at = (deg: number, r = 75) => {
    const rad = (deg * Math.PI) / 180;
    return hitTestAllocationDonut(arcs, ALLOCATION_DONUT_CENTER + r * Math.sin(rad), ALLOCATION_DONUT_CENTER - r * Math.cos(rad));
  };

  it('finds the slice clockwise from 12 o’clock', () => {
    expect(at(10)).toBe(0);
    expect(at(260)).toBe(0);
    expect(at(280)).toBe(1);
  });

  it('ignores the hole and the outside', () => {
    expect(at(10, 20)).toBeNull();
    expect(at(10, 120)).toBeNull();
  });
});

describe('donutSegmentPath', () => {
  it('produces a closed path, including a full ring', () => {
    expect(donutSegmentPath(10, 100, 58, 90, 3)).toMatch(/^M.*Z$/);
    expect(donutSegmentPath(0, 360, 58, 90, 0)).toMatch(/^M.*Z$/);
  });
});
