/**
 * Site-wide settings and every external URL (spec section 5).
 * Components import from here; never hard-code a profile URL elsewhere.
 */

/**
 * @typedef {object} ExternalLink
 * @property {string} id      Stable key, also used as the analytics `target`.
 * @property {string} label   Text shown in the nav.
 * @property {string} url
 * @property {boolean} header Show in the header (the footer shows all links).
 */

export const site = {
  name: 'Indigo Wire Networks',
  domain: 'indigowire.net',
  url: 'https://indigowire.net',
  description: 'Network engineering, automation, interactive networking games and AI images from a DGX Spark.',
};

/** Internal navigation, in header order (R1). */
export const nav = [
  { label: 'Home', href: '/' },
  { label: 'Learn', href: '/learn' },
  { label: 'Spark', href: '/spark' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

/** @type {ExternalLink[]} */
export const externalLinks = [
  { id: 'blog', label: 'Blog', url: 'https://gratuitous-arp.net/', header: true },
  { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/claudiadeluna/', header: true },
  { id: 'bluesky', label: 'Bluesky', url: 'https://bsky.app/profile/delunac.bsky.social', header: true },
  { id: 'github-iwn', label: 'GitHub (Indigo Wire)', url: 'https://github.com/claudia-iwn', header: false },
  { id: 'github', label: 'GitHub (personal)', url: 'https://github.com/cldeluna', header: false },
];

/** @param {string} id */
export function linkById(id) {
  // .find() is like Python's next((l for l in links if ...), None)
  return externalLinks.find((link) => link.id === id);
}
