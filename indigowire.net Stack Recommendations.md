# indigowire.net: Stack Recommendations

Oct 25, 2026 · @Claudia

## Short answer

Build it with **HTML + CSS + JavaScript**, drawing the network in **SVG** and animating it with **GSAP**. Skip Java entirely.

## Java vs. JavaScript

They are unrelated languages that happen to share a name (a 1990s marketing decision). Java is a compiled language that runs on the JVM, mostly for back-end and Android apps. Browsers stopped running Java years ago. JavaScript is the only language browsers run natively, so anything interactive on the site will be JavaScript.

On a web page, the work splits three ways:

| Layer | Job | Examples |
| --- | --- | --- |
| HTML | Structure: what is on the page | Headings, links, the SVG drawing itself |
| CSS | Look: colors, layout, simple animation | Hover effects, fades, dark mode |
| JavaScript | Behavior: anything that responds to the visitor | Clicks, state, game logic |

CSS alone can make a nice looping animation of an ARP exchange. "Highly interactive" means the visitor changes what happens, and that needs JavaScript. Coming from Python it will feel familiar: functions, arrays (Python lists), objects (Python dicts), and events instead of a main loop.

## The ARP animation

Use SVG for the picture, GSAP for the motion, and plain JavaScript for the logic.

- **SVG for the topology.** Hosts, a switch, cables and frames are vector shapes in the page. They stay crisp at any size, take CSS styling, and every element is clickable, which is what makes it interactive rather than a video.
- **GSAP for motion.** The strongest JavaScript animation library, especially for timelines you can pause, rewind and scrub. Since Webflow acquired it, all of GSAP, including the formerly paid plugins, is free, and commercial use is covered ([GSAP license](https://gsap.com/community/standard-license/)).
- **Plain JavaScript for the logic.** A small model of each host's ARP cache and the switch's MAC table drives what the animation shows.

### Ideas to make it unusual

- **The visitor is the host.** They type a destination IP and press send, then watch the broadcast flood every switch port, every host but one ignore it, and the owner reply with a unicast.
- **Freeze-frame packet inspection.** Click any frame mid-flight to stop time and see a Wireshark-style decode (EtherType, opcode, sender and target MAC/IP) with the matching hex bytes highlighted.
- **Live tables.** The switch's MAC table and each host's ARP cache fill in as frames pass, then visibly age out.
- **Gratuitous ARP mode.** A natural nod to the blog's name.
- **"Break it" mode.** Duplicate IPs, or an attacker host poisoning caches, to show why ARP spoofing works.
- **Step-through and speed controls**, so it works for a quick look and for real study.

## The site itself

Use Astro as the framework, host on Cloudflare Workers, and have the Spark images arrive by git push.

**Framework: Astro.** It outputs static HTML, so hosting is free. Each game can be a self-contained interactive "island" on an otherwise lightweight page. Its content collections give categories and tags for both the learning material and the image gallery. Simpler alternatives are plain HTML or Eleventy, but the categorization would then be hand-built.

**Hosting: Cloudflare Workers.** Cloudflare recommends Workers with static assets for new projects, and Astro's deploy guide says the same ([Astro on Cloudflare](https://docs.astro.build/en/guides/deploy/cloudflare)). Workers Builds connects to the GitHub repo and rebuilds and deploys the site on every push. Requests for static files are free and unlimited, and Worker code can be added later for dynamic extras such as a puzzle leaderboard or a direct image-upload endpoint for Hermes.

**Spark image pipeline.** The Hermes skill would:

1. Save the image, converted to WebP to keep it small.
2. Write a small sidecar file with the date, caption, and a category: `working-on`, `saw-this`, or `mood`.
3. Commit and push. The site rebuilds and the gallery and category pages update automatically.

**Free-tier limits to watch** ([Workers Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits)):

| Limit | Workers Free | What it means here |
| --- | --- | --- |
| Build minutes | 3,000 per month | About 1,500 to 3,000 pushes, at 1 to 2 minutes per Astro build |
| Concurrent builds | 1 | Two quick pushes queue one after the other |
| Static asset files | 20,000 per version | Thousands of images before it matters |
| Single file size | 25 MiB | WebP images stay far below this |
| Worker code requests | 100,000 per day | Applies only to future dynamic features; static pages and images do not count |

If the gallery outgrows these, the images can move to Cloudflare R2 storage while the site stays the same.

## Next steps

- [ ] Build a working ARP prototype as a single HTML file, with comments comparing the JavaScript to Python
- [ ] Mock up the overall site look on the design canvas

## Sources

- [Workers Builds limits & pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits)
- [Deploy your Astro site to Cloudflare](https://docs.astro.build/en/guides/deploy/cloudflare)
- [Cloudflare Pages vs Workers in 2026 (Morph)](https://www.morphllm.com/comparisons/cloudflare-pages-vs-workers)
- [Webflow makes GSAP 100% free](https://webflow.com/updates/gsap-becomes-free)
- [GSAP standard license](https://gsap.com/community/standard-license/)
