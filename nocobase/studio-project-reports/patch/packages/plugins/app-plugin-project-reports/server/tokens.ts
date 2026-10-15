import { createServiceToken, type ServiceToken } from '@nocobase/service-provider';
import type { ProjectReports } from './service.js';
export const projectReportsToken: ServiceToken<ProjectReports> = createServiceToken<ProjectReports>('@nocobase/app-plugin-project-reports/reports');
