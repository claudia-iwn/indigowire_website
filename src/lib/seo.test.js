import { describe, expect, it } from 'vitest';
import {
  canonicalPath,
  absoluteUrl,
  jsonLdText,
  siteGraph,
  webPageLd,
  breadcrumbLd,
  learningResourceLd,
  courseLd,
  imageObjectLd,
  speakingLd,
  IDS,
} from './seo.js';
import { externalLinks } from '../site.config.js';

describe('canonicalPath', () => {
  it('drops the .html the build adds, matching the links the site uses', () => {
    expect(canonicalPath('/about.html')).toBe('/about');
    expect(canonicalPath('/learn/arp.html')).toBe('/learn/arp');
    expect(canonicalPath('/index.html')).toBe('/');
    expect(canonicalPath('/learn/index.html')).toBe('/learn');
  });

  it('leaves clean paths alone and drops a trailing slash (trailingSlash: never)', () => {
    expect(canonicalPath('/')).toBe('/');
    expect(canonicalPath('/about')).toBe('/about');
    expect(canonicalPath('/learn/')).toBe('/learn');
  });

  it('makes absolute URLs on the real domain', () => {
    expect(absoluteUrl('/about')).toBe('https://indigowire.net/about');
    expect(absoluteUrl('/')).toBe('https://indigowire.net/');
  });
});

describe('jsonLdText', () => {
  it('wraps the nodes in one schema.org graph', () => {
    const data = JSON.parse(jsonLdText([{ '@type': 'Thing', name: 'x' }]));
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@graph']).toEqual([{ '@type': 'Thing', name: 'x' }]);
  });

  it('escapes < so content can never close the <script> block', () => {
    const text = jsonLdText([{ '@type': 'Thing', name: '</script><script>alert(1)</script>' }]);
    expect(text).not.toContain('</script>');
    expect(text).not.toContain('<');
    expect(JSON.parse(text)['@graph'][0].name).toBe('</script><script>alert(1)</script>');
  });
});

describe('siteGraph', () => {
  const [website, organization, person] = siteGraph();

  it('describes the website, published by the organization', () => {
    expect(website).toMatchObject({ '@type': 'WebSite', '@id': IDS.website, url: 'https://indigowire.net/' });
    expect(website.publisher).toEqual({ '@id': IDS.organization });
  });

  it('names Claudia de Luna as founder of Indigo Wire Networks, founded 2008', () => {
    expect(organization).toMatchObject({ '@type': 'Organization', name: 'Indigo Wire Networks', foundingDate: '2008' });
    expect(organization.founder).toEqual({ '@id': IDS.person });
    expect(organization.logo).toMatch(/^https:\/\/indigowire\.net\//);
  });

  it('describes the person only with facts from the About page, linked to every profile', () => {
    expect(person).toMatchObject({ '@type': 'Person', name: 'Claudia de Luna', url: 'https://indigowire.net/about' });
    expect(person.worksFor).toEqual({ '@id': IDS.organization });
    expect(person.alumniOf.name).toBe('Stanford University');
    expect(person.award).toBe('NASA Exceptional Achievement Medal');
    expect(person.knowsAbout).toContain('Network automation');
    for (const link of externalLinks) expect(person.sameAs).toContain(link.url);
  });
});

describe('page nodes', () => {
  it('gives each page a WebPage of the right kind, part of the website', () => {
    const page = webPageLd({ path: '/about', title: 'About', description: 'd', type: 'ProfilePage' });
    expect(page).toMatchObject({
      '@type': 'ProfilePage',
      '@id': 'https://indigowire.net/about#webpage',
      url: 'https://indigowire.net/about',
      isPartOf: { '@id': IDS.website },
    });
    expect(page.mainEntity).toEqual({ '@id': IDS.person });
  });

  it('builds breadcrumbs from Home down, with absolute URLs', () => {
    const crumbs = breadcrumbLd([
      { name: 'Learn', path: '/learn' },
      { name: 'How IPv4 ARP works', path: '/learn/arp' },
    ]);
    expect(crumbs['@type']).toBe('BreadcrumbList');
    expect(crumbs.itemListElement.map((/** @type {any} */ i) => [i.position, i.name, i.item])).toEqual([
      [1, 'Home', 'https://indigowire.net/'],
      [2, 'Learn', 'https://indigowire.net/learn'],
      [3, 'How IPv4 ARP works', 'https://indigowire.net/learn/arp'],
    ]);
  });

  it('marks a game as a free, interactive learning resource by its author', () => {
    const node = learningResourceLd({
      path: '/learn/arp',
      title: 'How IPv4 ARP works',
      description: 'd',
      published: new Date('2026-10-25T00:00:00Z'),
      updated: new Date('2026-10-27T00:00:00Z'),
      keywords: ['ARP', 'Ethernet'],
      image: '/og/arp.jpg',
    });
    expect(node).toMatchObject({
      '@type': 'LearningResource',
      learningResourceType: 'interactive simulation',
      isAccessibleForFree: true,
      datePublished: '2026-10-25',
      dateModified: '2026-10-27',
      keywords: 'ARP, Ethernet',
      image: 'https://indigowire.net/og/arp.jpg',
    });
    expect(node.author).toEqual({ '@id': IDS.person });
  });

  it('describes a Spark image with its creator, date, licence and AI model', () => {
    const node = imageObjectLd({
      path: '/spark/x',
      title: 'BGP weather',
      alt: 'a storm',
      caption: 'c',
      image: '/_astro/x.jpg',
      date: new Date('2026-10-25T14:05:00Z'),
      model: 'flux',
    });
    expect(node).toMatchObject({
      '@type': 'ImageObject',
      contentUrl: 'https://indigowire.net/_astro/x.jpg',
      name: 'BGP weather',
      caption: 'c',
      description: 'a storm',
      datePublished: '2026-10-25T14:05:00.000Z',
      license: expect.stringContaining('CONTENT-LICENSE.md'),
      creditText: 'Claudia de Luna / Indigo Wire Networks',
    });
    expect(node.creator).toEqual({ '@id': IDS.person });
    expect(node.copyrightHolder).toEqual({ '@id': IDS.person });
  });

  it('lists talks as events and podcasts as episodes, performed by the person', () => {
    const list = speakingLd([
      {
        kind: 'keynote',
        date: '2025-05-28',
        title: 'T',
        event: 'AutoCon3',
        location: 'Prague',
        url: 'https://e.example/',
      },
      { kind: 'podcast', date: '2024-03', title: 'P', event: 'Some Show' },
    ]);
    expect(list['@type']).toBe('ItemList');
    const [talk, podcast] = list.itemListElement.map((/** @type {any} */ i) => i.item);
    expect(talk).toMatchObject({
      '@type': 'Event',
      name: 'T',
      startDate: '2025-05-28',
      location: { '@type': 'Place', name: 'Prague' },
      superEvent: { '@type': 'Event', name: 'AutoCon3' },
      url: 'https://e.example/',
    });
    expect(talk.performer).toEqual({ '@id': IDS.person });
    expect(podcast).toMatchObject({ '@type': 'PodcastEpisode', name: 'P', datePublished: '2024-03' });
    expect(podcast.partOfSeries).toEqual({ '@type': 'PodcastSeries', name: 'Some Show' });
  });
});

describe('the course', () => {
  it('describes "How networking works" as a free beginner course with its available lessons', () => {
    const node = courseLd({ name: 'How networking works', description: 'd', lessonPaths: ['/learn/arp'] });
    expect(node).toMatchObject({
      '@type': 'Course',
      '@id': IDS.course,
      url: 'https://indigowire.net/learn',
      name: 'How networking works',
      isAccessibleForFree: true,
      educationalLevel: 'beginner',
      provider: { '@id': IDS.organization },
      hasPart: [{ '@id': 'https://indigowire.net/learn/arp#resource' }],
    });
  });

  it('marks a lesson as part of the course, at its position', () => {
    const node = learningResourceLd({ path: '/learn/arp', title: 't', description: 'd', position: 23 });
    expect(node.isPartOf).toEqual({ '@id': IDS.course });
    expect(node.position).toBe(23);
  });
});
