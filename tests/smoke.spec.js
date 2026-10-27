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

test('every route has a share card: title, description and an image that loads, with its size and alt (N8)', async ({
  page,
  request,
}) => {
  for (const route of ROUTES) {
    await page.goto(route);
    /** @param {string} key */
    const meta = (key) => page.locator(`meta[property="${key}"], meta[name="${key}"]`).getAttribute('content');
    expect(await meta('og:title'), route).toBeTruthy();
    expect(await meta('og:description'), route).toBeTruthy();
    expect(await meta('og:image:alt'), route).toBeTruthy();
    expect(await meta('twitter:card'), route).toBe('summary_large_image');
    // The tag names the live domain; fetch the same path from the server under test.
    const image = new URL(/** @type {string} */ (await meta('og:image')));
    expect(image.origin, route).toBe('https://indigowire.net');
    const response = await request.get(image.pathname);
    expect(response.status(), `${route} ${image.pathname}`).toBe(200);
    expect(response.headers()['content-type'], route).toBe('image/jpeg');
    expect(Number(await meta('og:image:width')), route).toBeGreaterThanOrEqual(1200);
  }
});

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

test('/learn explains the documentation address ranges with links to the RFCs', async ({ page }) => {
  await page.goto('/learn');
  const section = page.getByRole('region', { name: 'About the addresses in these games' });
  await expect(section).toContainText('192.0.2.0/24');
  await expect(section).toContainText('2001:db8::/32');
  await expect(section).toContainText('00:00:5e:00:53:00');
  await expect(section).toContainText('8.8.8.8');
  for (const rfc of ['5737', '3849', '7042']) {
    await expect(section.locator(`a[href*="rfc${rfc}"]`).first()).toHaveAttribute('rel', /noopener/);
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

test.describe('How IPv4 ARP works (R5, section 6)', () => {
  /**
   * Pause, send from H1, then step until the log shows `until` (by default, H1's ping arriving).
   * @param {import('@playwright/test').Page} page
   * @param {string} ip
   * @param {string} [until]
   */
  async function sendAndStep(page, ip, until = 'receives a ping') {
    await page.goto('/learn/arp');
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByLabel('To IP address').fill(ip);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const step = page.getByRole('button', { name: 'Step' });
    for (let i = 0; i < 30 && (await step.isEnabled()); i++) {
      if ((await page.locator('.log').textContent())?.includes(until)) break;
      await step.click();
    }
  }

  test("a first send fills H1's ARP cache and SW1's MAC table", async ({ page }) => {
    await sendAndStep(page, '192.0.2.12');
    await expect(page.locator('.log')).toContainText('H2 receives a ping');
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('192.0.2.12');
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('00:00:5e:00:53:12');
    await expect(page.locator('.mac-table tr[data-key="00:00:5e:00:53:11"]')).toContainText('Gi0/1');
  });

  test('Inspect pins a frame in the packet view, with its layout, header rows and 60 linked bytes', async ({
    page,
  }) => {
    await sendAndStep(page, '192.0.2.12');
    await page.locator('.log .inspect').first().focus();
    await page.keyboard.press('Enter');
    const packet = page.locator('.packet');
    await expect(packet.locator('h2')).toHaveText('ARP request: who has 192.0.2.12? Tell 192.0.2.11');
    await expect(packet).toHaveAttribute('data-kind', 'request');
    await expect(packet.locator('.strip .label')).toHaveText([
      'Destination MAC',
      'Source MAC',
      'Type',
      'ARP',
      'Padding',
      'FCS',
    ]);
    await packet.getByText('Bytes: all 60').click();
    await expect(packet.locator('.byte')).toHaveCount(60);
    await packet.locator('.cell', { hasText: 'Opcode' }).hover();
    await expect(packet.locator('.byte.hl')).toHaveText(['00', '01']);
    await expect(packet.getByRole('button', { name: 'Follow the latest frame' })).toBeVisible();
  });

  test("the hop table and R1's card show what the router changed on the way to 8.8.8.8", async ({ page }) => {
    await sendAndStep(page, '8.8.8.8', 'new frame for its upstream link');
    const card = page.locator('.rewrite');
    await expect(card).toBeVisible();
    await expect(card).toContainText('R1 rebuilds the frame');
    await expect(card.locator('s')).toHaveText(['R1', 'H1', '64']);
    // The packet view follows the latest frame: the one R1 built, in teal.
    const packet = page.locator('.packet');
    await expect(packet).toHaveAttribute('data-kind', 'data');
    const r1Row = packet.locator('.hops tr', { hasText: 'R1 → next hop' });
    await expect(r1Row.locator('td.changed')).toHaveCount(3);
    await expect(r1Row).toContainText('63');
    await expect(packet.locator('.hops tr', { hasText: 'SW1 → R1' }).last().locator('td.changed')).toHaveCount(0);
    // N6: the wide hop table and the card scroll or fit inside their boxes, never the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('the destination answers: the echo reply comes back to H1', async ({ page }) => {
    await sendAndStep(page, '192.0.2.12', 'H1 receives the ICMP echo reply');
    await expect(page.locator('.log')).toContainText('H1 receives the ICMP echo reply from 192.0.2.12');
  });

  test('Learn mode walks through the exchange with Next and Back', async ({ page }) => {
    await page.goto('/learn/arp#learn');
    await expect(page.getByRole('radio', { name: 'Learn' })).toBeChecked();
    await expect(page.locator('form.send')).toBeHidden();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('#lesson-title')).toHaveText('Why ARP?');
    const next = page.getByRole('button', { name: 'Next' });
    for (let i = 0; i < 7; i++) await next.click();
    await expect(page.locator('#lesson-title')).toHaveText('Ping again: no ARP');
    await expect(page.getByRole('button', { name: 'Start again' })).toBeVisible();
    await expect(page.locator('.log')).toContainText('already has 192.0.2.12 in its ARP cache', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('#lesson-title')).toHaveText('The round trip is done');
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('00:00:5e:00:53:12');
  });

  test("switching mode updates the URL and shows that mode's controls", async ({ page }) => {
    await page.goto('/learn/arp');
    await page.getByRole('radio', { name: 'Gratuitous ARP' }).check();
    await expect(page).toHaveURL(/#garp$/);
    await expect(page.getByRole('button', { name: 'Announce' })).toBeVisible();
    await page.getByRole('radio', { name: 'Sandbox' }).check();
    await expect(page.getByRole('button', { name: 'Announce' })).toBeHidden();
  });

  test('"Meanwhile, on another host…": H2 reports a duplicate IP and caches flip to H3', async ({ page }) => {
    await page.goto('/learn/arp#garp');
    await page.getByLabel('Speed').selectOption('2');
    await page.getByRole('button', { name: 'Meanwhile, on another host…' }).click();
    await expect(page.locator('.bubble')).toContainText(
      'Duplicate IP address! 00:00:5e:00:53:13 also claims 192.0.2.12',
    );
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('00:00:5e:00:53:13');
    await expect(page.locator('.cache[data-host="R1"]')).toContainText('00:00:5e:00:53:13');
  });

  test('Failover: the standby takes over the address with no duplicate-IP alarm', async ({ page }) => {
    await page.goto('/learn/arp#garp');
    await page.getByLabel('Speed').selectOption('2');
    await page.getByRole('button', { name: /^Failover/ }).click();
    await expect(page.locator('[data-node="H2"]')).toContainText('(down)');
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('00:00:5e:00:53:13');
    await expect(page.locator('.log')).toContainText('R1 updates 192.0.2.12');
    await expect(page.locator('.bubble')).toHaveCount(0);
  });

  test('an unused address times out with the retry bubble', async ({ page }) => {
    await page.goto('/learn/arp');
    await page.getByLabel('Speed').selectOption('2');
    await page.getByRole('button', { name: 'an unused address' }).click();
    await expect(page.locator('.bubble')).toContainText('retries about 3 times', { timeout: 10_000 });
  });

  test('a bad address shows an error instead of sending', async ({ page }) => {
    await page.goto('/learn/arp');
    await page.getByLabel('To IP address').fill('192.0.2');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#arp-dest-error')).toContainText('Enter an IPv4 address');
    await expect(page.getByLabel('To IP address')).toHaveAttribute('aria-invalid', 'true');
  });

  test('with reduced motion, frames jump instead of gliding (N4)', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 640, 'positions below are for the wide layout');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/learn/arp');
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    // At the start of its hop a gliding frame sits on H1 (x 110); a jumping one is already 15% along.
    await expect(page.locator('.frame').first()).toHaveAttribute('transform', /^translate\(156\.5,/);
  });
});
