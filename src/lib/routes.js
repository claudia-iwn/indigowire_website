/**
 * Every public page, for the sitemap and llms.txt (N11). Built from the same collections
 * as the pages themselves, so a new game, image or tag is listed automatically.
 */
import { SPARK_CATEGORIES } from '../content.config.js';
import { getSpark, getLearn, getTagNames, learnHref } from './content.js';

/**
 * @typedef {object} Route
 * @property {string} path     As the site links it: no .html, no trailing slash.
 * @property {Date} [lastmod]  Only where the content records a real date.
 */

/** Pages that aren't built from a collection. The 404 page is deliberately missing. */
const STATIC_PAGES = ['/', '/about', '/speaking', '/contact', '/learn', '/spark', '/topics'];

/** @returns {Promise<Route[]>} */
export async function getRoutes() {
  const learn = await getLearn();
  const spark = await getSpark();
  const names = await getTagNames();
  const tagged = [...learn, ...spark];
  return [
    ...STATIC_PAGES.map((path) => ({ path })),
    ...learn.map((entry) => ({ path: learnHref(entry), lastmod: entry.data.updated ?? entry.data.published })),
    ...spark.map((entry) => ({ path: `/spark/${entry.id}`, lastmod: entry.data.date })),
    ...SPARK_CATEGORIES.map((category) => ({ path: `/spark/category/${category}` })),
    // Only topics with something on them: an empty topic page is thin content.
    ...Object.keys(names)
      .filter((tag) => tagged.some((entry) => entry.data.tags?.includes(tag)))
      .map((tag) => ({ path: `/topics/${tag}` })),
  ];
}
