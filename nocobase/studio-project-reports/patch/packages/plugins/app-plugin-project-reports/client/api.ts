import { useApiClient, type ApiClient } from '@nocobase/app-client';
import { useMemo } from 'react';
import type { ReportPageData, ReportView, Settings, SettingsInput } from '../shared/api.js';
export const reportKeys = ['project-reports'] as const;
const path = (...parts: string[]): string => ['project-reports', ...parts.map(encodeURIComponent)].join('/');
export class ReportsApi {
  constructor(private readonly api: ApiClient) {}
  private async request<T>(input: Parameters<ApiClient['request']>[0]): Promise<T> {
    return (await this.api.request<{ data: T }>(input)).data;
  }
  options(): Promise<ReportPageData> { return this.request({ path: path('options') }); }
  list(date: string, days: number, projectId?: string): Promise<{ reports: ReportView[]; truncated: boolean }> {
    return this.request({ path: path(), query: { date, days: String(days), ...(projectId ? { projectId } : {}) } });
  }
  settings(projectId: string): Promise<Settings> { return this.request({ path: path('projects', projectId, 'settings') }); }
  save(projectId: string, body: SettingsInput): Promise<Settings> { return this.request({ path: path('projects', projectId, 'settings'), method: 'PUT', body }); }
  generate(projectId: string, date: string, current?: ReportView): Promise<ReportView> {
    return this.request({ path: path('projects', projectId, 'generate'), method: 'POST', body: { date, ...(current ? { retry: true, expectedRevision: current.revision } : {}) } });
  }
  cancel(reportId: string): Promise<{ accepted: true }> { return this.request({ path: path(reportId, 'cancel'), method: 'POST' }); }
}
export function useReportsApi(): ReportsApi {
  const api = useApiClient();
  return useMemo(() => new ReportsApi(api), [api]);
}
