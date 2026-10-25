# indigowire.net

Static Astro site for Indigo Wire Networks (Claudia de Luna, network engineer/architect and network automation consultant). It combines a few consultancy pages, interactive networking games (starting with an ARP simulator), and a gallery of AI images from a DGX Spark. It deploys to Cloudflare Workers through Workers Builds on every push to `main`.

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
| Lint (ESLint, Prettier, ruff) | `npm run lint`; auto-fix with `npm run format` |
| Everything (lint + Vitest + pytest + build) | `npm run check` — must pass before any commit |
| Validate a Spark entry | `uv run scripts/validate_spark.py <entry.md \| image.webp \| dir>` |
| One publisher pass (no push) | `uv run scripts/spark_publisher.py --once --dry-run` (stub until M3) |

Prettier ignores all Markdown (`**/*.md`) so the spec and content keep their hand formatting.

## Current state

M0 skeleton: every route renders from the collections, but the ARP engine, frame encoding, renderer and Spark publisher are stubs (marked `STUB`/`TODO(Mn)`). The header logo is `public/logo.svg` / `logo-dark.svg`, converted from the PDF master with `pdftocairo -svg`, cropped to the artwork, and recolored for dark mode (navy → white, indigo → `#B8C4FF`, copper unchanged). The favicon is still Astro's default. `docs/SPEC.md` is canonical; the root `indigowire.net Site Specification_SPEC.md` is an untracked local copy; never edit it. Where `spark-art-github-publishing-and-operations-addendum.md` conflicts with the spec (Cloudflare Pages, a `site/` + `gallery.json` layout), the spec wins.

## Stack and conventions

- **Astro, static output.** No adapter, no server code in v1. Content pages ship zero JavaScript; only game pages load scripts.
- **JavaScript with JSDoc type comments**, not TypeScript, for every file you write.
- **Plain CSS** with custom properties from `src/styles/tokens.css`. No CSS frameworks. Never hard-code a color; use a token.
- **Python only through uv.** Use `uv add` / `uv add --dev` and `uv run`. Never use pip, `python -m venv`, or a bare `python`.
- **No new runtime dependency** unless it is in the spec's tech stack table (section 3). If one is needed, update that table first.
- **Comments for a Python developer learning JS:** when JavaScript does something non-obvious, add a one-line comparison to Python (for example, "like a Python dict").

## Architecture rules

- **Games:** logic lives in a DOM-free engine module (`src/games/<game>/engine.js`) with Vitest tests. Rendering (`renderer.js`, SVG + GSAP) only subscribes to engine events. Never mix the two.
- **Content:** everything is files under `src/content/`, validated by the schemas in `src/content.config.js`. A bad file must fail the build, not publish.
- **Tags:** only values listed in `src/content/tags.yaml` (lowercase kebab-case).
- **External links:** defined once in `src/site.config.js`. Never hard-code profile URLs in components.
- **Spark images:** the Hermes glue code writes `<name>.webp` + `<name>.md` pairs into `src/content/spark/YYYY/MM/`; `scripts/spark_publisher.py` commits and pushes them (spec section 7). The publisher adds only validated pairs by explicit path, never with `git add -A`.

## Quality bars (spec section 9)

- WCAG 2.2 AA, fully keyboard operable; every animation respects `prefers-reduced-motion`.
- Light and dark themes from the same tokens.
- Works from 360 px wide with no horizontal scroll.
- Lighthouse Performance ≥ 95 and Accessibility = 100 on Home, `/spark` and `/learn/arp`.
- Analytics are cookieless only: Cloudflare Web Analytics plus PostHog with `cookieless_mode: "always"`. Event names come from `src/analytics.js`. No cookies, no consent banner.

## Working agreement

- Work one milestone from spec section 10 at a time. Tick each task (`- [x]`) in `docs/SPEC.md` when it is done and `npm run check` passes.
- Reference requirement IDs (R1–R15, N1–N9) in commit messages, for example `feat(spark): gallery filters (R6)`.
- Never commit secrets, tokens or keys. Future secrets belong in Cloudflare Workers settings.
- **Ask before** creating a remote repository, pushing, changing Cloudflare or DNS settings, or deleting files.
- Tests that touch git must use a temporary repo with a local bare remote. Never push to GitHub from a test.
- When something in the spec is ambiguous, ask rather than guess, and record the answer in the spec.
