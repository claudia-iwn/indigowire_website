/**
 * sitemap.xml (N11): every public page, for search engines. Hand-built XML like the RSS
 * feed, so no extra dependency. robots.txt points here.
 */
import { getRoutes } from '../lib/routes.js';
import { absoluteUrl } from '../lib/seo.js';

export async function GET() {
  const urls = (await getRoutes())
    .map(({ path, lastmod }) => {
      const date = lastmod ? `\n    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
      return `  <url>\n    <loc>${absoluteUrl(path)}</loc>${date}\n  </url>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
