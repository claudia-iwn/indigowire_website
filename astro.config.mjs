// @ts-check
import { createHash } from 'node:crypto';
import { defineConfig } from 'astro/config';
import { BOOT_SCRIPT } from './src/lib/boot-script.js';

/**
 * A CSP source for an inline script: 'sha256-' plus the base64 digest of its exact text.
 * @param {string} text
 * @returns {`sha256-${string}`}
 */
const sha256 = (text) => `sha256-${createHash('sha256').update(text).digest('base64')}`;

// https://astro.build/config
export default defineConfig({
  site: 'https://indigowire.net',
  // Emit about.html rather than about/index.html. Cloudflare's static assets then serve
  // /about directly with a 200, matching the site's links and canonical URLs, instead of
  // redirecting /about to /about/.
  trailingSlash: 'never',
  build: { format: 'file' },
  // No syntax highlighting: Shiki colours code with inline styles, which the CSP blocks.
  // Code blocks render as plain <pre><code>.
  markdown: { syntaxHighlight: false },
  // Content Security Policy (N10), as a <meta> tag on every page. Astro hashes its own
  // scripts and styles; the one hand-written inline script (boot-script.js) is hashed
  // here from the same text the page prints. frame-ancestors can't go in a <meta>, so it
  // is in public/_headers with the other response headers.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "media-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      scriptDirective: {
        // Cloudflare injects its Web Analytics beacon into every page of a proxied zone
        // (automatic setup is the only option there); it reports to /cdn-cgi/rum on this
        // site, so connect-src stays 'self'.
        // 'report-sample' puts the first 40 characters of a blocked script in the violation
        // report, so the tests can tell Cloudflare's injected script from anything else.
        resources: ["'self'", 'https://static.cloudflareinsights.com', "'report-sample'"],
        hashes: [sha256(BOOT_SCRIPT)],
      },
    },
  },
});
