/**
 * Make the Open Graph share cards (N8, spec section 9 "Share cards"): 1200 × 630 JPEGs in
 * public/og/, committed like the hero video. Spark permalinks don't need one; they share
 * their own image (src/pages/spark/[slug].astro).
 *
 * Each card is an HTML page drawn with the site's tokens and logo, photographed in Chrome
 * by Playwright (already a dev dependency). Home and Spark use the hero stills. The ARP card includes a real snapshot of the
 * simulator, so it needs a build: run `npm run og`, which builds first.
 *
 * Re-run when a card's title, the logo, the hero still or the simulator's look changes.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// fileURLToPath decodes the %20s in this repo's path (like Python's urllib.parse.unquote).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public/og');
const PORT = 4339;
const WIDTH = 1200;
const HEIGHT = 630;

/**
 * A file as a data: URL, so the card page needs no server.
 * @param {string} path  Relative to the repo root.
 */
async function dataUrl(path) {
  const type = path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : 'image/webp';
  return `data:${type};base64,${(await readFile(join(ROOT, path))).toString('base64')}`;
}

/** @param {string} text */
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * One card's HTML: logo, title and line on the left, a picture on the right or behind.
 * @param {{ title: string, line: string, art: string, tokens: string, logo: string, behind?: boolean }} card
 */
function cardHtml({ title, line, art, tokens, logo, behind = false }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${tokens}
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: var(--font-body);
  background: var(--color-bg); color: var(--color-text); position: relative; }
.art { position: absolute; inset: 0 0 0 ${behind ? 0 : 560}px; display: grid; place-items: center; padding: ${behind ? 0 : 40}px; }
.art img { max-width: 100%; max-height: 100%; }
.art.behind img { width: 100%; height: 100%; object-fit: cover; object-position: center 40%; max-width: none; max-height: none; }
/* Behind the text, fade the picture out under the left column so the title keeps its contrast. */
.fade { position: absolute; inset: 0; background: linear-gradient(90deg, var(--color-bg) 0 42%, transparent 78%); }
.text { position: absolute; left: 64px; top: 56px; bottom: 56px; width: 520px; display: flex; flex-direction: column; }
.logo { width: 300px; }
h1 { font-size: 64px; line-height: 1.05; margin: auto 0 20px; color: var(--color-heading); letter-spacing: -0.01em; }
p { font-size: 28px; line-height: 1.3; margin: 0 0 auto; color: var(--color-text-muted); }
.domain { font-family: var(--font-mono); font-size: 24px; color: var(--color-accent); margin-top: 28px; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: var(--iw-copper-gradient); }
</style></head><body>
<div class="art${behind ? ' behind' : ''}">${art}</div>
${behind ? '<div class="fade"></div>' : ''}
<div class="text">
  <img class="logo" src="${logo}" alt="">
  <h1>${escape(title)}</h1>
  <p>${escape(line)}</p>
  <div class="domain">indigowire.net</div>
</div>
<div class="bar"></div>
</body></html>`;
}

/** Start `astro preview` on the build and wait until it answers. */
async function startPreview() {
  const server = spawn('npx', ['astro', 'preview', '--port', String(PORT), '--ignore-lock'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return server;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  server.kill();
  throw new Error('astro preview did not start; run npm run build first');
}

/**
 * Photograph a LAN simulator a moment into H1's first flood.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} path the page to photograph (/learn/arp or /learn/nd)
 */
async function snapshot(browser, path) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.goto(`http://localhost:${PORT}${path}`);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  // Step to SW1's flood, then let the copies travel about halfway.
  const step = page.getByRole('button', { name: 'Step' });
  await step.click();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Pause' }).click();
  const shot = await page.locator('svg.topology').screenshot({ type: 'png' });
  await page.close();
  return `data:image/png;base64,${shot.toString('base64')}`;
}

const tokens = await readFile(join(ROOT, 'src/styles/tokens.css'), 'utf8');
const logo = await dataUrl('public/logo.svg');
const hero = await dataUrl('public/video/home-hero-light-last.webp');
// The dark hero (pigment in a vat) for Spark: a Spark mosaic would go stale with every new image.
const vat = await dataUrl('public/video/home-hero-dark-last.webp');

await mkdir(OUT, { recursive: true });
const server = await startPreview();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const photo = async (/** @type {string} */ path) =>
    `<img src="${await snapshot(browser, path)}" alt="" style="border:1px solid var(--color-border);border-radius:12px">`;
  const diagram = await photo('/learn/arp');
  const ndDiagram = await photo('/learn/nd');
  const cards = [
    {
      name: 'default',
      title: 'Indigo Wire Networks',
      line: 'Network engineering and automation, interactive networking games, and AI images from a DGX Spark.',
      art: `<img src="${hero}" alt="">`,
      behind: true,
    },
    {
      name: 'learn',
      title: 'How networking works',
      line: 'Interactive networking games and short articles.',
      art: diagram,
    },
    {
      name: 'arp',
      title: 'How IPv4 ARP works',
      line: 'Play a host on a switched LAN and watch ARP resolve an address, frame by frame.',
      art: diagram,
    },
    {
      name: 'nd',
      title: 'How IPv6 Neighbor Discovery works',
      line: "Play a host on an IPv6 LAN and watch Neighbor Discovery find a neighbor's MAC, with multicast instead of broadcast.",
      art: ndDiagram,
    },
    {
      name: 'spark',
      title: 'Spark',
      line: 'AI images made on a DGX Spark.',
      art: `<img src="${vat}" alt="">`,
      behind: true,
    },
  ];

  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  for (const card of cards) {
    await page.setContent(cardHtml({ ...card, tokens, logo }), { waitUntil: 'load' });
    const path = join(OUT, `${card.name}.jpg`);
    await page.screenshot({ path, type: 'jpeg', quality: 85 });
    console.log(relative(ROOT, path));
  }
} finally {
  await browser.close();
  server.kill();
}
