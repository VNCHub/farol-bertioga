import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Cada suíte mexe em process.env; sem isolar, uma vaza para a outra.
    restoreMocks: true,
    unstubEnvs: true,
  },
});
