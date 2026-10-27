# indigowire.net

Static Astro site for Indigo Wire Networks (Claudia de Luna, network engineer/architect and network automation consultant). It combines a few consultancy pages, interactive networking games (starting with an ARP simulator, "How IPv4 ARP works"), and a gallery of AI images from a DGX Spark. It deploys to Cloudflare Workers through Workers Builds on every push to `main`.

**The spec is the source of truth: `docs/SPEC.md`.** Read the relevant section before starting any task. If a decision changes, update the spec in the same change.

## Commands

| Task | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Production build | `npm run build` (output in `dist/`) |
| Preview the build | `npm run preview` |
| JS unit tests | `npm test` (Vitest, `src/**/*.test.js`) |
| One JS test | `npx vitest run src/games/arp/engine.test.js -t "<name>"` |
| Python tests | `uv run pytest` (one test: `uv run pytest tests/test_validate_spark.py -k <name>`) |
| Smoke tests (Playwright) | `npm run build && npm run test:e2e`; one test: `npx playwright test -g "/learn/arp"` |
| Lint (ESLint, Prettier, ruff) | `npm run lint`; auto-fix with `npm run format` |
| Everything (lint + Vitest + pytest + build + Playwright) | `npm run check` — must pass before any commit |
| Lighthouse (N1/N3, mobile) | `npm run lighthouse` — run before closing a milestone; reports in `lighthouse-reports/` |
| Test the live site | `BASE_URL=https://indigowire-website.claudia-b4a.workers.dev npm run test:e2e` (or `node scripts/lighthouse.mjs`) |
| Share cards (Open Graph images) | `npm run og` (builds, then writes `public/og/*.jpg`; commit them) |
| Validate a Spark entry | `uv run scripts/validate_spark.py <entry.md \| image.webp \| dir>` |
| One publisher pass (no push) | `uv run scripts/spark_publisher.py --once --dry-run` (stub until M3) |

Prettier ignores all Markdown (`**/*.md`) so the spec and content keep their hand formatting.

## Current state

As of 27 October 2026, the site is built through M7 except for the items below; spec section 10 has the checklist. Live on workers.dev only: `indigowire.net` still serves the old GoDaddy site until the M0 DNS move, so share cards (which point at `site.url`) show no image in link previews yet.

- **Done:** site shell, content collections and topics, the Spark gallery with permalinks, categories and RSS, the validator, the Speaking page (R16), Open Graph share cards (N8), and the ARP game: engine, frames, the `lesson.js` Learn lesson, the renderer and controller with Learn, Sandbox and Gratuitous ARP modes, the packet view and the hop table; the learning path scaffold (M7: course map, Home teaser, lesson placement, Course structured data).
- **Not done:**
  - M0: the DNS move to Cloudflare, the custom domain, the Hermes deploy key.
  - Analytics (R15): no `src/analytics.js` yet, and no beacon in `BaseLayout` (`TODO(M1)`). The ARP and Spark events wait on the PostHog key.
  - M3: `scripts/spark_publisher.py` is still a `STUB`; the gallery tag filter is a `TODO(M3)`; the build-fails-on-a-bad-entry check is not automated.
  - M6: Break-it mode, held for its own design pass and kept at the conceptual, simulation-only level in spec section 6. Then the accessibility and Lighthouse pass.

The header logo is `public/logo.svg` / `logo-dark.svg`, converted from the PDF master with `pdftocairo -svg`, cropped to the artwork, and recolored for dark mode (navy → white, indigo → `#B8C4FF`, copper unchanged). Favicons and app icons (`public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192/512.png`) come from the logo's circular mark. `docs/SPEC.md` is canonical; the root `indigowire.net Site Specification_SPEC.md` is an untracked local copy; never edit it. Where `spark-art-github-publishing-and-operations-addendum.md` conflicts with the spec (Cloudflare Pages, a `site/` + `gallery.json` layout), the spec wins.

## Stack and conventions

- **Astro, static output.** No adapter, no server code in v1. Content pages ship zero JavaScript apart from the exceptions listed in spec N2 (theme and effects toggles, permalink dates, the decrypt effect); game pages load their own scripts.
- **JavaScript with JSDoc type comments**, not TypeScript, for every file you write.
- **Plain CSS** with custom properties from `src/styles/tokens.css`. No CSS frameworks. Never hard-code a color; use a token. Color tokens are `light-dark(light, dark)`, so one token covers both themes; the manual toggle sets `data-theme` on `<html>`. For theme-specific images use the `.theme-light-only` / `.theme-dark-only` classes (with `loading="lazy"`), never a `prefers-color-scheme` media query, which ignores the toggle.
- **Python only through uv.** Use `uv add` / `uv add --dev` and `uv run`. Never use pip, `python -m venv`, or a bare `python`.
- **No new runtime dependency** unless it is in the spec's tech stack table (section 3). If one is needed, update that table first.
- **Example addresses:** IPv4 only from RFC 5737 (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), IPv6 only from RFC 3849 (2001:db8::/32), MACs only from RFC 7042 (00:00:5e:00:53:xx), and made-up domain names only under `.example` (RFC 2606; the course's photo site is `leapix.example`), in code, tests, games and docs. Never real public or RFC 1918 addresses, except 8.8.8.8 as "the internet" (spec section 3).
- **Comments for a Python developer learning JS:** when JavaScript does something non-obvious, add a one-line comparison to Python (for example, "like a Python dict").

## Architecture rules

- **Games:** logic lives in a DOM-free engine module (`src/games/<game>/engine.js`) with Vitest tests. Rendering (`renderer.js`, SVG, positioned from the engine clock) only subscribes to engine events. Never mix the two.
- **Content:** everything is files under `src/content/`, validated by the schemas in `src/content.config.js`. A bad file must fail the build, not publish.
- **Tags:** only values listed in `src/content/tags.yaml` (lowercase kebab-case).
- **External links:** defined once in `src/site.config.js`. Never hard-code profile URLs in components.
- **Decrypt effects:** `src/components/Decrypt.astro`, opted into with `data-decrypt*` attributes. The timings are the constants at the top of its script (`DEFAULT_MS`, `HOVER_MS`, `PARAGRAPH_MS`, `PAUSE_MS`, `FIRST_HOLD_MS`) plus `data-decrypt-ms` on each page title. The attributes, tuning table and rules are in spec section 9, "Decrypt effects"; keep that table in step when timings change. Every effect must keep the real text in place (no layout shift) and respect both `prefers-reduced-motion` and the header `>_` switch (`data-effects="off"` on `<html>`).
- **Home hero band:** `src/components/HeroBand.astro`, in `BaseLayout`'s `hero` slot (`<main>` is full width; the page column is `.page-body`). The video files in `public/video/` come from `scripts/make_hero_video.sh`. It plays once, and shows only a still with reduced motion, the `>_` switch off, data saver or no JS. Spec section 9, "Home hero band".
- **Content Security Policy (N10, spec section 9 "Security"):** every page has a strict CSP built by Astro (`security.csp` in `astro.config.mjs`), plus headers in `public/_headers`. Never add an `is:inline` script (Astro can't hash it; the one exception is `src/lib/boot-script.js`, hashed in the config), a `style=""` attribute (set styles through `el.style`), `set:html` with content, or anything loaded from another site without adding its host to the policy. The Playwright "Content Security Policy" tests catch violations.
- **Search (N11, spec section 9 "Search and AI search"):** every page passes `BaseLayout` a unique `title`, a `description` of at least 70 characters, its `pageType` and `breadcrumbs`, and any page-specific structured data from `src/lib/seo.js` (facts only from the About page). New routes appear in `sitemap.xml` and `llms.txt` through `src/lib/routes.js`; add a hand-written page there. The Playwright "Search and AI search (N11)" tests enforce this.
- **Learning path:** the course is `src/content/path.yaml` (spec section 12). To ship a lesson, add its `learn` entry, set `entry:` on its lesson, and move `next: true` to the new up-next lesson; `/learn`, Home, breadcrumbs, structured data and `llms.txt` follow.
- **Spark images:** the Hermes glue code writes `<name>.webp` + `<name>.md` pairs into `src/content/spark/YYYY/MM/`; `scripts/spark_publisher.py` commits and pushes them (spec section 7). The publisher adds only validated pairs by explicit path, never with `git add -A`.

## Quality bars (spec section 9)

- WCAG 2.2 AA, fully keyboard operable; every animation respects `prefers-reduced-motion`.
- Light and dark themes from the same tokens.
- Works from 360 px wide with no horizontal scroll.
- Lighthouse Performance ≥ 95 and Accessibility = 100 on Home, `/spark` and `/learn/arp`.
- Analytics are cookieless only: Cloudflare Web Analytics plus PostHog with `cookieless_mode: "always"`. Event names come from `src/analytics.js`. No cookies, no consent banner.

## Working agreement

- Work one milestone from spec section 10 at a time. Tick each task (`- [x]`) in `docs/SPEC.md` when it is done and `npm run check` passes.
- Reference requirement IDs (R1–R16, N1–N11) in commit messages, for example `feat(spark): gallery filters (R6)`.
- Never commit secrets, tokens or keys. Future secrets belong in Cloudflare Workers settings.
- **Ask before** creating a remote repository, pushing, changing Cloudflare or DNS settings, or deleting files.
- Tests that touch git must use a temporary repo with a local bare remote. Never push to GitHub from a test.
- When something in the spec is ambiguous, ask rather than guess, and record the answer in the spec.
