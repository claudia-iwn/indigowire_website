// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://indigowire.net',
  // Emit about.html rather than about/index.html. Cloudflare's static assets then serve
  // /about directly with a 200, matching the site's links and canonical URLs, instead of
  // redirecting /about to /about/.
  trailingSlash: 'never',
  build: { format: 'file' },
});
