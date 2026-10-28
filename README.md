# indigowire.net

Static [Astro](https://astro.build) site for Indigo Wire Networks: consultancy pages, interactive networking games and a gallery of AI images from a DGX Spark. Deploys to Cloudflare Workers through Workers Builds on every push to `main`.

The full specification is [`docs/SPEC.md`](docs/SPEC.md). To adjust the speed of the "decrypt" text effects on Home, About and Speaking, see its section 9, "Decrypt effects" (the timings are constants at the top of `src/components/Decrypt.astro`).

```sh
git clone https://github.com/claudia-iwn/indigowire_website.git
cd indigowire_website
npm install        # Node LTS
uv sync            # Python content scripts
# Tests and Lighthouse also need Google Chrome installed (Playwright uses channel 'chrome';
# outside macOS set CHROME_PATH for scripts/lighthouse.mjs).
npm run dev        # http://localhost:4321
npm run check      # lint + Vitest + pytest + build + Playwright
```

Code is MIT (`LICENSE`); images and written content are all rights reserved (`CONTENT-LICENSE.md`).
