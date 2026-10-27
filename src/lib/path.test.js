import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { JOURNEY, buildCourse, placeOf, lessonFor, neighbours, chaptersForStep, lessonBreadcrumbs } from './path.js';

/** A small course in the shape of path.yaml after Astro has parsed it. */
function data(overrides = {}) {
  return {
    title: 'How networking works',
    question: 'What happens when I upload a photo to Leapix?',
    parts: [
      {
        id: 'how-devices-talk',
        title: 'How devices talk',
        chapters: [
          {
            id: 'why-a-network',
            title: 'Why?',
            summary: 's',
            why: 'w',
            deeper: ['neighbours'],
            lessons: [{ title: 'Why?', family: 'none', kind: 'article' }],
          },
          {
            id: 'whole-journey',
            title: 'Journey',
            summary: 's',
            lessons: [{ title: 'Journey', family: 'none', kind: 'game' }],
          },
        ],
      },
      {
        id: 'local',
        title: 'Your local network',
        chapters: [
          {
            id: 'addresses',
            title: 'Addresses',
            summary: 's',
            journey: 'laptop',
            lessons: [{ title: 'Masks', family: 'ipv4', kind: 'game', entry: { id: 'masks' } }],
          },
          {
            id: 'neighbours',
            title: 'Finding your neighbours',
            summary: 's',
            why: 'Cannot find the printer.',
            journey: 'link',
            lessons: [
              { title: 'How IPv4 ARP works', family: 'ipv4', kind: 'game', entry: { id: 'arp' } },
              { title: 'Neighbor Discovery', family: 'ipv6', kind: 'game', next: true },
              { title: 'ARP in Containerlab', family: 'none', kind: 'lab' },
            ],
          },
        ],
      },
      {
        id: 'names',
        title: 'Names',
        chapters: [
          {
            id: 'dns',
            title: 'DNS',
            summary: 's',
            journey: 'laptop',
            lessons: [{ title: 'DNS', family: 'none', kind: 'game', entry: { id: 'dns' } }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

const pages = {
  arp: { id: 'arp', title: 'How IPv4 ARP works', href: '/learn/arp', summary: 'a', published: new Date('2026-10-25') },
  masks: { id: 'masks', title: 'Masks', href: '/learn/masks', summary: 'm', published: new Date('2026-09-01') },
  dns: { id: 'dns', title: 'DNS', href: '/learn/dns', summary: 'd' },
};

describe('buildCourse', () => {
  it('numbers Part 0 as 0.1, 0.2… and every later chapter on from 1 across parts', () => {
    const course = buildCourse(data(), pages);
    expect(course.parts.map((p) => p.number)).toEqual([0, 1, 2]);
    expect(course.parts[0].chapters.map((c) => c.number)).toEqual(['0.1', '0.2']);
    expect(course.parts[1].chapters.map((c) => c.number)).toEqual(['1', '2']);
    expect(course.parts[2].chapters.map((c) => c.number)).toEqual(['3']);
  });

  it('derives each status: an entry makes it available, next makes it up next, else not available yet', () => {
    const course = buildCourse(data(), pages);
    const status = Object.fromEntries(course.lessons.map((l) => [l.title, l.status]));
    expect(status['How IPv4 ARP works']).toBe('available');
    expect(status['Neighbor Discovery']).toBe('next');
    expect(status['ARP in Containerlab']).toBe('planned');
    expect(course.next?.title).toBe('Neighbor Discovery');
  });

  it('gives lessons course positions, anchors and family labels', () => {
    const course = buildCourse(data(), pages);
    expect(course.lessons.map((l) => l.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const nd = course.lessons.find((l) => l.title === 'Neighbor Discovery');
    expect(nd?.familyLabel).toBe('IPv6');
    expect(nd?.chapter.anchor).toBe('chapter-neighbours');
    expect(nd?.part.anchor).toBe('part-1');
  });

  it('resolves "go deeper" ids to chapters', () => {
    const course = buildCourse(data(), pages);
    expect(course.parts[0].chapters[0].deeper.map((c) => c.number)).toEqual(['2']);
  });

  it('picks the latest available lesson by published date, and the first available as the start', () => {
    const course = buildCourse(data(), pages);
    expect(course.latest?.title).toBe('How IPv4 ARP works');
    expect(course.start?.title).toBe('Masks');
  });

  it('refuses two up-next lessons, an up-next lesson that is already available, an unknown entry, a duplicate chapter id and an unknown "go deeper" id', () => {
    const two = data();
    two.parts[1].chapters[1].lessons[2].next = true;
    expect(() => buildCourse(two, pages)).toThrow(/only one lesson can be next/);
    const ready = data();
    ready.parts[1].chapters[1].lessons[0].next = true;
    expect(() => buildCourse(ready, pages)).toThrow(/already available/);
    const missing = data();
    missing.parts[2].chapters[0].lessons[0].entry = { id: 'nope' };
    expect(() => buildCourse(missing, pages)).toThrow(/no page/);
    const dup = data();
    dup.parts[2].chapters[0].id = 'addresses';
    expect(() => buildCourse(dup, pages)).toThrow(/used twice/);
    const deeper = data();
    deeper.parts[0].chapters[0].deeper = ['nowhere'];
    expect(() => buildCourse(deeper, pages)).toThrow(/go deeper/);
  });
});

describe('a lesson in its course', () => {
  const course = buildCourse(data(), pages);
  const arp = /** @type {import('./path.js').Lesson} */ (lessonFor(course, 'arp'));

  it('finds a lesson by its learn entry, or null', () => {
    expect(arp.title).toBe('How IPv4 ARP works');
    expect(lessonFor(course, 'unknown')).toBeNull();
  });

  it('says where it sits', () => {
    expect(placeOf(arp)).toBe('Part 1 · Chapter 2 · Finding your neighbours · IPv4');
    expect(placeOf(course.lessons[0])).toBe('Part 0 · Lesson 0.1 · Why?');
  });

  it('links to the previous and next available lessons, skipping the rest', () => {
    expect(neighbours(course, arp).previous?.title).toBe('Masks');
    expect(neighbours(course, arp).next?.title).toBe('DNS');
    expect(neighbours(course, course.lessons[2]).previous).toBeNull();
  });

  it('builds breadcrumbs from Learn down to the lesson', () => {
    expect(lessonBreadcrumbs(arp)).toEqual([
      { name: 'Learn', path: '/learn' },
      { name: 'Part 1: Your local network', path: '/learn#part-1' },
      { name: 'Chapter 2: Finding your neighbours', path: '/learn#chapter-neighbours' },
      { name: 'How IPv4 ARP works', path: '/learn/arp' },
    ]);
  });
});

describe('the photo journey', () => {
  it('has seven steps in order, from laptop to friends', () => {
    expect(JOURNEY.map((s) => s.id)).toEqual([
      'laptop',
      'link',
      'home-router',
      'provider',
      'internet',
      'leapix',
      'friends',
    ]);
  });

  it('lists the chapters that explain a step, outside Part 0', () => {
    const course = buildCourse(data(), pages);
    expect(chaptersForStep(course, 'laptop').map((c) => c.id)).toEqual(['addresses', 'dns']);
    expect(chaptersForStep(course, 'friends')).toEqual([]);
  });
});

describe('src/content/path.yaml', () => {
  const raw = parse(readFileSync('src/content/path.yaml', 'utf8')).course;
  // Astro turns `entry: arp` into { id: 'arp' }; do the same here.
  for (const part of raw.parts)
    for (const ch of part.chapters) for (const l of ch.lessons) if (l.entry) l.entry = { id: l.entry };
  const course = buildCourse(raw, {
    arp: { id: 'arp', title: 'How IPv4 ARP works', href: '/learn/arp', summary: 's' },
  });

  it('has Part 0 with ten lessons and 34 numbered chapters after it', () => {
    expect(course.parts).toHaveLength(8);
    expect(course.parts[0].chapters).toHaveLength(10);
    expect(
      course.parts
        .slice(1)
        .flatMap((p) => p.chapters)
        .at(-1)?.number,
    ).toBe('34');
  });

  it('has ARP available in chapter 4 and IPv6 Neighbor Discovery up next', () => {
    expect(placeOf(/** @type {any} */ (lessonFor(course, 'arp')))).toBe(
      'Part 1 · Chapter 4 · Finding your neighbours · IPv4',
    );
    expect(course.next?.title).toBe('Neighbor Discovery');
  });
});
