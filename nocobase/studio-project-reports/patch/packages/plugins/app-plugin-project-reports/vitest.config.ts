import { createNodeVitestConfig } from '@nocobase/dev-config/vitest/node';
import { createReactVitestConfig } from '@nocobase/dev-config/vitest/react';
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { projects: [
  createNodeVitestConfig({ test: { name: 'node', include: ['tests/**/*.test.ts'], exclude: ['tests/client/**'] } }),
  createReactVitestConfig({ test: { name: 'client', include: ['tests/client/**/*.test.tsx'] } }),
] } });
