# indigowire.net Site Specification

Oct 25, 2026 · @Claudia

## 1. Overview

indigowire.net is a static Astro site on Cloudflare Workers that combines a one-person consultancy's basic pages with interactive networking games and a stream of AI images from a DGX Spark. It deploys automatically on every push to `main`.

**Owner:** Senior network engineer/architect and network automation consultant (sole operator).

### Goals

1. Present the consultancy simply: About, contact via LinkedIn, links to the Gratuitous ARP blog, LinkedIn and Bluesky.
2. Teach networking through interactive, unusual browser games, starting with an ARP simulator.
3. Publish Spark images ("what I'm working on", "something I saw", "how I feel right now") at any time of day with no manual web work.
4. Categorize all content (games, topics, images) with one shared tag system.
5. Cost nothing to host on the Cloudflare free tier.

### Non-goals (v1)

- No server-side code, database, login, comments or contact form.
- No CMS; content is files in the repo.
- No cookies, cookie banner or paid analytics; tracking stays cookieless (section 9).

### Using this spec with Claude Code

1. Export this doc as Markdown and save it in the repo as `docs/SPEC.md`.
2. Add a short `CLAUDE.md` at the repo root that points to `docs/SPEC.md` and states the conventions in section 3.
3. Work one milestone from section 10 at a time; ask Claude Code to tick tasks and update this spec when a decision changes.

## 2. Requirements

Each requirement has an ID that tasks, commits and tests can reference. Acceptance criteria use "when / then" form so Claude Code can turn them into tests.

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| R1 | Site shell with persistent navigation | Every page shows header nav (Home, Learn, Spark, About, Contact) and external links (Blog, LinkedIn, Bluesky, GitHub) that open in a new tab with `rel="noopener"`. |
| R2 | About page | `/about` renders bio content from a Markdown file. |
| R3 | Contact page | `/contact` says to make contact through LinkedIn and links to the LinkedIn profile. No form. |
| R4 | Learn index | `/learn` lists every game and topic, grouped by category, each with title, one-line summary and tags. |
| R5 | ARP simulator | `/learn/arp` meets every acceptance criterion in section 6. |
| R6 | Spark gallery | `/spark` shows images newest first; filter by category (`working-on`, `saw-this`, `mood`) and tag. |
| R7 | Spark permalinks | Each image has `/spark/<slug>` with full image, caption, date, category, tags and alt text. |
| R8 | Spark publishing by push | When the glue code places a valid image + sidecar in the clone and the publisher pushes it to `main`, then the image is live after the build finishes, with no manual step. |
| R9 | Spark validation | When a sidecar is missing a required field, then the build fails, the previous version stays live, and the validation script reports the field. |
| R10 | Shared tags | `/topics/<tag>` lists all games, topics and images carrying that tag. |
| R11 | Home page | `/` shows a short intro, the latest Spark image, the featured game and the external links. |
| R12 | Feeds | `/spark/rss.xml` lists the latest 50 Spark entries. |
| R13 | Auto deploy | When a commit lands on `main`, then Workers Builds builds and deploys it; other branches get preview deploys. |
| R14 | Custom 404 | Unknown routes return the site's 404 page with HTTP status 404. |
| R15 | Analytics | When a page loads, then Cloudflare Web Analytics records it; when a visitor does any action in the section 9 event table, then PostHog records that event with its properties; no cookies are set. |

## 3. Architecture

Two writers feed one GitHub repo: the owner (code and pages, through Claude Code) and the Hermes skill on the DGX Spark (images). Every push to `main` triggers Workers Builds, which runs the Astro build and deploys the static output to Cloudflare Workers.

&#91;embedded content: site architecture · 2 writers, 1 repo, 1 build\]

A failed build deploys nothing, so the live site stays as it was until the next good push.

### Tech stack and conventions

| Area | Choice | Notes |
| --- | --- | --- |
| Framework | Astro, static output | No adapter needed in v1; pages ship zero JavaScript unless they hold a game. |
| Language | JavaScript (ES modules) with JSDoc type comments | Matches the owner's goal of learning JS; TypeScript can come later. |
| Styling | Plain CSS with custom properties (design tokens) | Light and dark themes from one token set. No CSS framework. |
| Animation | GSAP | Free for commercial use, including all plugins. |
| Game rendering | Inline SVG | Clickable, crisp at any size, styled by the same tokens. |
| Content | Astro content collections, Markdown + YAML frontmatter | Schemas validated at build time. |
| Unit tests | Vitest | Required for game engines (pure logic). |
| Smoke tests | Playwright | Home, a Spark permalink and `/learn/arp` load without console errors. |
| Tooling | npm, Node LTS, Prettier, ESLint | `npm run check` runs lint, tests and build. |
| Content scripts | Python 3 | `scripts/validate_spark.py` for Hermes; the owner's primary language. Managed with uv through pyproject.toml and uv run. |
| Hosting | Cloudflare Workers static assets + Workers Builds | Free tier; see section 8. |
| Analytics | Cloudflare Web Analytics + PostHog (cookieless) | Both free; see section 9. |

**Code conventions for Claude Code**

- Game logic lives in a DOM-free engine module; rendering subscribes to engine events. Never mix the two.
- Comment non-obvious JavaScript with a one-line Python comparison where it helps ("like a Python dict").
- No new runtime dependency without updating this table.

## 4. Repository structure and content model

All content is files under `src/content/`, validated by schemas in `src/content.config.js`; a bad file fails the build rather than publishing.

### Directory layout

```
indigowire_website/
├── CLAUDE.md                  # points Claude Code to docs/SPEC.md
├── docs/SPEC.md               # this document, exported as Markdown
├── astro.config.mjs
├── wrangler.jsonc
├── package.json
├── public/                    # favicon, robots.txt, static files copied as-is
├── scripts/
│   ├── validate_spark.py      # checks one image + sidecar pair
│   └── spark_publisher.py     # watches the clone, commits and pushes
├── deploy/
│   └── spark-publisher.service  # systemd user unit for the DGX Spark
├── pyproject.toml             # uv: pillow, pyyaml, watchdog; dev: pytest, ruff
├── src/
│   ├── content.config.js      # collection schemas
│   ├── content/
│   │   ├── pages/             # about.md, home intro
│   │   ├── learn/             # one .md per game or topic
│   │   └── spark/YYYY/MM/     # <slug>.webp + <slug>.md pairs
│   ├── games/
│   │   └── arp/
│   │       ├── engine.js      # DOM-free simulation
│   │       ├── engine.test.js
│   │       ├── frames.js      # frame building + hex encoding
│   │       └── renderer.js    # SVG + GSAP view
│   ├── components/            # Header, Footer, TagList, SparkCard
│   ├── layouts/BaseLayout.astro
│   ├── pages/                 # routes (section 5)
│   └── styles/tokens.css      # colors, type, spacing
└── tests/smoke.spec.js        # Playwright
```

### Collection: `spark`

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `title` | string | yes | ≤ 80 characters |
| `date` | ISO 8601 datetime with offset | yes | e.g. `2026-10-25T14:05:00-07:00` |
| `category` | enum | yes | `working-on` \| `saw-this` \| `mood` |
| `image` | relative path | yes | Same basename as the `.md`, `.webp` |
| `alt` | string | yes | Describes the image for screen readers |
| `caption` | string | no | ≤ 280 characters, Markdown allowed |
| `tags` | string\[\] | no | Lowercase kebab-case, from the shared tag list |
| `model` | string | no | Generator name, shown on the permalink |
| `draft` | boolean | no | `true` hides it from all listings |
| `prompt` | string | no | Shown on the permalink only when present; omit to keep a prompt private |

### Collection: `learn`

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `title` | string | yes |  |
| `summary` | string | yes | One line, ≤ 140 characters |
| `category` | enum | yes | `layer-2` \| `layer-3` \| `automation` \| `security` (extend as needed) |
| `kind` | enum | yes | `game` \| `article` |
| `tags` | string\[\] | no | Shared tag list |
| `component` | string | games only | Name of the game module in `src/games/` |
| `featured` | boolean | no | One featured item appears on Home |

### Shared tags

Tags are lowercase kebab-case (`arp`, `layer-2`, `ai-art`, `automation`). Keep the allowed list in `src/content/tags.yaml` with a display name per tag, so a typo fails validation instead of creating a new tag.

## 5. Pages and routes

Every route is generated at build time; nothing renders on request.

| Route | Purpose | Content source | Req. |
| --- | --- | --- | --- |
| `/` | Intro, latest Spark image, featured game, external links | `pages/home.md`, newest `spark`, `learn` with `featured: true` | R11 |
| `/about` | Bio | `pages/about.md` | R2 |
| `/contact` | "Contact me through LinkedIn" + link | Hard-coded component | R3 |
| `/learn` | All games and topics by category | `learn` collection | R4 |
| `/learn/arp` | ARP simulator | `learn/arp.md` + `src/games/arp/` | R5 |
| `/learn/<slug>` | Other games and articles | `learn` collection | R4 |
| `/spark` | Gallery, newest first, filters | `spark` collection | R6 |
| `/spark/<slug>` | Image permalink | `spark` entry | R7 |
| `/spark/category/<category>` | One category | `spark` collection | R6 |
| `/spark/rss.xml` | Feed of latest 50 | `spark` collection | R12 |
| `/topics` | All tags with counts | `tags.yaml` + both collections | R10 |
| `/topics/<tag>` | Everything with that tag | Both collections | R10 |
| `/404` | Not-found page | Hard-coded | R14 |

**External links:** all URLs live in one config file, `src/site.config.js`. The header shows Blog, LinkedIn and Bluesky; the footer shows all of them.

| Link | URL | Where |
| --- | --- | --- |
| Gratuitous ARP blog | [gratuitous-arp.net](https://gratuitous-arp.net/) | Header, footer |
| LinkedIn | [linkedin.com/in/claudiadeluna](https://www.linkedin.com/in/claudiadeluna/) | Header, footer, `/contact` |
| Bluesky | [delunac.bsky.social](https://bsky.app/profile/delunac.bsky.social) | Header, footer |
| GitHub (Indigo Wire) | [github.com/claudia-iwn](https://github.com/claudia-iwn) | Footer |
| GitHub (personal) | [github.com/cldeluna](https://github.com/cldeluna) | Footer |

**Gallery filtering:** category pages are real routes so they work without JavaScript; tag filtering on `/spark` may add a small script that progressively enhances the grid.

## 6. Feature spec: ARP simulator

The visitor plays a host on a switched LAN: they send traffic, watch ARP resolve the address, and can freeze any frame to inspect its fields and bytes.

### Topology

One switch (SW1) and four ports in use; an attacker appears only in Break-it mode. MACs are locally administered so they are obviously simulated.

| Node | Role | IP | MAC | Switch port |
| --- | --- | --- | --- | --- |
| H1 | Host (visitor's default) | 10.0.0.11/24 | 02:00:00:00:00:11 | Gi0/1 |
| H2 | Host | 10.0.0.12/24 | 02:00:00:00:00:12 | Gi0/2 |
| H3 | Host | 10.0.0.13/24 | 02:00:00:00:00:13 | Gi0/3 |
| R1 | Default gateway | 10.0.0.1/24 | 02:00:00:00:00:01 | Gi0/4 |
| M | Attacker (Break-it only) | 10.0.0.66/24 | 02:00:00:00:00:66 | Gi0/5 |

### Engine (`engine.js`, no DOM)

State:

- `hosts[name].arpCache`: map of IP → `{ mac, expiresAt }` (like a Python dict of dicts).
- `switch.macTable`: map of MAC → `{ port, expiresAt }`.
- `clock`: simulated milliseconds, advanced by the renderer, so tests run instantly.
- `log`: ordered list of events, each with a plain-English line.

Behavior (RFC 826 semantics):

1. `send(src, dstIp)`: if `dstIp` is off-subnet, resolve the gateway instead. On a cache hit, emit a unicast data frame. On a miss, emit an ARP request: Ethernet dst `ff:ff:ff:ff:ff:ff`, opcode 1, target MAC all zeros.
2. The switch learns the source MAC on the ingress port, floods broadcasts and unknown unicasts out every other port, and forwards known unicasts out one port.
3. Each receiving host whose IP is not the target drops the request. The target caches the sender's mapping, then sends a unicast reply (opcode 2).
4. The requester caches the reply and sends its queued data frame.
5. Cache and MAC-table entries expire after a TTL (default 60 s simulated, adjustable 10–300 s).
6. The engine emits events (`frame:emit`, `frame:arrive`, `frame:drop`, `cache:update`, `cache:expire`, `mactable:update`) that the renderer subscribes to.

### Frame model (`frames.js`)

Every frame can be encoded to bytes for the inspector: Ethernet header (14 bytes: dst, src, EtherType `0x0806`) plus the 28-byte ARP payload (HTYPE 1, PTYPE `0x0800`, HLEN 6, PLEN 4, OPER, SHA, SPA, THA, TPA), padded to the 60-byte Ethernet minimum.

### Modes

| Mode | What the visitor does | What it teaches |
| --- | --- | --- |
| Learn | Guided steps with a caption per step; Next/Back | The request/reply exchange, step by step |
| Sandbox | Pick any source host, type any IP, press Send | Cache hits vs. misses, gateway resolution, aging |
| Gratuitous ARP | Make a host announce itself (sender IP = target IP, broadcast) | Cache refresh on other hosts; duplicate IP detection when two hosts claim one IP |
| Break it | Enable attacker M, which sends unsolicited replies claiming 10.0.0.1 | Cache poisoning: victims' traffic to the gateway goes to M; a note names the defense (Dynamic ARP Inspection) |

### View (`renderer.js`)

- SVG topology with labelled nodes and links; frames are small envelopes that travel along links via a GSAP timeline.
- Broadcasts visibly fan out from the switch; dropped frames fade at the host with a short "not for me" label.
- Side panels: each host's ARP cache and the switch MAC table, updating live, with a countdown bar per entry.
- Event log beneath, also announced through an `aria-live` region.
- **Frame inspector:** clicking a moving frame pauses the timeline and opens a Wireshark-style decode (field tree) beside a hex dump; hovering a field highlights its bytes and vice versa.
- Controls: Play/Pause, Step, Speed (0.25×–2×), Reset, TTL slider, mode switcher.

### Acceptance criteria

- [ ] Sending from H1 to 10.0.0.12 with an empty cache shows a broadcast request reaching H2, H3 and R1, drops at H3 and R1, a unicast reply to H1, then the data frame.
- [ ] Sending again before the TTL expires skips ARP entirely.
- [ ] Sending to 10.0.0.99 (unused) shows a request with no reply and a log line explaining the timeout.
- [ ] Sending to an off-subnet IP (e.g. 8.8.8.8) resolves R1's MAC, not the destination's.
- [ ] The switch MAC table learns H1 on Gi0/1 after the first frame.
- [ ] The inspector's hex dump for a request is exactly 60 bytes and matches the decoded fields.
- [ ] Break-it mode shows H1's cache entry for 10.0.0.1 changing to M's MAC.
- [ ] Everything works by keyboard; with `prefers-reduced-motion`, frames jump between nodes instead of gliding.
- [ ] Engine unit tests cover every bullet above without a browser.
- [ ] Usable at 360 px wide (panels stack under the topology).

## 7. Feature spec: Spark image pipeline

Hermes's glue code drops an image and its sidecar into a local clone of the repo on the DGX Spark; a small publisher service there notices them, validates them, and commits and pushes so Workers Builds redeploys. The site has no upload API in v1.

### Glue code contract (already built in the Hermes skill)

1. **Convert** to WebP, longest edge ≤ 2048 px, target ≤ 1.5 MB (the Workers per-file limit is 25 MiB).
2. **Name** both files `<date>-<slug>`, e.g. `2026-10-25-1405-bgp-weather`: date and 24-hour time, then a kebab-case slug from the title.
3. **Write** into the clone at `src/content/spark/YYYY/MM/`: the `.webp` first, the `.md` sidecar last.
4. **Write atomically:** save each file under a temporary name (e.g. `.<name>.webp.tmp`) and rename it into place, so the publisher never sees a half-written file.
5. **Stop there.** No git commands; the publisher owns commit and push.

Example sidecar:

```markdown
---
title: BGP weather report
date: 2026-10-25T14:05:00-07:00
category: working-on
image: ./2026-10-25-1405-bgp-weather.webp
alt: A storm map where the isobars are drawn as AS paths between city routers
tags: [bgp, ai-art]
model: (generator name)
---
Debugging route flaps all afternoon.
```

### Spark publisher (`scripts/spark_publisher.py`)

A Python service on the DGX Spark, run with uv under systemd, that turns new files in the clone into one commit and push per batch. It decides what to publish from `git status`, not from file events, so it is safe to re-run and ignores files that arrive through `git pull`.

**Triggers**

- **Watch:** `watchdog` (inotify) watches `src/content/spark/` recursively. After the last change it waits a quiet period (default 30 s) before publishing, so several images made close together become one commit and one build.
- **Sweep:** a publish pass also runs at start-up and every 10 minutes, catching anything missed (a reboot, a failed push).
- **On demand:** `uv run scripts/spark_publisher.py --once` runs a single pass; the glue code may call it directly instead of relying on the watcher. `--dry-run` shows what would be committed.

**Publish pass**

1. Take a lock file so two passes never overlap.
2. List uncommitted files under `src/content/spark/` with `git status --porcelain`. Nothing new means exit.
3. Pair files by basename, ignoring dotfiles and `*.tmp`. A pair is ready when both the `.webp` and `.md` exist and neither changed during the quiet period; incomplete pairs wait for the next pass.
4. Run `scripts/validate_spark.py` on each ready pair. An invalid pair stays in place, is logged with the validator's messages, and is skipped.
5. `git pull --rebase` on `main`.
6. `git add` only the valid pairs' paths, never `git add -A`, so stray edits in the clone are never published.
7. Commit: one image as `spark: <title>`; several as `spark: <n> images`, with the titles listed in the body.
8. Push over SSH with the repo's deploy key. On failure, retry after 1, 5 and 15 minutes; the sweep retries any commit still unpushed.
9. Log each permalink (`https://indigowire.net/spark/<name>`) to the journal, and post it to an optional notification webhook.

**Running it**

- `deploy/spark-publisher.service`: a systemd user unit that runs the publisher from the clone with `uv run`, restarts on failure, and starts at boot (needs `loginctl enable-linger` for the user).
- Settings in `spark_publisher.toml` beside the script: repo path, branch, quiet period, sweep interval, webhook URL.
- Logs: `journalctl --user -u spark-publisher -f`.

**Tests** (`tests/test_spark_publisher.py`, against a temporary repo with a local bare remote): a complete pair is committed and pushed; a lone `.webp` waits; an invalid pair is skipped while a valid one in the same batch is published; three pairs make one commit; a second pass with nothing new does nothing.

### Validation script (`scripts/validate_spark.py`)

- Python 3 with Pillow and PyYAML, run with uv, so it runs on the Spark without the Node toolchain. Hermes calls it as uv run scripts/validate\_spark.py.
- Checks every rule in the section 4 `spark` table, that the image exists, is WebP, and is within the size limits, and that each tag is in `tags.yaml`.
- Exit code 0 on success; non-zero with one line per problem.
- The same rules are enforced again by the Astro schema at build time (R9), so a skipped validation still cannot publish a broken entry.

### Build and gallery behavior

- Astro processes images into responsive sizes at build time; the gallery uses lazy loading and fixed aspect boxes to avoid layout shift.
- `draft: true` entries are built into no listing or route.
- Each permalink shows the image, caption, date in the viewer's locale, category, tags, model and (only when the sidecar has one) the prompt, with previous/next links. Each permalink is the image's own shareable page, and its Open Graph tags make it show as a preview card on Bluesky and LinkedIn.

### Capacity

- Each push is one build. At 1–2 minutes per build, the 3,000 free build minutes a month allow roughly 1,500–3,000 pushes.
- If build time grows with the gallery, move originals to Cloudflare R2 and keep only the sidecars in git (deferred; not v1).

## 8. Deployment

The site deploys as a Cloudflare Worker with static assets, built and deployed by Workers Builds on every push; no Worker script is needed in v1.

### `wrangler.jsonc`

```
{
  "name": "indigowire-site",
  "compatibility_date": "2026-10-25",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page"
  }
}
```

### Workers Builds settings

| Setting | Value |
| --- | --- |
| Repository | GitHub, `claudia-iwn/indigowire_website` (public) |
| Worker name | `indigowire-site` (Worker names allow only lowercase letters, digits and dashes, so it differs from the repo name) |
| Production branch | `main` |
| Build command | `npx astro build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branches | Builds enabled, for preview URLs (R13) |

### Repository and access

The repo is public under `claudia-iwn`, because the games and the image pipeline double as a portfolio of the consultancy's automation work. Workers Builds works the same with a private repo, so this can change later without touching hosting.

- **No secrets in the repo.** Nothing in v1 needs one; any future token goes in Workers settings, never in files.
- **Hermes pushes with a deploy key** (SSH key with write access to this repo only), not a personal token, so a leaked key cannot touch any other repo.
- **Sidecars are public.** Prompts appear only when the sidecar includes a `prompt` field.
- **Licensing:** code under MIT (`LICENSE`); images and written content all rights reserved (`CONTENT-LICENSE.md`).

### Domain

`indigowire.net` is registered at GoDaddy. Moving DNS to Cloudflare is all the site needs; moving the registration is optional. The domain also carries email, so its mail records must survive the move.

**Step 1: move DNS (required, before M0 ends)**

1. In Cloudflare, add `indigowire.net` on the Free plan; Cloudflare scans and imports the existing records.
2. Compare the imported records with GoDaddy's DNS page line by line. Check MX, SPF (TXT), DKIM and DMARC records especially, and set mail-related records to DNS only (grey cloud).
3. If DNSSEC is on at GoDaddy, turn it off before changing nameservers (re-enable it in Cloudflare afterwards).
4. At GoDaddy, replace the nameservers with the two Cloudflare gives you. Propagation can take minutes to 24 hours.
5. Send and receive a test email, then attach `indigowire.net` as a Workers custom domain and redirect `www` to the apex. Cloudflare issues the HTTPS certificate automatically.

**Step 2: transfer the registration (optional, any time later)**

- Cloudflare Registrar charges cost price with no markup, and a transfer adds one year to the current expiry.
- Requirements: the domain is active on Cloudflare, it was registered or last transferred more than 60 days ago, and the registrant name, organization or email has not changed in the last 60 days.
- At GoDaddy, turn off Domain Privacy and Domain Protection (GoDaddy may reject the transfer otherwise), unlock the domain, and copy the authorization code into Cloudflare's transfer page. GoDaddy has up to five days to release it.

### Free-tier limits

| Limit | Workers Free | Impact |
| --- | --- | --- |
| Build minutes | 3,000 per month | \~1,500–3,000 pushes |
| Concurrent builds | 1 | Rapid pushes queue |
| Static asset files | 20,000 per version | Thousands of images |
| File size | 25 MiB | WebP images far below |
| Static asset requests | Free, unlimited | Traffic costs nothing |
| Worker script requests | 100,000 per day | Not used in v1 |

### Rollback

A failed build never replaces the live version. To roll back a bad deploy, revert the commit on `main` or pick an earlier version in the Cloudflare dashboard.

## 9. Non-functional requirements

The site should be fast, accessible and private by default, with targets Claude Code can check automatically.

| ID | Area | Target | How it is checked |
| --- | --- | --- | --- |
| N1 | Performance | Lighthouse Performance ≥ 95 on Home, `/spark` and `/learn/arp` (mobile) | Lighthouse run before each milestone closes |
| N2 | JavaScript budget | 0 KB on content pages; ≤ 150 KB gzipped on a game page | Build output size check |
| N3 | Accessibility | WCAG 2.2 AA; Lighthouse Accessibility = 100 | Lighthouse + keyboard walk-through |
| N4 | Motion | All animation respects `prefers-reduced-motion` | Manual check with the OS setting on |
| N5 | Theming | Light and dark themes from `prefers-color-scheme`, plus a manual toggle | Visual check in both themes |
| N6 | Responsive | Works from 360 px to 1920 px with no horizontal scroll | Playwright at 360 and 1280 widths |
| N7 | Privacy | No cookies or browser storage for tracking; the only third-party scripts are Cloudflare Web Analytics and PostHog in cookieless mode | Network tab shows only the site's origin, Cloudflare Web Analytics and PostHog; Application tab shows no cookies |
| N8 | SEO and sharing | Title, description and Open Graph image on every page; Spark permalinks use the image as the OG image | View source |
| N9 | Maintainability | `npm run check` passes before every merge | Workers Builds log / local run |

### Visual identity

The site uses the existing Indigo Wire Networks logo (2018): a circular wire mark beside an "INDIGO WIRE" wordmark with "NETWORKS" beneath. Its three colors become the core design tokens in `src/styles/tokens.css`.

| Token | Hex | From the logo | Use on the site |
| --- | --- | --- | --- |
| `--iw-navy` | `#233067` | "INDIGO" and half the mark | Text, headings, dark-theme background base |
| `--iw-indigo` | `#091F92` | "NETWORKS" and half the mark | Links, primary buttons, focus rings |
| `--iw-copper-dark` | `#6E1401` | Shadow of "WIRE" | Copper gradient start |
| `--iw-copper` | `#99482D` | Body of "WIRE" | Accents, active states, frames in the ARP game |
| `--iw-copper-light` | `#F6B88C` | Highlight of "WIRE" | Copper gradient end, dark-theme accent |

**Logo assets** are in `indigowire_website/images/logos/logo-archive/` on the owner's computer: `.ai`, `.eps`, `.pdf` (vector masters) and `.png`, `.jpg` exports. For the web:

- Convert the PDF master to an SVG for the header (`public/logo.svg`), plus a light version for the dark theme.
- Make a favicon and app icon from the circular mark alone.
- Check contrast: navy and indigo on white pass WCAG AA for text; copper is for accents and large text only, unless a contrast check shows it passes.

The tone stays technical and playful rather than corporate, with network-diagram motifs and copper "wire" lines as the recurring decoration.

### Analytics

Three free layers, all cookieless, so the site needs no consent banner: Cloudflare's built-in metrics, Cloudflare Web Analytics for traffic and speed, and PostHog for what visitors do inside the games and gallery.

| Layer | What it measures | Free limit | Setup |
| --- | --- | --- | --- |
| Cloudflare zone and Workers metrics | Requests, bandwidth, status codes, threats at the edge | Included | Automatic once DNS is on Cloudflare |
| Cloudflare Web Analytics | Visits, page views, page load time, Core Web Vitals (LCP, INP, CLS) with the slowest elements named | No traffic cap | One beacon script in `BaseLayout` |
| PostHog (cookieless mode) | Custom events, funnels, trends, autocaptured clicks, unique visitors per day | 1M events/month, 1-year retention | `posthog-js` with `cookieless_mode: "always"` |

**PostHog events** (names in `snake_case`, defined once in `src/analytics.js`):

| Event | Fired when | Properties |
| --- | --- | --- |
| `outbound_click` | A blog, LinkedIn, Bluesky or GitHub link is clicked | `target` |
| `arp_send` | Send is pressed in the ARP game | `mode`, `cache_hit`, `off_subnet` |
| `arp_mode_change` | The ARP mode switches | `from`, `to` |
| `arp_inspector_open` | A frame is opened in the inspector | `frame_type` |
| `arp_learn_complete` | The last guided step is reached | `seconds` |
| `spark_filter` | A gallery category or tag filter is used | `category`, `tag` |

**Trade-offs of cookieless mode:** no session replay, no visitor country in PostHog (Cloudflare Web Analytics still shows countries), and returning visitors look new each day. Ad blockers may block PostHog; routing it through a small Worker on `indigowire.net` is a later option that would count against the 100,000 daily Worker requests.

## 10. Implementation plan

Seven milestones, each ending in a deployed, working site; hand Claude Code one milestone at a time and have it tick tasks here as they land.

### M0: Repo and deploy skeleton

- [ ] Add `indigowire.net` to Cloudflare, verify imported records (mail records especially), switch GoDaddy nameservers, confirm email still works (section 8, step 1)
- [x] Create the public repo `claudia-iwn/indigowire_website` with `LICENSE` (MIT) and `CONTENT-LICENSE.md`
- [x] Initialize an Astro project (static output, JavaScript)
- [x] Add `wrangler.jsonc`, Prettier, ESLint, Vitest and the `npm run check` script
- [x] Add `CLAUDE.md` and `docs/SPEC.md`
- [ ] Connect Workers Builds; confirm a "hello" page deploys to the workers.dev URL on push
- [ ] Attach `indigowire.net` as a custom domain and redirect `www` (R13)
- [ ] Add a deploy key for Hermes with write access to this repo only

### M1: Site shell

- [ ] Convert the logo's PDF master to `public/logo.svg` (plus a dark-theme version); make the favicon from the circular mark
- [ ] Design tokens from the logo palette in `tokens.css`, light and dark (section 9, N5)
- [ ] `BaseLayout`, Header, Footer, `site.config.js` with the external links (R1)
- [ ] Draft `pages/about.md` from the tailored-resume skill's career facts and the master CV; owner reviews before publishing (R2)
- [ ] Home, Contact and 404 pages (R3, R11 placeholder, R14)
- [ ] Playwright smoke test and Lighthouse baseline (N1, N3, N6)
- [ ] Turn on Cloudflare Web Analytics; add PostHog in cookieless mode and `src/analytics.js` with `outbound_click` (R15)

### M2: Content model and topics

- [ ] Collection schemas for `pages`, `learn`, `spark`; `tags.yaml` (section 4)
- [ ] `/learn` index and `/topics`, `/topics/<tag>` (R4, R10)

### M3: Spark gallery and pipeline

- [ ] Three sample entries, one per category
- [ ] `/spark`, permalinks, category pages, RSS (R6, R7, R12)
- [ ] `scripts/validate_spark.py` with tests; a broken sample proves the build fails (R9)
- [ ] Spark publisher with its tests and systemd unit; installed on the DGX Spark against the glue code's clone; one real image published end to end (R8)
- [ ] Fire `spark_filter` from gallery filters (R15)

### M4: ARP engine

- [ ] `engine.js` and `frames.js` with unit tests for every section 6 acceptance criterion

### M5: ARP view, Sandbox mode

- [ ] SVG topology, frame animation, cache and MAC-table panels, event log
- [ ] Frame inspector with linked hex dump
- [ ] Controls, keyboard support, reduced-motion behavior (N4)
- [ ] Feature it on Home (R11)
- [ ] Fire `arp_send`, `arp_mode_change`, `arp_inspector_open` and `arp_learn_complete`; build a PostHog dashboard for game use (R15)

### M6: ARP modes and polish

- [ ] Learn, Gratuitous ARP and Break-it modes
- [ ] Accessibility and Lighthouse pass on all pages (N1–N3)
- [ ] Open Graph images and metadata (N8)

## 11. Open questions

### Decided

| Question | Decision |
| --- | --- |
| External profile URLs | Set in section 5 |
| Domain | `indigowire.net` moves from GoDaddy DNS to Cloudflare DNS first; registrar transfer optional later (section 8) |
| Repo visibility | Public, under the `claudia-iwn` GitHub account (section 8) |
| Prompt on Spark permalinks | Optional per image: shown only when the sidecar has a `prompt` field; the model is always shown when present |
| About page content | Adapted from the career facts in the tailored-resume skill and the master CV; nothing invented |
| Visual identity | Existing Indigo Wire Networks logo and its colors (section 9) |
| Analytics | Maximum free and cookieless: Cloudflare metrics + Cloudflare Web Analytics + PostHog cookieless (section 9) |
| Cookie banner | None for now; session replay and PostHog geography stay off. Revisit only if those become worth a banner. |

### Still open

None. The spec is ready to export to `docs/SPEC.md` and start M0.

## Sources

- [Deploy your Astro site to Cloudflare](https://docs.astro.build/en/guides/deploy/cloudflare)
- [Workers Builds limits & pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits)
- [Transfer your domain to Cloudflare](https://developers.cloudflare.com/registrar/domain-transfers/transfer-to-cloudflare)
- [Troubleshoot failed domain transfers](https://developers.cloudflare.com/registrar/troubleshooting)
- [Cloudflare Pages vs Workers in 2026 (Morph)](https://www.morphllm.com/comparisons/cloudflare-pages-vs-workers)
- [GSAP standard license](https://gsap.com/community/standard-license/)
- [indigowire.net: Stack Recommendations](https://claude.ai/artifact/MC1QB2YdmMrmwxdbFYAXzB) (earlier doc)
- [Cloudflare Web Analytics: Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/)
- [PostHog pricing](https://posthog.com/pricing)
- [PostHog cookieless tracking](https://posthog.com/docs/privacy/cookieless-tracking)
