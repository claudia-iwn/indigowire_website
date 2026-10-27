/**
 * llms.txt (N11): a plain-Markdown guide to the site for AI assistants, in the format
 * proposed at llmstxt.org: a title, a one-line summary, then sections of links. Built
 * from the same content as the pages, so it stays current, and it says nothing the
 * pages don't.
 */
import { getEntry } from 'astro:content';
import { site, externalLinks } from '../site.config.js';
import { getSpark, getCourse, categoryLabel } from '../lib/content.js';
import { absoluteUrl } from '../lib/seo.js';

/**
 * One Markdown list item: "- [title](url): note".
 * @param {string} title
 * @param {string} path  A site path or a full URL.
 * @param {string} [note]
 */
const item = (title, path, note) =>
  `- [${title}](${path.startsWith('http') ? path : absoluteUrl(path)})${note ? `: ${note}` : ''}`;

export async function GET() {
  const home = await getEntry('pages', 'home');
  const about = await getEntry('pages', 'about');
  const course = await getCourse();
  const spark = (await getSpark()).slice(0, 10);

  const text = `# ${site.name}

> ${home?.data.description ?? site.description}

Indigo Wire Networks is the network architecture and automation consultancy of Claudia de Luna, a network architect and automation engineer in the San Francisco Bay Area, running since 2008. It designs, automates and modernizes enterprise, data center and campus networks. The site also hosts interactive networking games that show how protocols work, and a gallery of AI images made on an NVIDIA DGX Spark.

## About

${[
  item('About Claudia de Luna', '/about', about?.data.description),
  item(
    'Workshops, talks and takes',
    '/speaking',
    'talks, keynotes, podcasts, workshops and courses on network automation and design',
  ),
  item('Contact', '/contact', 'through LinkedIn'),
].join('\n')}

## Learn: ${course.title}

The course starts from one question: ${course.question} Part 0 tells the whole journey for beginners; later parts go deeper. Lessons not yet written are listed without links.

${course.parts
  .map((part) =>
    [
      `### Part ${part.number}: ${part.title}`,
      ...part.chapters.map((chapter) => {
        const ready = chapter.lessons.filter((l) => l.page);
        const links = ready.map((l) => item(l.title, /** @type {any} */ (l.page).href, l.page?.summary)).join('\n');
        return `- ${chapter.number}. ${chapter.title}: ${chapter.summary}${links ? `\n${links.replace(/^/gm, '  ')}` : ''}`;
      }),
    ].join('\n'),
  )
  .join('\n\n')}

## Spark: AI images

${[
  item('Spark gallery', '/spark', 'every image, newest first'),
  ...spark.map((entry) =>
    item(
      entry.data.title,
      `/spark/${entry.id}`,
      `${categoryLabel(entry.data.category)}. ${entry.data.caption ?? entry.data.alt}`,
    ),
  ),
].join('\n')}

## Elsewhere

${externalLinks.map((link) => item(link.label, link.url)).join('\n')}

## Optional

${[
  item('Topics', '/topics', 'every tag across games, articles and images'),
  item('Spark RSS feed', '/spark/rss.xml'),
  item('Sitemap', '/sitemap.xml'),
].join('\n')}
`;
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
