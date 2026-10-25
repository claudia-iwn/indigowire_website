// Playwright smoke tests (spec section 3, N6) against the production build.
// Uses the installed Google Chrome (channel: 'chrome') instead of downloading Chromium.
// Set BASE_URL to test a deployed site instead, e.g.
//   BASE_URL=https://indigowire-website.claudia-b4a.workers.dev npm run test:e2e
import { defineConfig } from '@playwright/test';

const PORT = 4323;
const BASE_URL = process.env.BASE_URL;

export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.js',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: BASE_URL ?? `http://localhost:${PORT}`,
    channel: 'chrome',
  },
  projects: [
    { name: 'mobile-360', use: { viewport: { width: 360, height: 740 } } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
  // Serves dist/, so run `npm run build` first (npm run check does). Skipped when BASE_URL is set.
  webServer: BASE_URL
    ? undefined
    : {
        command: `npx astro preview --port ${PORT} --ignore-lock`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
      },
});
