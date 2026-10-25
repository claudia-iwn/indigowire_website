import { defineConfig } from 'vitest/config';

// Unit tests for pure modules (game engines). Python tests live in tests/ and run under pytest.
export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
  },
});
