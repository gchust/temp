import {
  createClientLibraryConfig,
  createShadcnRegistryConfig,
} from '@nocobase/dev-config/eslint';
export default createClientLibraryConfig({
  tsconfigRootDir: import.meta.dirname,
  environment: createShadcnRegistryConfig(),
});
