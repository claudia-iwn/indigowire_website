# indigowire.net

Static [Astro](https://astro.build) site for Indigo Wire Networks: consultancy pages, interactive networking games and a gallery of AI images from a DGX Spark. Deploys to Cloudflare Workers through Workers Builds on every push to `main`.

The full specification is [`docs/SPEC.md`](docs/SPEC.md).

```sh
git clone https://github.com/claudia-iwn/indigowire_website.git
cd indigowire_website
npm install        # Node LTS
uv sync            # Python content scripts
npm run dev        # http://localhost:4321
npm run check      # lint + Vitest + pytest + build
```

Code is MIT (`LICENSE`); images and written content are all rights reserved (`CONTENT-LICENSE.md`).
