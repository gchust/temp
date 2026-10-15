import { describe, expect, it } from 'vitest';
import { paths, trendPoints } from '../../client/trend.js';

describe('report trend', () => {
  it('shows missing days as gaps instead of zero', () => {
    const points = trendPoints([], '2026-10-14', 7, 'code');
    expect(points).toHaveLength(7);
    expect(points[0].date).toBe('2026-10-08');
    expect(points.every((point) => point.first === null && point.second === null)).toBe(true);
    expect(paths(points, 'first', 1)).toEqual([]);
  });
  it('breaks paths at unknown days and at changed test methods', () => {
    const points = [
      { date: '2026-10-11', first: 1, second: 0, estimated: false },
      { date: '2026-10-12', first: null, second: null, estimated: false },
      { date: '2026-10-13', first: 2, second: 0, estimated: false },
      { date: '2026-10-14', first: 3, second: 0, estimated: true },
    ];
    expect(paths(points, 'first', 3)).toHaveLength(3);
  });
});
