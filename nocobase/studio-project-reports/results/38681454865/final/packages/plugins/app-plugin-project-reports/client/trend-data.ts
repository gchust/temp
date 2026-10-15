import { addDays } from '../shared/dates.js';
import { totals, type ReportView } from '../shared/api.js';
export type Metric = 'code' | 'tests' | 'tasks';
interface Point {
  date: string;
  first: number | null;
  second: number | null;
  estimated: boolean;
}
export function trendPoints(
  reports: readonly ReportView[],
  day: string,
  days: number,
  metric: Metric,
): Point[] {
  const byDay = new Map(reports.map((report) => [report.date, report]));
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(day, index + 1 - days);
    const report = byDay.get(date);
    const figures = totals(report?.facts ?? null);
    if (metric === 'tasks')
      return {
        date,
        first: report?.material.issues.created ?? null,
        second: report?.material.issues.completed ?? null,
        estimated: false,
      };
    const delta = figures[metric];
    return {
      date,
      first: delta?.added ?? null,
      second: delta?.deleted ?? null,
      estimated: metric === 'tests' && figures.estimatedTests,
    };
  });
}

/** Split paths at unknown values and at a change in test-counting method. */
export function paths(
  points: readonly Point[],
  key: 'first' | 'second',
  maximum: number,
): string[] {
  const result: string[] = [];
  let active = '';
  let previousMethod: boolean | undefined;
  points.forEach((point, index) => {
    const value = point[key];
    if (
      value === null ||
      (previousMethod !== undefined && previousMethod !== point.estimated)
    ) {
      if (active) result.push(active);
      active = '';
    }
    if (value !== null)
      active += `${active ? ' L' : 'M'}${40 + (index / Math.max(1, points.length - 1)) * 720} ${190 - (value / maximum) * 150}`;
    previousMethod = point.estimated;
  });
  if (active) result.push(active);
  return result;
}
