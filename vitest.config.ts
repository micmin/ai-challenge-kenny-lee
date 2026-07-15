import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Ignore the GitLab shell-runner's nested checkout so tests aren't double-run locally.
    exclude: ['**/node_modules/**', '**/builds/**'],
  },
});
