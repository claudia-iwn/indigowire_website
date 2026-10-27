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
 * The start of the inline script Cloudflare's JavaScript Detections injects on the proxied
 * domain. It can't be switched off on the free plan, and the CSP blocks it, harmlessly
 * (spec section 9, "Analytics"). Only this exact script is forgiven: the CSP's
 * 'report-sample' gives the first 40 characters of anything it blocks.
 */
const CLOUDFLARE_JSD = /^\(function\(\)\{function c\(\)\{var b=a\.contentD/;

/**
 * Report blocked inline scripts with their first characters, skipping Cloudflare's.
 * @param {import('@playwright/test').Page} page
 * @param {(text: string) => void} report
 */
async function watchInlineViolations(page, report) {
  await page.exposeFunction(
    'reportInlineViolation',
    (/** @type {string} */ directive, /** @type {string} */ sample) => {
      if (!CLOUDFLARE_JSD.test(sample)) report(`Content Security Policy violation: ${directive} "${sample}"`);
    },
  );
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) => {
      if (e.blockedURI === 'inline') /** @type {any} */ (window).reportInlineViolation(e.violatedDirective, e.sample);
    }),
  );
}

/**
 * Collect console errors, uncaught exceptions and blocked inline scripts for one page.
 * @param {import('@playwright/test').Page} page
 */
async function trackErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => {
    // Blocked inline scripts are reported by watchInlineViolations, which can tell them apart.
    if (msg.type() === 'error' && !msg.text().startsWith('Executing inline script violates')) {
      errors.push(`console: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  await watchInlineViolations(page, (text) => errors.push(text));
  return errors;
}

for (const route of ROUTES) {
  test(`${route} loads cleanly`, async ({ page }) => {
    const errors = await trackErrors(page);
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

test.describe('Content Security Policy', () => {
  test('every route sets a strict policy: hashed scripts, no inline or eval, scripts only from the site and Cloudflare Web Analytics', async ({
    page,
  }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      const csp = await page.locator('meta[http-equiv="content-security-policy"]').getAttribute('content');
      expect(csp, route).toContain("default-src 'self'");
      expect(csp, route).toContain("object-src 'none'");
      // Scripts: the site's own, hashed, plus the Web Analytics beacon Cloudflare injects (N10).
      const scriptSrc = (csp?.match(/script-src ([^;]*)/) ?? ['', ''])[1].split(' ');
      expect(scriptSrc, route).toContain("'self'");
      expect(
        scriptSrc.some((s) => s.startsWith("'sha256-")),
        route,
      ).toBe(true);
      const hosts = scriptSrc.filter((s) => !s.startsWith("'"));
      expect(hosts, route).toEqual(['https://static.cloudflareinsights.com']);
      expect(csp, route).not.toContain('unsafe-inline');
      expect(csp, route).not.toContain('unsafe-eval');
    }
  });

  test('the interactive parts run without a single violation', async ({ page }) => {
    /** @type {string[]} */
    const violations = [];
    await page.exposeFunction('reportViolation', (/** @type {string} */ v) => violations.push(v));
    await page.addInitScript(() =>
      document.addEventListener('securitypolicyviolation', (e) => {
        // Blocked inline scripts are checked by watchInlineViolations, which forgives only Cloudflare's.
        if (e.blockedURI !== 'inline')
          /** @type {any} */ (window).reportViolation(`${e.violatedDirective} ${e.blockedURI}`);
      }),
    );
    await watchInlineViolations(page, (text) => violations.push(text));
    await page.goto('/');
    await page.getByRole('button', { name: 'About the background video' }).click();
    await page.keyboard.press('Escape');
    await page.goto('/learn/arp');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('00:00:5e:00:53:12', { timeout: 10_000 });
    await page.getByRole('radio', { name: 'Learn' }).check();
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.goto('/spark/2026-10-25-1405-bgp-weather');
    await page.waitForLoadState('networkidle');
    expect(violations).toEqual([]);
  });

  test('the deployed site sends the security headers from public/_headers (N10)', async ({ request, baseURL }) => {
    // astro preview ignores _headers, so this runs only against Cloudflare (BASE_URL=https://…).
    test.skip(!baseURL?.startsWith('https://'), 'headers are applied by Cloudflare, not astro preview');
    for (const path of ['/', '/learn/arp', '/no-such-page']) {
      const headers = (await request.get(path)).headers();
      expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
      expect(headers['x-frame-options'], path).toBe('DENY');
      expect(headers['x-content-type-options'], path).toBe('nosniff');
      expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
      expect(headers['permissions-policy'], path).toContain('camera=()');
      expect(headers['strict-transport-security'], path).toContain('max-age=');
    }
  });

  test('an injected inline script is blocked', async ({ page }) => {
    const errors = await trackErrors(page);
    await page.goto('/');
    // Simulate an attacker's markup reaching the page: the browser must refuse to run it.
    const ran = await page.evaluate(async () => {
      const s = document.createElement('script');
      s.textContent = 'window.__pwned = true';
      document.body.append(s);
      await new Promise((r) => setTimeout(r, 50));
      return /** @type {any} */ (window).__pwned === true;
    });
    expect(ran).toBe(false);
    expect(errors.join(' ')).toContain('Content Security Policy');
  });
});

test.describe('Search and AI search (N11)', () => {
  test('every route has a unique title and description, and a canonical URL that matches its link', async ({
    page,
  }) => {
    /** @type {Set<string>} */
    const titles = new Set();
    /** @type {Set<string>} */
    const descriptions = new Set();
    for (const route of ROUTES) {
      await page.goto(route);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical, route).toBe(`https://indigowire.net${route === '/' ? '/' : route}`);
      expect(await page.locator('meta[property="og:url"]').getAttribute('content'), route).toBe(canonical);
      const description = (await page.locator('meta[name="description"]').getAttribute('content')) ?? '';
      expect(description.length, `${route} description length`).toBeGreaterThanOrEqual(70);
      titles.add(await page.title());
      descriptions.add(description);
    }
    expect(titles.size).toBe(ROUTES.length);
    expect(descriptions.size).toBe(ROUTES.length);
  });

  test('every route has valid structured data naming the site, the company and the person', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(blocks, route).toHaveLength(1);
      const graph = JSON.parse(blocks[0])['@graph'];
      const types = graph.map((/** @type {any} */ node) => node['@type']);
      expect(types, route).toEqual(expect.arrayContaining(['WebSite', 'Organization', 'Person']));
      expect(
        graph.some((/** @type {any} */ n) => String(n['@id'] ?? '').endsWith('#webpage')),
        route,
      ).toBe(true);
    }
    await page.goto('/learn/arp');
    expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain('"LearningResource"');
    await page.goto('/spark/2026-10-25-1405-bgp-weather');
    expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain('"ImageObject"');
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('the ARP page carries its lesson as text, for readers and crawlers that run no scripts', async ({ page }) => {
      await page.goto('/learn/arp');
      const lesson = page.locator('.lesson-text');
      await expect(lesson.getByRole('heading', { name: 'How ARP works, step by step' })).toBeVisible();
      await lesson.getByText('Read the lesson as text').click();
      await expect(lesson.locator('li')).toHaveCount(9);
      await expect(lesson).toContainText('Ethernet delivers frames by MAC address');
    });
  });

  test('the 404 page asks not to be indexed', async ({ page }) => {
    await page.goto('/no-such-page');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });

  test('the sitemap lists every route, each of which loads', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');
    const xml = await response.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const route of ROUTES) expect(locs, route).toContain(`https://indigowire.net${route === '/' ? '/' : route}`);
    expect(locs.some((loc) => /404|\.html/.test(loc))).toBe(false);
    for (const loc of locs) expect((await request.get(new URL(loc).pathname)).status(), loc).toBe(200);
  });

  test('robots.txt welcomes search and AI search, turns away AI training, and names the sitemap', async ({
    request,
  }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Sitemap: https://indigowire.net/sitemap.xml');
    // Each group: its user-agent lines, then its rules (RFC 9309).
    const groups = robots.split(/\n\s*\n/).map((g) => g.split('\n').filter((l) => !l.startsWith('#')));
    /** @param {string} agent */
    const rulesFor = (agent) =>
      groups.find((g) => g.some((l) => l.toLowerCase() === `user-agent: ${agent.toLowerCase()}`)) ?? [];
    for (const bot of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent']) {
      expect(rulesFor(bot), bot).toContain('Disallow: /');
    }
    for (const bot of ['*', 'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot']) {
      expect(rulesFor(bot), bot).toContain('Allow: /');
      expect(rulesFor(bot), bot).not.toContain('Disallow: /');
    }
  });

  test('llms.txt introduces the site to AI assistants, with links to the main pages', async ({ request }) => {
    const response = await request.get('/llms.txt');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toMatch(/^# Indigo Wire Networks\n\n> /);
    for (const path of ['/about', '/learn/arp', '/speaking', '/spark']) {
      expect(text, path).toContain(`(https://indigowire.net${path})`);
    }
  });

  test('the workers.dev copy is kept out of search once deployed', async ({ request, baseURL }) => {
    test.skip(!baseURL?.includes('.workers.dev'), 'only the workers.dev host sends this header');
    expect((await request.get('/')).headers()['x-robots-tag']).toBe('noindex');
  });
});

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

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    for (const [scheme, shows, hides, link] of /** @type {const} */ ([
      ['light', 'White cotton', 'Leaves of the indigo plant', 'doi.org/10.1126/sciadv.1501623'],
      ['dark', 'Leaves of the indigo plant', 'White cotton', 'attalus.org/pliny/hn35a.html'],
    ])) {
      test(`a small info button explains the ${scheme} theme's background, with a sourced fact and the museum note`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto('/');
        const info = page.getByRole('button', { name: 'About the background video' });
        const card = page.locator('#hero-info');
        await expect(card).toBeHidden();
        await info.click();
        await expect(card).toBeVisible();
        // innerText, unlike textContent, leaves out the other theme's hidden text.
        const text = await card.innerText();
        expect(text).toContain(shows);
        expect(text).not.toContain(hides);
        const links = card.getByRole('link').filter({ visible: true });
        // The theme's own source, then the museum note shared by both themes.
        await expect(links).toHaveCount(2);
        await expect(links.first()).toHaveAttribute('href', new RegExp(link.replace(/\./g, '\\.')));
        expect(text).toContain('An Ocean in a Drop');
        await expect(card.getByRole('link', { name: 'Indigo Art Museum website' })).toHaveAttribute(
          'href',
          'https://www.indigoartmuseum.org/',
        );
        await page.keyboard.press('Escape');
        await expect(card).toBeHidden();
      });
    }
  });
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

  test('Learn mode notes each step on the diagram, beside the device it is about', async ({ page }) => {
    await page.goto('/learn/arp#learn');
    const note = page.locator('.bubbles .step-note');
    await expect(note).toContainText('no MAC');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(note).toHaveCount(1);
    await expect(note).toContainText('H1 is on Gi0/1');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(note).toContainText('Who has 192.0.2.12?');
  });

  test('on a wide screen the tables sit beside the diagram', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/learn/arp');
    const stage = await page.locator('.stage').boundingBox();
    const panels = await page.locator('.panels').boundingBox();
    expect(panels?.x).toBeGreaterThan((stage?.x ?? 0) + (stage?.width ?? 0) - 1);
    expect(panels?.y).toBeLessThan((stage?.y ?? 0) + (stage?.height ?? 0));
    // Wider than the page column allows beside a sidebar, but never wider than the screen.
    expect(stage?.width).toBeGreaterThan(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
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
