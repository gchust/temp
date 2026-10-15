import { describe, expect, it } from 'vitest';
import { windowFor } from '../../app-plugins/connector-sdk/server/date-window.js';

describe('connector date windows', () => {
  it('keeps inclusive daily windows and the preceding non-overlapping comparison', () => {
    expect(windowFor('2026-03-31', '28')).toEqual({
      start: '2026-03-04', end: '2026-03-31', days: 28,
      previousStart: '2026-02-04', previousEnd: '2026-03-03',
    });
  });

  it('uses calendar months and clamps the day at the target month end', () => {
    expect(windowFor('2026-05-30', '3m')).toEqual({
      start: '2026-02-28', end: '2026-05-30', days: 92,
      previousStart: '2025-11-28', previousEnd: '2026-02-27',
    });
  });

  it('does not silently reinterpret the existing custom-window cutoff semantics', () => {
    expect(windowFor('2026-03-20', 'custom', '2026-03-01', '2026-03-31')).toEqual({
      start: '2026-03-01', end: '2026-03-20', days: 31,
      previousStart: '2026-01-29', previousEnd: '2026-02-28',
    });
  });

  it.each([
    ['2026-02-30', '2026-03-01'],
    ['2026-03-02', '2026-03-01'],
    ['not-a-date', '2026-03-01'],
    ['2024-01-01', '2026-03-01'],
  ])('rejects invalid or excessive custom input %s through %s', (start, end) => {
    expect(() => windowFor('2026-03-31', 'custom', start, end)).toThrow();
  });

  it('rejects unsupported time ranges', () => {
    expect(() => windowFor('2026-03-31', 'unlimited')).toThrow();
  });
});
