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
    .locator('nav[aria-label="Main"] ul:first-of-type a')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(['/', '/learn', '/spark', '/about', '/speaking', '/contact']);
  for (const href of hrefs) {
    expect((await page.request.get(href ?? '')).status()).toBe(200);
  }
});

test('below 64rem the nav is a menu that opens and closes (R1)', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('.menu-button');
  const about = page.locator('#site-nav').getByRole('link', { name: 'About', exact: true });
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await expect(button).toBeHidden();
    await expect(about).toBeVisible();
    return;
  }
  await expect(about).toBeHidden();
  await button.click();
  await expect(about).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();
  await button.click();
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(about).toBeHidden();
  await button.click();
  await about.click();
  await expect(page).toHaveURL(/\/about$/);
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

test.describe('Home hero band (section 9)', () => {
  /**
   * Record the hero video files a page requests.
   * @param {import('@playwright/test').Page} page
   */
  function trackVideos(page) {
    /** @type {string[]} */
    const files = [];
    page.on('request', (req) => {
      if (/\/video\/.*\.(webm|mp4)$/.test(req.url())) files.push(req.url());
    });
    return files;
  }

  test('plays once and holds its last frame', async ({ page }) => {
    const files = trackVideos(page);
    await page.goto('/');
    await expect(page.locator('.hero-band h1')).toHaveText('Indigo Wire Networks');
    const video = page.locator('.hero-band video');
    await expect(video).toHaveClass(/shown/, { timeout: 10_000 });
    // Like Python's assert ... is True, polled until the 5-second clip finishes.
    await expect
      .poll(() => video.evaluate((v) => /** @type {HTMLVideoElement} */ (v).ended), { timeout: 15_000 })
      .toBe(true);
    expect(await video.evaluate((v) => /** @type {HTMLVideoElement} */ (v).loop)).toBe(false);
    expect(files).toHaveLength(1);
  });

  for (const [name, setup] of /** @type {const} */ ([
    ['reduced motion', 'reduce'],
    ['the effects switch off', 'switch'],
  ])) {
    test(`shows the last-frame still and downloads no video with ${name}`, async ({ page }) => {
      if (setup === 'reduce') await page.emulateMedia({ reducedMotion: 'reduce' });
      else await page.addInitScript(() => localStorage.setItem('effects', 'off'));
      const files = trackVideos(page);
      await page.goto('/');
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      const still = await page.locator('.hero-band .still').evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(still).toContain('-last.webp');
      expect(files).toEqual([]);
    });
  }
});

test.describe('decrypt effects (N4)', () => {
  for (const route of ['/', '/about']) {
    test(`${route} packet paragraphs decrypt and leave the page as it was`, async ({ page }) => {
      const paragraphs = page.locator('main [data-decrypt-packets] > p');
      // The real text, read with the effect off.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(route);
      const text = await paragraphs.allTextContents();
      expect(text.length).toBeGreaterThan(1);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      // Paragraphs decrypt one after another (several seconds in all), so fake the clock.
      await page.clock.install();
      await page.goto(route);
      await expect(page.locator('[data-decrypt-covered]').first()).toBeAttached();
      // Scroll each paragraph into view, then fast-forward past its decrypt and pause.
      for (const p of await paragraphs.all()) {
        await p.scrollIntoViewIfNeeded();
        await page.clock.runFor(5_000);
      }
      // The last paragraph may report itself visible late, under load.
      await page.waitForTimeout(200);
      await page.clock.runFor(5_000);
      await expect(page.locator('[data-decrypt-overlay]')).toHaveCount(0);
      expect(await paragraphs.allTextContents()).toEqual(text);
    });
  }

  test('the header switch turns effects off and remembers it', async ({ page }) => {
    await page.goto('/about');
    const toggle = page.locator('#effects-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-decrypt-overlay]').first()).toBeAttached();

    // Off: every covered paragraph is uncovered at once.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-decrypt-overlay]')).toHaveCount(0);

    // Remembered on the next page, with nothing animating.
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-effects', 'off');
    await page.waitForTimeout(100);
    await expect(page.locator('[data-decrypt-overlay]')).toHaveCount(0);

    // On again: the choice is forgotten.
    await page.locator('#effects-toggle').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-effects', /.*/);
    expect(await page.evaluate(() => localStorage.getItem('effects'))).toBeNull();
  });

  test('nothing animates with prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('#effects-toggle')).toBeHidden();
    for (const route of ['/', '/about']) {
      await page.goto(route);
      await page.waitForTimeout(100);
      await expect(page.locator('[data-decrypt-overlay]')).toHaveCount(0);
    }
  });
});
