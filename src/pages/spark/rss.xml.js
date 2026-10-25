/**
 * RSS feed of the latest 50 Spark entries (R12). Hand-built XML, so no extra dependency.
 */
import { site } from '../../site.config.js';
import { getSpark } from '../../lib/content.js';

/** @param {string} text */
const escapeXml = (text) =>
  text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c);

export async function GET() {
  const entries = (await getSpark()).slice(0, 50);
  const items = entries
    .map((entry) => {
      const link = new URL(`/spark/${entry.id}`, site.url).href;
      const description = entry.data.caption ?? entry.data.alt;
      return `    <item>
      <title>${escapeXml(entry.data.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${entry.data.date.toUTCString()}</pubDate>
      <category>${entry.data.category}</category>
      <description>${escapeXml(description)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site.name)}: Spark</title>
    <link>${new URL('/spark', site.url).href}</link>
    <description>AI images from a DGX Spark</description>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
