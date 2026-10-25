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

/**
 * Speaking engagements, newest first. Dates are YYYY[-MM[-DD]] text, so a string
 * comparison sorts them (like Python's sorted(..., key=lambda e: e.data.date, reverse=True)).
 * @returns {Promise<import('astro:content').CollectionEntry<'speaking'>[]>}
 */
export async function getSpeaking() {
  const entries = await getCollection('speaking');
  return entries.sort((a, b) => b.data.date.localeCompare(a.data.date));
}

/**
 * Format a YYYY[-MM[-DD]] date at its own precision, e.g. "May 28, 2025", "Oct 2020", "2021".
 * @param {string} date
 */
export function formatPartialDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  if (!month) return String(year);
  const utc = new Date(Date.UTC(year, month - 1, day ?? 1));
  const options = day
    ? { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
    : { year: 'numeric', month: 'short', timeZone: 'UTC' };
  return new Intl.DateTimeFormat('en-US', /** @type {Intl.DateTimeFormatOptions} */ (options)).format(utc);
}

/** @param {string} category */
export function categoryLabel(category) {
  return (
    { 'working-on': "What I'm working on", 'saw-this': 'Something I saw', mood: 'How I feel right now' }[category] ??
    category
  );
}
