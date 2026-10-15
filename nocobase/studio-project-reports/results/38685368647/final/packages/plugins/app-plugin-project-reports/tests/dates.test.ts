import { describe, expect, it } from 'vitest';
import {
  dayAt,
  dayWindow,
  isDay,
  isTimezone,
  addDays,
} from '../shared/dates.js';

describe('calendar windows', () => {
  it('does not normalize invalid dates', () => {
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2024-02-29')).toBe(true);
    expect(isTimezone('Not/AZone')).toBe(false);
  });
  it('uses the configured timezone, not the process timezone', () => {
    expect(dayWindow('2026-10-14', 'Asia/Shanghai')).toEqual({
      from: '2026-10-13T16:00:00.000Z',
      to: '2026-10-14T16:00:00.000Z',
    });
    expect(dayAt(new Date('2026-10-14T23:00:00Z'), 'Asia/Shanghai')).toBe(
      '2026-10-15',
    );
  });
  it('handles short and long DST days', () => {
    const short = dayWindow('2026-10-04', 'Australia/Melbourne');
    const long = dayWindow('2026-04-05', 'Australia/Melbourne');
    expect(Date.parse(short.to) - Date.parse(short.from)).toBe(23 * 3600_000);
    expect(Date.parse(long.to) - Date.parse(long.from)).toBe(25 * 3600_000);
  });
  it('advances civil dates across months and leap years', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
