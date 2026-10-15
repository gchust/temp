import {
  defineClientPlugin,
  defineAppRoutes,
  type AppClientPluginFactory,
} from '@nocobase/app-client/plugins';
import { FileChartColumn } from 'lucide-react';
import locales from './locales/index.js';
import { PACKAGE, REPORT_PATH } from '../shared/api.js';

const projectReports: AppClientPluginFactory = defineClientPlugin({
  packageName: PACKAGE,
  locales,
  routes: [
    defineAppRoutes([
      {
        name: 'project-reports',
        path: REPORT_PATH,
        auth: 'required',
        authz: { resource: { type: 'page', id: 'reports' }, action: 'access' },
        navigation: {
          title: 'navigation.reports',
          icon: FileChartColumn,
          order: 2.5,
        },
        breadcrumb: { title: 'navigation.reports' },
        componentLoader: () => import('./page.js'),
      },
    ]),
  ],
});
export default projectReports;
