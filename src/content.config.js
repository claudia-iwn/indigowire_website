/**
 * Content collection schemas (spec section 4). A file that fails these
 * schemas fails the build, so it can never publish (R9).
 * scripts/validate_spark.py enforces the same spark rules; keep them in sync.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

export const SPARK_CATEGORIES = /** @type {const} */ (['working-on', 'saw-this', 'mood']);
export const LEARN_CATEGORIES = /** @type {const} */ (['layer-2', 'layer-3', 'automation', 'security']);

/**
 * Allowed tag ids: the top-level keys of tags.yaml. A tiny line scan instead of a
 * YAML library, because only the unindented `key:` lines matter here.
 * (Like Python's re.findall(r"^([a-z0-9-]+):", text, re.M).)
 */
const TAG_IDS = [...readFileSync('src/content/tags.yaml', 'utf8').matchAll(/^([a-z0-9-]+):/gm)].map((m) => m[1]);

/** ISO 8601 datetime with a UTC offset or Z. validate_spark.py uses the same pattern. */
const DATE_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_NO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Check the raw `date:` line of a sidecar, before YAML turns it into a Date.
 * @param {string} text Whole Markdown file.
 * @returns {string | null} Error message, or null when the date is valid.
 */
function checkRawDate(text) {
  const line = text.match(/^date:[ \t]*['"]?([^'"\s#]*)/m);
  if (!line) return null; // a missing date is reported by the schema
  if (DATE_WITH_OFFSET.test(line[1])) return null;
  if (DATE_NO_OFFSET.test(line[1])) return 'needs a UTC offset, e.g. 2026-10-25T14:05:00-07:00';
  return `is not an ISO 8601 datetime: ${line[1]}`;
}

/**
 * Spark bodies are rendered as HTML and written by an automated pipeline, so raw markup
 * and script-capable links are refused. validate_spark.py uses the same two patterns.
 * @param {string} text Whole Markdown file.
 * @returns {string | null} Error message, or null when the body is plain Markdown.
 */
function checkBody(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  if (/<[A-Za-z!/?]/.test(body)) return 'raw HTML is not allowed; use plain Markdown';
  if (/(\]\(|\]:)\s*<?\s*(javascript|vbscript|data):/i.test(body)) {
    return 'javascript:, vbscript: and data: links are not allowed';
  }
  return null;
}

const tagList = z.array(z.enum(/** @type {[string, ...string[]]} */ (TAG_IDS))).optional();

const tags = defineCollection({
  loader: file('src/content/tags.yaml'),
  schema: z.object({ name: z.string() }),
});

const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
});

const learn = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/learn' }),
  schema: z
    .object({
      title: z.string(),
      summary: z.string().max(140),
      // For search results and link previews; falls back to the summary (N11).
      description: z.string().max(200).optional(),
      // First published and last meaningfully changed, shown on the page and in structured data.
      published: z.coerce.date().optional(),
      updated: z.coerce.date().optional(),
      category: z.enum(LEARN_CATEGORIES),
      kind: z.enum(['game', 'article']),
      tags: tagList,
      component: z.string().optional(),
      featured: z.boolean().optional(),
    })
    .refine((d) => d.kind !== 'game' || Boolean(d.component), {
      message: 'games must name their `component` in src/games/',
      path: ['component'],
    }),
});

const spark = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/spark',
    // Permalink is /spark/<basename>, so ids drop the YYYY/MM/ folders.
    // This is also the one place that sees the file name, the data and the file
    // itself, so it enforces the same-basename image rule, the date format and the
    // body safety rule.
    generateId: ({ entry, base, data }) => {
      const name = path.basename(entry, '.md');
      const image = typeof data.image === 'string' ? path.basename(data.image) : '';
      if (image !== `${name}.webp`) {
        throw new Error(`spark/${entry}: image must be ./${name}.webp (got "${data.image}")`);
      }
      const text = readFileSync(new URL(entry, base), 'utf8');
      const dateError = checkRawDate(text);
      if (dateError) throw new Error(`spark/${entry}: date ${dateError}`);
      const bodyError = checkBody(text);
      if (bodyError) throw new Error(`spark/${entry}: body: ${bodyError}`);
      return name;
    },
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(80),
      // YAML has already turned the timestamp into a Date (dropping the offset);
      // generateId checked the raw text above.
      date: z.coerce.date(),
      category: z.enum(SPARK_CATEGORIES),
      image: image(),
      alt: z.string().min(1),
      caption: z.string().max(280).optional(),
      tags: tagList,
      model: z.string().optional(),
      draft: z.boolean().optional(),
      prompt: z.string().optional(),
    }),
});

export const SPEAKING_KINDS = /** @type {const} */ ([
  'keynote',
  'talk',
  'panel',
  'podcast',
  'workshop',
  'course',
  'delegate',
]);

const speaking = defineCollection({
  loader: file('src/content/speaking.yaml'),
  schema: z.object({
    kind: z.enum(SPEAKING_KINDS),
    // YYYY-MM-DD, YYYY-MM or YYYY. YAML turns a full date into a Date, so normalize back to text.
    date: z
      .union([z.date(), z.string(), z.number()])
      .transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)))
      .pipe(z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'use YYYY-MM-DD, YYYY-MM or YYYY')),
    title: z.string(),
    event: z.string(),
    location: z.string().optional(),
    role: z.string().optional(),
    url: z.url().optional(),
    video: z.url().optional(),
    code: z.url().optional(),
    source: z.string(),
  }),
});

export const collections = { tags, pages, learn, spark, speaking };
