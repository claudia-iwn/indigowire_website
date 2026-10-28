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
  /** The content licence (images and writing all rights reserved), for structured data. */
  contentLicense: 'https://github.com/claudia-iwn/indigowire_website/blob/main/CONTENT-LICENSE.md',
};

/**
 * An Open Graph image: what a link preview on Bluesky, LinkedIn or Slack shows (N8).
 * @typedef {{ src: string, alt: string, width: number, height: number }} ShareImage
 */

/**
 * The share cards in public/og/, made by `npm run og` (scripts/make_og_images.mjs).
 * Pages without their own pick one of these; Spark permalinks share their own image.
 * @type {Record<'default' | 'learn' | 'arp' | 'nd' | 'spark', ShareImage>}
 */
export const shareCards = {
  default: {
    src: '/og/default.jpg',
    alt: 'The Indigo Wire Networks logo beside indigo dye spreading through wet linen.',
    width: 1200,
    height: 630,
  },
  learn: {
    src: '/og/learn.jpg',
    alt: 'How networking works: the ARP simulator’s diagram, with an ARP request flooding from switch SW1 to H2, H3 and R1.',
    width: 1200,
    height: 630,
  },
  arp: {
    src: '/og/arp.jpg',
    alt: 'How IPv4 ARP works: the simulator’s diagram, with an ARP request flooding from switch SW1 to H2, H3 and R1.',
    width: 1200,
    height: 630,
  },
  nd: {
    src: '/og/nd.jpg',
    alt: 'How IPv6 Neighbor Discovery works: the simulator’s diagram, with a Neighbor Solicitation flooding from switch SW1 to H2, H3 and R1.',
    width: 1200,
    height: 630,
  },
  spark: {
    src: '/og/spark.jpg',
    alt: 'Spark: indigo pigment swirling in a dark vat.',
    width: 1200,
    height: 630,
  },
};

/** Internal navigation, in header order (R1). */
export const nav = [
  { label: 'Home', href: '/' },
  { label: 'Learn', href: '/learn' },
  { label: 'Spark', href: '/spark' },
  { label: 'About', href: '/about' },
  { label: 'Speaking', href: '/speaking' },
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
