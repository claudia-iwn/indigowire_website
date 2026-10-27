// Lighthouse run for N1 and N3 (spec section 9), mobile, against `astro preview` of dist/.
// Run `npm run build` first; `npm run lighthouse` does both. Uses the installed Google Chrome
// and fetches Lighthouse with npx, so it is not a project dependency.
// Reports (HTML + JSON) go to lighthouse-reports/, which is gitignored.
// Set BASE_URL to audit a deployed site instead of a local preview:
//   BASE_URL=https://indigowire-website.claudia-b4a.workers.dev node scripts/lighthouse.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const LIGHTHOUSE = 'lighthouse@13.5.0';
const PORT = 4324;
const BASE = (process.env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');
const OUT = 'lighthouse-reports';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// N1 and N3 targets apply to these pages; the rest are reported for the baseline.
const KEY_PAGES = ['/', '/spark', '/learn/arp'];
const PAGES = [
  ...KEY_PAGES,
  '/about',
  '/speaking',
  '/contact',
  '/learn',
  '/spark/2026-10-25-1405-bgp-weather',
  '/spark/category/mood',
  '/topics',
  '/topics/arp',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = process.env.BASE_URL
  ? null
  : spawn('npx', ['astro', 'preview', '--port', String(PORT), '--ignore-lock'], { stdio: 'ignore' });
// Wait for the server, like a Python retry loop around requests.get.
for (let i = 0; i < 40; i++) {
  try {
    await fetch(BASE);
    break;
  } catch {
    await sleep(250);
  }
}

mkdirSync(OUT, { recursive: true });
let failed = false;
console.log('page'.padEnd(36), 'perf a11y   bp  seo  LCP     CLS');

for (const page of PAGES) {
  const name = page === '/' ? 'home' : page.slice(1).replaceAll('/', '_');
  // Lighthouse sometimes fails to record the page-load trace (e.g. NO_NAVSTART) and asks
  // for a re-run, so try up to three times.
  let report;
  for (let attempt = 1; attempt <= 3; attempt++) {
    spawnSync(
      'npx',
      [
        '-y',
        LIGHTHOUSE,
        BASE + page,
        '--quiet',
        '--chrome-flags=--headless=new',
        '--output=json',
        '--output=html',
        `--output-path=${OUT}/${name}`,
      ],
      { env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH ?? CHROME }, stdio: 'ignore' },
    );
    report = JSON.parse(readFileSync(`${OUT}/${name}.report.json`, 'utf8'));
    if (!report.runtimeError) break;
  }
  if (report.runtimeError) {
    console.log(page.padEnd(36), `Lighthouse error: ${report.runtimeError.code}`);
    failed = true;
    continue;
  }
  /** @param {string} key */
  const score = (key) => Math.round(report.categories[key].score * 100);
  const [perf, a11y] = [score('performance'), score('accessibility')];
  const miss = KEY_PAGES.includes(page) && (perf < 95 || a11y < 100);
  failed ||= miss;
  console.log(
    page.padEnd(36),
    [perf, a11y, score('best-practices'), score('seo')].map((n) => String(n).padStart(4)).join(' '),
    ' ',
    report.audits['largest-contentful-paint'].displayValue.padEnd(7),
    report.audits['cumulative-layout-shift'].displayValue,
    miss ? '  << below N1/N3 target' : '',
  );
}

server?.kill();
console.log(`\nReports: ${OUT}/<page>.report.html`);
process.exit(failed ? 1 : 0);
