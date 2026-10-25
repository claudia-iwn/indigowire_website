/**
 * Collection queries shared by several routes.
 */
import { getCollection } from 'astro:content';

/** @typedef {import('astro:content').CollectionEntry<'spark'>} SparkEntry */
/** @typedef {import('astro:content').CollectionEntry<'learn'>} LearnEntry */

/**
 * Published Spark entries, newest first. Drafts never appear anywhere.
 * @returns {Promise<SparkEntry[]>}
 */
export async function getSpark() {
  const entries = await getCollection('spark', (entry) => !entry.data.draft);
  // Like Python's sorted(entries, key=lambda e: e.data.date, reverse=True)
  return entries.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** @returns {Promise<LearnEntry[]>} */
export async function getLearn() {
  const entries = await getCollection('learn');
  return entries.sort((a, b) => a.data.title.localeCompare(b.data.title));
}

/**
 * URL for a learn entry. Games get their own page in src/pages/learn/<component>.astro.
 * @param {LearnEntry} entry
 */
export function learnHref(entry) {
  return `/learn/${entry.data.component ?? entry.id}`;
}

/** Tag id → display name, from tags.yaml. */
export async function getTagNames() {
  const tags = await getCollection('tags');
  // Like a dict comprehension: {t.id: t.data.name for t in tags}
  return Object.fromEntries(tags.map((tag) => [tag.id, tag.data.name]));
}

/** @param {string} category */
export function categoryLabel(category) {
  return (
    { 'working-on': "What I'm working on", 'saw-this': 'Something I saw', mood: 'How I feel right now' }[category] ??
    category
  );
}
