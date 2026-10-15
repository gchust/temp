import path from 'node:path';
import { defineServerPlugin, type AppServerPlugin } from '@nocobase/app-server/plugins';
import { ProjectReportsProvider } from './provider.js';
import routes from './routes.js';
const plugin: AppServerPlugin = defineServerPlugin({
  baseDir: path.resolve(import.meta.dirname, '..'), packageName: '@nocobase/app-plugin-project-reports',
  serviceProviders: [ProjectReportsProvider], routes, database: { migrations: './database/migrations' },
});
export default plugin;
