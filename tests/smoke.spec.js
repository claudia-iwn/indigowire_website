// Smoke tests: every route loads without console errors and without horizontal
// scroll (N6), plus the 404 page, the RSS feed and the theme toggle (N5).
import { test, expect } from '@playwright/test';

const ROUTES = [
  '/',
  '/about',
  '/contact',
  '/learn',
  '/speaking',
  '/learn/arp',
  '/spark',
  '/spark/2026-10-25-1405-bgp-weather',
  '/spark/category/working-on',
  '/topics',
  '/topics/arp',
];

/**
 * Collect console errors and uncaught exceptions for one page.
 * @param {import('@playwright/test').Page} page
 */
function trackErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

for (const route of ROUTES) {
  test(`${route} loads cleanly`, async ({ page }) => {
    const errors = trackErrors(page);
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);

    // N6: no horizontal scroll. Like Python's assert a <= b.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('every header link reaches a page', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page
    .locator('nav[aria-label="Main"] ul:first-child a')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(['/', '/learn', '/spark', '/about', '/speaking', '/contact']);
  for (const href of hrefs) {
    expect((await page.request.get(href ?? '')).status()).toBe(200);
  }
});

test('external links open in a new tab with rel=noopener (R1)', async ({ page }) => {
  await page.goto('/');
  const external = page.locator('a[data-outbound]');
  expect(await external.count()).toBeGreaterThan(0);
  for (const link of await external.all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  }
});

test('unknown routes return the 404 page with status 404 (R14)', async ({ page }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.locator('h1')).toContainText('404');
});

test('RSS feed lists the Spark entries (R12)', async ({ request }) => {
  const response = await request.get('/spark/rss.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('xml');
  const xml = await response.text();
  expect(xml.match(/<item>/g)?.length).toBe(3);
});

test.describe('theme toggle (N5)', () => {
  test.use({ colorScheme: 'light' });

  test('switches, persists across pages and clears when matching the OS', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const toggle = page.locator('#theme-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.brand img.theme-light-only')).toBeVisible();

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.brand img.theme-dark-only')).toBeVisible();

    await page.goto('/learn/arp');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.locator('#theme-toggle').click();
    await expect(html).not.toHaveAttribute('data-theme', /.*/);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();
  });

  test('follows the OS theme when no choice is stored', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.brand img.theme-dark-only')).toBeVisible();
  });
});
