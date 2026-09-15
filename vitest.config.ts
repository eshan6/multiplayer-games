import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts: that one is rooted at src/client for the
// browser build, while the engine tests run from the repo root so they can read
// the real config/rules.json and data/quiz_bank.json.
export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
