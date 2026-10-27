/**
 * Search metadata (N11, spec section 9 "Search and AI search"): canonical URLs and the
 * schema.org structured data (JSON-LD) that search engines and AI assistants read to
 * learn who runs the site, what each page is and who made it. DOM-free, so Vitest can
 * test it; BaseLayout prints the result.
 *
 * Every fact about the person and the company comes from the About page. Add nothing
 * here that the site doesn't already say.
 */
import { site, externalLinks } from '../site.config.js';

/** Stable ids, so nodes on different pages can point at the same person and company. */
export const IDS = {
  website: `${site.url}/#website`,
  organization: `${site.url}/#organization`,
  person: `${site.url}/#person`,
  course: `${site.url}/learn#course`,
};

/**
 * The public path for a built page: no `.html`, no `index`, no trailing slash, matching
 * the site's links (astro.config.mjs: build.format 'file', trailingSlash 'never').
 * @param {string} pathname  Astro.url.pathname, e.g. "/about.html" or "/index.html".
 */
export function canonicalPath(pathname) {
  const path = pathname
    .replace(/\.html$/, '')
    .replace(/\/index$/, '/')
    .replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

/** @param {string} path */
export const absoluteUrl = (path) => new URL(path, site.url).href;

/**
 * The text for a <script type="application/ld+json"> block. `<` is escaped as <
 * (still valid JSON), so no string in the data can close the script element.
 * @param {object[]} graph
 */
export function jsonLdText(graph) {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

/** The website, the company and the person: on every page. */
export function siteGraph() {
  return [
    {
      '@type': 'WebSite',
      '@id': IDS.website,
      url: absoluteUrl('/'),
      name: site.name,
      description: site.description,
      inLanguage: 'en',
      publisher: { '@id': IDS.organization },
    },
    {
      '@type': 'Organization',
      '@id': IDS.organization,
      name: site.name,
      url: absoluteUrl('/'),
      logo: absoluteUrl('/icon-512.png'),
      description: 'Network architecture and automation consultancy run by Claudia de Luna since 2008.',
      foundingDate: '2008',
      founder: { '@id': IDS.person },
      knowsAbout: ['Network architecture', 'Network automation', 'Data center networking', 'Campus networking'],
      sameAs: externalLinks.filter((link) => link.id === 'github-iwn').map((link) => link.url),
    },
    {
      '@type': 'Person',
      '@id': IDS.person,
      name: 'Claudia de Luna',
      url: absoluteUrl('/about'),
      jobTitle: 'Network architect and automation engineer',
      worksFor: { '@id': IDS.organization },
      homeLocation: { '@type': 'Place', name: 'San Francisco Bay Area' },
      alumniOf: { '@type': 'CollegeOrUniversity', name: 'Stanford University' },
      award: 'NASA Exceptional Achievement Medal',
      hasCredential: {
        '@type': 'EducationalOccupationalCredential',
        name: 'Cisco Certified DevNet Associate',
        credentialCategory: 'certification',
      },
      memberOf: { '@type': 'Organization', name: 'Network Automation Forum' },
      knowsAbout: [
        'Network architecture',
        'Network automation',
        'Cisco ACI',
        'Python',
        'Netmiko',
        'Nornir',
        'Ansible',
        'Containerlab',
        'SuzieQ',
      ],
      // Like Python's [link.url for link in external_links]
      sameAs: externalLinks.map((link) => link.url),
    },
  ];
}

/**
 * @typedef {'WebPage' | 'AboutPage' | 'ProfilePage' | 'CollectionPage' | 'ContactPage'} PageType
 * @param {{ path: string, title: string, description: string, type?: PageType }} page
 */
export function webPageLd({ path, title, description, type = 'WebPage' }) {
  const url = absoluteUrl(path);
  return {
    '@type': type,
    '@id': `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: 'en',
    isPartOf: { '@id': IDS.website },
    ...(type === 'ProfilePage' ? { mainEntity: { '@id': IDS.person } } : {}),
  };
}

/**
 * Breadcrumbs below Home, which is always first.
 * @param {{ name: string, path: string }[]} trail
 */
export function breadcrumbLd(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...trail].map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** @param {Date} date  A calendar date, as YYYY-MM-DD. */
const day = (date) => date.toISOString().slice(0, 10);

/**
 * A game or article on /learn.
 * @param {{ path: string, title: string, description: string, published?: Date, updated?: Date, keywords?: string[], image?: string, interactive?: boolean, position?: number }} entry
 */
export function learningResourceLd({
  path,
  title,
  description,
  published,
  updated,
  keywords,
  image,
  interactive = true,
  position,
}) {
  return {
    '@type': 'LearningResource',
    '@id': `${absoluteUrl(path)}#resource`,
    url: absoluteUrl(path),
    name: title,
    description,
    learningResourceType: interactive ? 'interactive simulation' : 'article',
    educationalLevel: 'beginner',
    inLanguage: 'en',
    isAccessibleForFree: true,
    author: { '@id': IDS.person },
    publisher: { '@id': IDS.organization },
    ...(published ? { datePublished: day(published) } : {}),
    ...(updated ? { dateModified: day(updated) } : {}),
    ...(keywords?.length ? { keywords: keywords.join(', ') } : {}),
    ...(image ? { image: absoluteUrl(image) } : {}),
    ...(position ? { isPartOf: { '@id': IDS.course }, position } : {}),
  };
}

/**
 * A Spark image on its permalink.
 * @param {{ path: string, title: string, alt: string, caption?: string, image: string, date: Date, model?: string }} entry
 */
export function imageObjectLd({ path, title, alt, caption, image, date, model }) {
  return {
    '@type': 'ImageObject',
    '@id': `${absoluteUrl(path)}#image`,
    url: absoluteUrl(path),
    contentUrl: absoluteUrl(image),
    name: title,
    description: alt,
    ...(caption ? { caption } : {}),
    datePublished: date.toISOString(),
    creator: { '@id': IDS.person },
    copyrightHolder: { '@id': IDS.person },
    creditText: `Claudia de Luna / ${site.name}`,
    license: site.contentLicense,
    ...(model ? { contributor: { '@type': 'SoftwareApplication', name: model } } : {}),
  };
}

/**
 * Speaking engagements: podcasts as episodes, everything else as events.
 * @param {{ kind: string, date: string, title: string, event: string, location?: string, url?: string }[]} entries
 */
export function speakingLd(entries) {
  return {
    '@type': 'ItemList',
    name: 'Workshops, talks and takes by Claudia de Luna',
    itemListElement: entries.map((entry, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item:
        entry.kind === 'podcast'
          ? {
              '@type': 'PodcastEpisode',
              name: entry.title,
              datePublished: entry.date,
              partOfSeries: { '@type': 'PodcastSeries', name: entry.event },
              actor: { '@id': IDS.person },
              ...(entry.url ? { url: entry.url } : {}),
            }
          : {
              '@type': 'Event',
              name: entry.title,
              startDate: entry.date,
              superEvent: { '@type': 'Event', name: entry.event },
              performer: { '@id': IDS.person },
              ...(entry.location ? { location: { '@type': 'Place', name: entry.location } } : {}),
              ...(entry.url ? { url: entry.url } : {}),
            },
    })),
  };
}

/**
 * The course on /learn: "How networking works", with its available lessons.
 * @param {{ name: string, description: string, lessonPaths: string[] }} course
 */
export function courseLd({ name, description, lessonPaths }) {
  return {
    '@type': 'Course',
    '@id': IDS.course,
    url: absoluteUrl('/learn'),
    name,
    description,
    inLanguage: 'en',
    isAccessibleForFree: true,
    educationalLevel: 'beginner',
    provider: { '@id': IDS.organization },
    author: { '@id': IDS.person },
    hasPart: lessonPaths.map((path) => ({ '@id': `${absoluteUrl(path)}#resource` })),
  };
}
