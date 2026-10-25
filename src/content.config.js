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
    // This is also the one place that sees both the file name and the data,
    // so it enforces "image has the same basename as the .md".
    generateId: ({ entry, data }) => {
      const name = path.basename(entry, '.md');
      const image = typeof data.image === 'string' ? path.basename(data.image) : '';
      if (image !== `${name}.webp`) {
        throw new Error(`spark/${entry}: image must be ./${name}.webp (got "${data.image}")`);
      }
      return name;
    },
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(80),
      // YAML turns an unquoted ISO timestamp into a Date; the offset requirement
      // is checked on the raw text by validate_spark.py.
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

export const collections = { tags, pages, learn, spark };
