# Learning Path Scaffold (M7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/learn` into the course map for "How networking works" and replace Home's featured-game block with a course teaser, so new games can be added one line of YAML at a time.

**Architecture:** The whole course lives in one checked file, `src/content/path.yaml`, loaded as a `path` collection. A DOM-free module, `src/lib/path.js`, turns it into numbered parts, chapters and lessons with derived statuses ("available", "up next", "not available yet"). `src/lib/content.js` feeds it the `learn` collection. Pages and small components render what it returns: Home's teaser, the `/learn` map, and each lesson page's place in the course. Structured data and `llms.txt` describe the course for search.

**Tech Stack:** Astro 7 (static), JavaScript with JSDoc, plain CSS with tokens, Vitest, Playwright, Python via uv (only for `npm run check`'s pytest).

## Global Constraints

Copied from `CLAUDE.md` and `docs/SPEC.md`; every task must keep them.

- JavaScript with JSDoc type comments, never TypeScript. Plain CSS with custom properties from `src/styles/tokens.css`; never hard-code a colour.
- No new dependency (runtime or dev).
- Content pages ship zero JavaScript apart from the N2 exceptions. Home's journey animation is CSS only.
- Every animation respects `prefers-reduced-motion` and the header `>_` switch (`html[data-effects='off']`).
- CSP (N10): no `is:inline` scripts, no `style=""` attributes, no `set:html` with content, nothing loaded from another site.
- Example names: made-up domains only under `.example` (the course's photo site is `leapix.example`); IPv4 only RFC 5737, IPv6 only 2001:db8::/32, MACs only 00:00:5e:00:53:xx.
- Comments are written for a Python developer learning JavaScript: a one-line Python comparison where the JS is non-obvious.
- Search (N11): every page keeps a unique title and a description of at least 70 characters.
- Planned lessons get no page of their own (spec section 12, "No empty pages").
- Statuses are words, not colour alone (WCAG 2.2 AA).
- `npm run check` must pass at the end of every task. **Do not commit**: the owner commits with "commit and push".
- Spec: `docs/SPEC.md` section 12 is the source of truth; record any decision that changes it, in the same task.

## File structure

| File | Responsibility |
| --- | --- |
| `src/content/path.yaml` (create) | The course: title, question, eight parts (0 to 7), their chapters and lessons |
| `src/content.config.js` (modify) | `path` collection schema; drop `featured` from `learn` |
| `src/lib/path.js` (create) | `JOURNEY`, `buildCourse`, `placeOf`, `lessonFor`, `neighbours`, `chaptersForStep`, `lessonBreadcrumbs` |
| `src/lib/path.test.js` (create) | Vitest for `path.js` |
| `src/lib/content.js` (modify) | `getCourse()` |
| `src/components/JourneyPicture.astro` (create) | The decorative SVG of the photo's journey, with Leapix's snow leopard |
| `src/components/JourneyStrip.astro` (create) | The seven journey steps as an ordered list, optionally linked |
| `src/pages/index.astro` (modify) | Home teaser |
| `src/pages/learn/index.astro` (modify) | The course map |
| `src/components/LessonBreadcrumbs.astro`, `LessonPlace.astro`, `LessonNav.astro` (create) | A lesson's place in the course |
| `src/pages/learn/arp.astro`, `src/pages/learn/[slug].astro` (modify) | Use them |
| `src/games/arp/lesson.js`, `lesson.test.js` (modify) | The VLAN note |
| `src/lib/seo.js`, `seo.test.js` (modify) | `courseLd`, `isPartOf` |
| `src/pages/llms.txt.js` (modify) | Course outline |
| `tests/smoke.spec.js` (modify) | Home, `/learn`, lesson placement, search |
| `src/content/learn/arp.md` (modify) | Drop `featured` |
| `docs/SPEC.md`, `CLAUDE.md` (modify) | Ticks and current state |

---

### Task 1: Course data and `path.js`

**Files:**
- Create: `src/lib/path.js`, `src/lib/path.test.js`, `src/content/path.yaml`
- Modify: `src/content.config.js`, `src/lib/content.js`

**Interfaces:**
- Produces (all later tasks use these exact names):
  - `JOURNEY: readonly { id: 'laptop'|'link'|'home-router'|'provider'|'internet'|'leapix'|'friends', label: string, text: string }[]`
  - `buildCourse(data: CourseData, pages: Record<string, LessonPage>): Course`
  - `placeOf(lesson: Lesson): string`, e.g. `"Part 1 · Chapter 4 · Finding your neighbours · IPv4"`
  - `lessonFor(course: Course, entryId: string): Lesson | null`
  - `neighbours(course: Course, lesson: Lesson): { previous: Lesson | null, next: Lesson | null }` (available lessons only)
  - `chaptersForStep(course: Course, stepId: string): Chapter[]`
  - `lessonBreadcrumbs(lesson: Lesson): { name: string, path: string }[]` (below Home, for `BaseLayout`)
  - `getCourse(): Promise<Course>` in `src/lib/content.js`
  - Types: `Lesson { title, family, familyLabel, kind, status: 'available'|'next'|'planned', page?: LessonPage, note?, position, chapter, part }`, `Chapter { id, number: string, title, summary, why?, journey?, deeper: Chapter[], anchor, part, lessons }`, `Part { id, number: number, title, anchor, chapters }`, `Course { title, question, parts, lessons, next, latest, start }`, `LessonPage { id, title, href, summary, published?: Date }`

- [ ] **Step 1: Write the failing tests** in `src/lib/path.test.js`:

```js
import { describe, expect, it } from 'vitest';
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
          { id: 'why-a-network', title: 'Why?', summary: 's', why: 'w', deeper: ['neighbours'], lessons: [{ title: 'Why?', family: 'none', kind: 'article' }] },
          { id: 'whole-journey', title: 'Journey', summary: 's', lessons: [{ title: 'Journey', family: 'none', kind: 'game' }] },
        ],
      },
      {
        id: 'local',
        title: 'Your local network',
        chapters: [
          { id: 'addresses', title: 'Addresses', summary: 's', journey: 'laptop', lessons: [{ title: 'Masks', family: 'ipv4', kind: 'game', entry: { id: 'masks' } }] },
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
      { id: 'names', title: 'Names', chapters: [{ id: 'dns', title: 'DNS', summary: 's', journey: 'laptop', lessons: [{ title: 'DNS', family: 'none', kind: 'game', entry: { id: 'dns' } }] }] },
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
    expect(JOURNEY.map((s) => s.id)).toEqual(['laptop', 'link', 'home-router', 'provider', 'internet', 'leapix', 'friends']);
  });

  it('lists the chapters that explain a step, outside Part 0', () => {
    const course = buildCourse(data(), pages);
    expect(chaptersForStep(course, 'laptop').map((c) => c.id)).toEqual(['addresses', 'dns']);
    expect(chaptersForStep(course, 'friends')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/path.test.js`
Expected: FAIL, "Cannot find module './path.js'".

- [ ] **Step 3: Write `src/lib/path.js`**

```js
/**
 * The course "How networking works" (spec section 12, R17) as plain data: numbers,
 * statuses, places and neighbours, worked out from src/content/path.yaml. DOM-free and
 * free of Astro imports, so Vitest can test it; getCourse() in content.js feeds it.
 */

/** The photo's journey: the spine of /learn and the picture on Home (spec section 12). */
export const JOURNEY = /** @type {const} */ ([
  { id: 'laptop', label: 'Your laptop', text: 'The laptop has an address, looks up leapix.example and packs the photo into messages.' },
  { id: 'link', label: 'Wi-Fi or cable', text: 'The messages cross the air to the access point, or a cable to the switch, onto the home network.' },
  { id: 'home-router', label: 'Home router', text: 'The router passes them out of the home network.' },
  { id: 'provider', label: 'Your provider', text: 'The internet provider carries them onward.' },
  { id: 'internet', label: 'The internet', text: 'Networks hand them from one to the next.' },
  { id: 'leapix', label: 'Leapix', text: 'They arrive, securely, at Leapix’s servers in a data center or the cloud, where the photo is put back together and stored.' },
  { id: 'friends', label: 'Your friends see it', text: 'Friends’ devices fetch the photo from Leapix over their own networks.' },
]);

/** @type {Record<string, string>} */
const FAMILY_LABEL = { ipv4: 'IPv4', ipv6: 'IPv6', none: '' };

/**
 * @typedef {{ id: string, title: string, href: string, summary: string, published?: Date }} LessonPage
 * @typedef {{ title: string, family: 'ipv4' | 'ipv6' | 'none', kind: 'game' | 'article' | 'lab', entry?: { id: string }, next?: true, note?: string }} LessonData
 * @typedef {{ id: string, title: string, summary: string, why?: string, journey?: string, deeper?: string[], lessons: LessonData[] }} ChapterData
 * @typedef {{ id: string, title: string, chapters: ChapterData[] }} PartData
 * @typedef {{ title: string, question: string, parts: PartData[] }} CourseData
 *
 * @typedef {object} Part
 * @property {string} id
 * @property {number} number   0 to 7, by position.
 * @property {string} title
 * @property {string} anchor   Fragment on /learn, e.g. "part-1".
 * @property {Chapter[]} chapters
 *
 * @typedef {object} Chapter
 * @property {string} id
 * @property {string} number   "0.1" to "0.10" in Part 0, then "1", "2"… across the course.
 * @property {string} title
 * @property {string} summary
 * @property {string} [why]
 * @property {string} [journey]
 * @property {Chapter[]} deeper  Part 0's "go deeper" chapters.
 * @property {string} anchor   Fragment on /learn, e.g. "chapter-dns".
 * @property {Part} part
 * @property {Lesson[]} lessons
 *
 * @typedef {object} Lesson
 * @property {string} title
 * @property {'ipv4' | 'ipv6' | 'none'} family
 * @property {string} familyLabel  "IPv4", "IPv6" or "".
 * @property {'game' | 'article' | 'lab'} kind
 * @property {'available' | 'next' | 'planned'} status
 * @property {LessonPage} [page]   Only when available.
 * @property {string} [note]
 * @property {number} position     1-based, in course order.
 * @property {Chapter} chapter
 * @property {Part} part
 *
 * @typedef {object} Course
 * @property {string} title
 * @property {string} question
 * @property {Part[]} parts
 * @property {Lesson[]} lessons      Every lesson, in course order.
 * @property {Lesson | null} next    The "Up next" lesson.
 * @property {Lesson | null} latest  The most recently published available lesson.
 * @property {Lesson | null} start   The first available lesson.
 */

/**
 * Number, link and check the course. Throws on mistakes, so a bad path.yaml fails the build.
 * @param {CourseData} data          The `course` entry of the path collection.
 * @param {Record<string, LessonPage>} pages  Learn entries by id (like a Python dict).
 * @returns {Course}
 */
export function buildCourse(data, pages) {
  /** @type {Lesson[]} */
  const lessons = [];
  /** @type {Map<string, Chapter>} */
  const chapters = new Map();
  /** @type {[Chapter, string[]][]} "go deeper" ids, resolved once every chapter exists. */
  const deeper = [];
  let count = 0;

  const parts = data.parts.map((partData, p) => {
    /** @type {Part} */
    const part = { id: partData.id, number: p, title: partData.title, anchor: `part-${p}`, chapters: [] };
    part.chapters = partData.chapters.map((c, i) => {
      if (chapters.has(c.id)) throw new Error(`path.yaml: chapter id "${c.id}" is used twice`);
      /** @type {Chapter} */
      const chapter = {
        id: c.id,
        number: p === 0 ? `0.${i + 1}` : String(++count),
        title: c.title,
        summary: c.summary,
        why: c.why,
        journey: c.journey,
        deeper: [],
        anchor: `chapter-${c.id}`,
        part,
        lessons: [],
      };
      chapter.lessons = c.lessons.map((l) => {
        const page = l.entry ? pages[l.entry.id] : undefined;
        if (l.entry && !page) throw new Error(`path.yaml: lesson "${l.title}" names entry "${l.entry.id}", which has no page`);
        if (l.next && page) throw new Error(`path.yaml: lesson "${l.title}" is marked next but is already available`);
        /** @type {Lesson} */
        const lesson = {
          title: l.title,
          family: l.family,
          familyLabel: FAMILY_LABEL[l.family],
          kind: l.kind,
          status: page ? 'available' : l.next ? 'next' : 'planned',
          page,
          note: l.note,
          position: lessons.length + 1,
          chapter,
          part,
        };
        lessons.push(lesson);
        return lesson;
      });
      chapters.set(c.id, chapter);
      deeper.push([chapter, c.deeper ?? []]);
      return chapter;
    });
    return part;
  });

  for (const [chapter, ids] of deeper) {
    chapter.deeper = ids.map((id) => {
      const target = chapters.get(id);
      if (!target) throw new Error(`path.yaml: chapter "${chapter.id}" says go deeper into "${id}", which doesn't exist`);
      return target;
    });
  }

  const nexts = lessons.filter((l) => l.status === 'next');
  if (nexts.length > 1) {
    throw new Error(`path.yaml: only one lesson can be next; found ${nexts.map((l) => l.title).join(', ')}`);
  }
  const available = lessons.filter((l) => l.status === 'available');
  // Like Python's max(available, key=published): newest first, undated last.
  const latest = [...available].sort(
    (a, b) => (b.page?.published?.valueOf() ?? 0) - (a.page?.published?.valueOf() ?? 0),
  )[0];
  return {
    title: data.title,
    question: data.question,
    parts,
    lessons,
    next: nexts[0] ?? null,
    latest: latest ?? null,
    start: available[0] ?? null,
  };
}

/**
 * "Part 1 · Chapter 4 · Finding your neighbours · IPv4"; Part 0's chapters are lessons.
 * @param {Lesson} lesson
 */
export function placeOf(lesson) {
  const unit = lesson.part.number === 0 ? 'Lesson' : 'Chapter';
  const parts = [`Part ${lesson.part.number}`, `${unit} ${lesson.chapter.number}`, lesson.chapter.title];
  if (lesson.familyLabel) parts.push(lesson.familyLabel);
  return parts.join(' · ');
}

/**
 * The lesson whose page is this learn entry, or null if the entry isn't in the course.
 * @param {Course} course
 * @param {string} entryId
 */
export function lessonFor(course, entryId) {
  return course.lessons.find((l) => l.page?.id === entryId) ?? null;
}

/**
 * The previous and next available lessons in course order.
 * @param {Course} course
 * @param {Lesson} lesson
 */
export function neighbours(course, lesson) {
  const available = course.lessons.filter((l) => l.status === 'available');
  const i = available.indexOf(lesson);
  return { previous: available[i - 1] ?? null, next: i >= 0 ? (available[i + 1] ?? null) : null };
}

/**
 * The chapters (outside Part 0) that explain one step of the photo's journey.
 * @param {Course} course
 * @param {string} stepId
 */
export function chaptersForStep(course, stepId) {
  return course.parts.slice(1).flatMap((part) => part.chapters.filter((c) => c.journey === stepId));
}

/**
 * Learn › Part › Chapter › Lesson, as BaseLayout's breadcrumbs (below Home).
 * @param {Lesson} lesson
 * @returns {{ name: string, path: string }[]}
 */
export function lessonBreadcrumbs(lesson) {
  const unit = lesson.part.number === 0 ? 'Lesson' : 'Chapter';
  return [
    { name: 'Learn', path: '/learn' },
    { name: `Part ${lesson.part.number}: ${lesson.part.title}`, path: `/learn#${lesson.part.anchor}` },
    { name: `${unit} ${lesson.chapter.number}: ${lesson.chapter.title}`, path: `/learn#${lesson.chapter.anchor}` },
    { name: lesson.page?.title ?? lesson.title, path: lesson.page?.href ?? '/learn' },
  ];
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/path.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Add the `path` collection** to `src/content.config.js`. Change the import line to add `reference`:

```js
import { defineCollection, reference } from 'astro:content';
```

Add after the `import { z } from 'astro/zod';` line:

```js
import { JOURNEY } from './lib/path.js';
```

Add before `export const SPEAKING_KINDS`:

```js
/** The learning path (spec section 12, R17): one entry, `course`, holding every part. */
const lesson = z.object({
  title: z.string(),
  family: z.enum(['ipv4', 'ipv6', 'none']),
  kind: z.enum(['game', 'article', 'lab']),
  // An unknown learn entry id fails the build (like a foreign key).
  entry: reference('learn').optional(),
  next: z.literal(true).optional(),
  note: z.string().optional(),
});
const chapter = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string(),
  summary: z.string().max(140),
  why: z.string().optional(),
  journey: z.enum(/** @type {[string, ...string[]]} */ (JOURNEY.map((step) => step.id))).optional(),
  deeper: z.array(z.string()).optional(),
  lessons: z.array(lesson).min(1),
});
const path = defineCollection({
  loader: file('src/content/path.yaml'),
  schema: z.object({
    title: z.string(),
    question: z.string(),
    parts: z
      .array(z.object({ id: z.string(), title: z.string(), chapters: z.array(chapter).min(1) }))
      .min(1),
  }),
});
```

Change the last line to:

```js
export const collections = { tags, pages, learn, spark, speaking, path };
```

- [ ] **Step 6: Write `src/content/path.yaml`** with the whole course from spec section 12:

```yaml
# The course "How networking works" (spec section 12, R17). One entry, `course`.
# Numbers are positions, never stored: Part 0's chapters are 0.1 to 0.10, and later
# chapters count on from 1. A lesson with `entry` is available; the one lesson with
# `next: true` is up next; everything else is not available yet.
# To ship a lesson: add its learn entry, set `entry: <id>`, and move `next` on.
course:
  title: How networking works
  question: What happens when I upload a photo to Leapix?
  parts:
    - id: how-devices-talk
      title: How devices talk
      chapters:
        - id: why-a-network
          title: Why do we need a network?
          summary: Your device has something another device wants, or wants something another device has.
          why: Your photo is on your laptop; your friends are somewhere else.
          lessons:
            - { title: Why do we need a network?, family: none, kind: article }
        - id: whats-connected
          title: What's connected to what?
          summary: Devices, and the cables and radio links that join them. The laptop isn't the network; it joins one.
          why: Before anything can travel, something has to connect the laptop to everything else.
          deeper: [what-is-a-network]
          lessons:
            - { title: What's connected to what?, family: none, kind: game }
        - id: without-a-wire
          title: Talking without a wire
          summary: Wi-Fi is another kind of link, not another kind of network.
          why: The laptop has no cable plugged in, yet the photo still leaves it.
          deeper: [what-is-a-network]
          lessons:
            - { title: Talking without a wire, family: none, kind: article }
        - id: connecting-boxes
          title: The connecting boxes
          summary: "Switch, access point and router: local delivery, and delivery to another neighbourhood, one job at a time."
          why: Something has to pass the photo along, near and far.
          deeper: [what-is-a-network, leaving-the-lan]
          lessons:
            - { title: The connecting boxes, family: none, kind: game }
        - id: where-to-go
          title: How does a message know where to go?
          summary: "Addresses: why a letter with no address goes nowhere, and how devices get theirs."
          why: A letter with no address goes nowhere.
          deeper: [addresses, getting-an-address, finding-your-neighbours]
          lessons:
            - { title: How does a message know where to go?, family: none, kind: game }
        - id: big-picture
          title: How does a big picture travel?
          summary: "Too big to send in one go: packets, and the agreed rules for sending them, called protocols."
          why: The photo is far too big to send in one piece.
          deeper: [ports-tcp-udp]
          lessons:
            - { title: How does a big picture travel?, family: none, kind: game }
        - id: our-network-or-internet
          title: Is our network the internet?
          summary: Sharing at home and reaching the world are different journeys.
          why: Printing at home works even when the internet is down. Why?
          deeper: [routing, nat, the-internet]
          lessons:
            - { title: Is our network the internet?, family: none, kind: game }
        - id: other-end
          title: Who's on the other end?
          summary: "One device asks, another provides: your laptop and Leapix's servers, client and server."
          why: The photo has to end up somewhere that keeps it and shows it to friends.
          deeper: [dns, ports-tcp-udp]
          lessons:
            - { title: Who's on the other end?, family: none, kind: game }
        - id: keeping-safe
          title: Keeping it safe
          summary: Passwords, private information and secure connections, and why they matter on every network.
          why: Anyone could be listening along the way.
          deeper: [keeping-it-safe]
          lessons:
            - { title: Keeping it safe, family: none, kind: game }
        - id: whole-journey
          title: The whole journey
          summary: "Click Upload, then tell the story: every step from your laptop to your friends."
          why: You click Upload. How does your photo reach Leapix, and your friends?
          lessons:
            - { title: The whole journey, family: none, kind: game }

    - id: your-local-network
      title: Your local network
      chapters:
        - id: what-is-a-network
          title: What is a network?
          summary: Devices, links, switches and routers, the real LAN behind the diagrams, and wireless as a link without the cable.
          why: "Wi-Fi shows full bars but nothing loads: which part is broken?"
          journey: link
          lessons:
            - { title: "Devices, links, switches and routers", family: none, kind: article }
            - { title: "Wireless: a link without the cable", family: none, kind: article }
            - { title: The real LAN in Containerlab, family: none, kind: lab }
        - id: addresses
          title: Addresses
          summary: "MAC, IPv4 and IPv6: the names devices use, and a small toolbox for binary and hex."
          why: A settings screen asks for an "IP address" and you have no idea what goes there.
          journey: laptop
          lessons:
            - { title: MAC addresses, family: none, kind: article }
            - { title: "IPv4 addresses and masks: are we on the same network?", family: ipv4, kind: game }
            - { title: "IPv6 addresses and prefixes: reading and shortening them", family: ipv6, kind: game }
            - { title: "Toolbox: binary and hex", family: none, kind: article }
        - id: getting-an-address
          title: Getting an address (DHCP, part 1)
          summary: How a device gets an address the moment it joins a network.
          why: Connected to Wi-Fi, but no internet.
          journey: laptop
          lessons:
            - { title: "DHCP: Discover, Offer, Request, Acknowledge", family: ipv4, kind: game }
            - { title: SLAAC and DHCPv6, family: ipv6, kind: game }
        - id: finding-your-neighbours
          title: Finding your neighbours
          summary: How a device finds the hardware address of the next device on the same network.
          why: Your laptop and the printer are on the same Wi-Fi but can't find each other.
          journey: link
          lessons:
            - { title: How IPv4 ARP works, family: ipv4, kind: game, entry: arp }
            - { title: Neighbor Discovery, family: ipv6, kind: game, next: true }
            - { title: "Try it for real: ARP in Containerlab", family: none, kind: lab }
        - id: broadcasts-and-vlans
          title: Broadcasts and VLANs
          summary: Who hears a broadcast, and how VLANs split one switch into separate networks. IPv6 uses multicast instead.
          why: Guest Wi-Fi can't reach the office printer, on purpose.
          journey: link
          lessons:
            - { title: Broadcast domains and VLANs, family: ipv4, kind: game }
            - { title: Multicast instead of broadcast, family: ipv6, kind: game }
        - id: leaving-the-lan
          title: Leaving the LAN
          summary: "The default gateway: how traffic leaves the local network."
          why: You can print, but you can't reach the internet.
          journey: home-router
          lessons:
            - { title: The default gateway, family: ipv4, kind: game }
            - { title: Router advertisements, family: ipv6, kind: game }

    - id: names-and-conversations
      title: Names and conversations
      chapters:
        - id: dns
          title: "Names: DNS"
          summary: How a name like leapix.example becomes an address, and how a device learns which DNS servers to ask.
          why: Websites won't load by name, yet the network looks fine.
          journey: laptop
          lessons:
            - { title: "How a name becomes an address: A and AAAA records", family: none, kind: game, note: "From the field: some of the worst outages turn out to be DNS." }
            - { title: "DHCP, part 2: learning the DNS servers", family: ipv4, kind: game }
            - { title: "DHCP, part 2: RDNSS and DHCPv6", family: ipv6, kind: game }
        - id: ports-tcp-udp
          title: "Conversations: ports, TCP and UDP"
          summary: How many conversations share one connection, and the difference between reliable and fast.
          why: One app works and another doesn't, over the same connection.
          journey: leapix
          lessons:
            - { title: "Ports, TCP and UDP", family: none, kind: game }
        - id: keeping-it-safe
          title: "Keeping it safe: firewalls and encrypted connections"
          summary: Firewalls decide which conversations are allowed; encryption keeps them private.
          why: "The padlock in the browser and the Wi-Fi password: what do they actually protect?"
          journey: leapix
          lessons:
            - { title: "Firewalls: which conversations are allowed", family: none, kind: game }
            - { title: "Encrypted connections: TLS and the padlock", family: none, kind: article }
            - { title: Passwords and private information, family: none, kind: article }

    - id: across-the-internet
      title: Across the internet
      chapters:
        - id: routing
          title: Routing between networks
          summary: Routing tables, static routes and the protocols routers use to learn the way.
          why: Your photo crosses many networks, and something has to choose the way at each one.
          journey: internet
          lessons:
            - { title: Routing tables and static routes, family: ipv4, kind: game }
            - { title: IPv6 routing, family: ipv6, kind: game }
            - { title: Routing protocols, family: none, kind: article }
        - id: nat
          title: NAT
          summary: How a whole home shares one public IPv4 address, and why IPv6 doesn't need to.
          why: Every device at home shares one public address.
          journey: home-router
          lessons:
            - { title: "Sharing one address: NAT and PAT", family: ipv4, kind: game }
            - { title: Why IPv6 doesn't need NAT, family: ipv6, kind: article }
        - id: the-internet
          title: The internet
          summary: Internet providers, and how BGP connects their networks into one internet.
          why: One mistake somewhere makes popular sites vanish for everyone at once.
          journey: internet
          lessons:
            - { title: Internet providers and BGP, family: none, kind: article }
        - id: segment-routing
          title: Segment routing
          summary: "Letting the source choose the path: segments and labels with SR-MPLS, and segments as IPv6 addresses with SRv6."
          why: Your provider steers traffic around a busy link without you noticing.
          journey: provider
          lessons:
            - { title: "The source picks the path: segments and labels", family: none, kind: article }
            - { title: SR-MPLS, family: ipv4, kind: game }
            - { title: "SRv6: segments as IPv6 addresses", family: ipv6, kind: game }

    - id: the-enterprise
      title: The enterprise
      chapters:
        - id: campus
          title: Campus networks
          summary: Trunks, routing between VLANs, segmentation, and 802.1X deciding who gets on.
          why: Plug in a laptop at work and only the right network lets you on.
          journey: friends
          lessons:
            - { title: Trunks and routing between VLANs, family: none, kind: game }
            - { title: Segmentation, family: none, kind: article }
            - { title: "802.1X: who gets on the network", family: none, kind: article }
        - id: wan
          title: The WAN
          summary: Connecting offices and sites over MPLS and SD-WAN.
          why: A branch office reaches headquarters as if it were down the hall.
          journey: friends
          lessons:
            - { title: "Connecting sites: MPLS and SD-WAN", family: none, kind: article }
        - id: cloud
          title: The cloud
          summary: Virtual networks in the cloud, and hybrid links back to the data center.
          why: Leapix runs in someone else's data center.
          journey: leapix
          lessons:
            - { title: Virtual networks in the cloud, family: none, kind: article }
            - { title: Hybrid links back to the data center, family: none, kind: article }

    - id: the-data-center
      title: The data center
      chapters:
        - id: inside-a-data-center
          title: Inside a data center
          summary: Racks, top-of-rack switches, and why traffic between servers matters more than traffic in and out.
          why: "Where your photo actually waits: a rack in a building you'll never see."
          journey: leapix
          lessons:
            - { title: "Racks, top-of-rack switches and east-west traffic", family: none, kind: article }
        - id: spine-leaf
          title: Spine-leaf fabrics
          summary: Every leaf one hop from every spine, and many equal paths (ECMP).
          why: Thousands of servers talk to each other at once without a traffic jam.
          journey: leapix
          lessons:
            - { title: "Every leaf one hop from every spine: ECMP", family: none, kind: game }
        - id: vxlan-evpn
          title: "Overlays: VXLAN and EVPN"
          summary: "Carrying LANs across a routed fabric: what today's data centers run."
          why: A virtual machine moves to another rack and keeps its address.
          journey: leapix
          lessons:
            - { title: Carrying LANs across a routed fabric, family: none, kind: article, note: Chapter 24 uses Cisco ACI to illustrate abstraction. }
        - id: servers-virtual-networks
          title: Servers and virtual networks
          summary: "Hypervisor switches and container networking: networks inside a single server."
          why: Many "computers" share one physical server, each with its own network.
          journey: leapix
          lessons:
            - { title: Hypervisor switches and container networking, family: none, kind: article }
        - id: connecting-data-centers
          title: Connecting data centers
          summary: Data center interconnect, and links to the WAN and the cloud.
          why: One data center fails and the service carries on from another.
          journey: leapix
          lessons:
            - { title: "Data center interconnect, the WAN and the cloud", family: none, kind: article }

    - id: automating-the-network
      title: Automating the network
      chapters:
        - id: devices-with-code
          title: Talking to devices with code
          summary: "Python and Netmiko: sending commands and reading answers from code instead of a keyboard."
          why: Changing one device by hand is fine; changing five hundred isn't.
          lessons:
            - { title: Python and Netmiko, family: none, kind: article }
        - id: many-devices
          title: Many devices at once
          summary: "Nornir and Ansible: running one task across a whole network."
          why: The same change, everywhere, the same way, every time.
          lessons:
            - { title: Nornir and Ansible, family: none, kind: article }
        - id: abstraction
          title: Abstraction
          summary: Describing what you want instead of configuring each device, with Cisco ACI as the worked example.
          why: Saying what you want is easier, and safer, than configuring how, device by device.
          lessons:
            - { title: "Describing what you want, not how", family: none, kind: article }
            - { title: "Cisco ACI as an example: tenants, endpoint groups and contracts", family: none, kind: article }
        - id: testing-changes
          title: Testing changes before and after
          summary: "Containerlab and SuzieQ: proving a change works before and after it goes live."
          why: Knowing a change worked before anyone calls to say it didn't.
          lessons:
            - { title: Containerlab and SuzieQ, family: none, kind: lab }

    - id: beyond-the-protocols
      title: Beyond the protocols
      chapters:
        - id: learned-early
          title: What I learned early that helps me every day
          summary: The skills from my first years that still help every day as a senior technical consultant and network engineer.
          lessons:
            - { title: What I learned early that helps me every day, family: none, kind: article }
        - id: linux
          title: Linux
          summary: Learned to support DNS zone files, and useful every day since.
          lessons:
            - { title: Linux for network engineers, family: none, kind: article }
        - id: git
          title: Revision control with Git
          summary: "Keeping every change, and why: DNS zone files were under revision control from the start."
          lessons:
            - { title: Revision control with Git, family: none, kind: article }
        - id: python
          title: Software development and Python
          summary: Development concepts make Python easy to pick up, and a free course to start with.
          lessons:
            - { title: Software development and Python, family: none, kind: article }
        - id: automate-twice
          title: Automate what you do more than twice
          summary: An Ops manager's rule that still holds. The tools are in Part 6.
          lessons:
            - { title: Automate what you do more than twice, family: none, kind: article }
        - id: documentation
          title: Documentation
          summary: "Document everything: come back when you have documentation."
          lessons:
            - { title: Documentation, family: none, kind: article }
        - id: troubleshooting
          title: Troubleshooting methodology
          summary: One-page troubleshooting plans that show your method and double as a method of procedure (MOP).
          lessons:
            - { title: Troubleshooting methodology, family: none, kind: article }
        - id: structured-cabling
          title: Structured cabling
          summary: The physical layer everything else stands on.
          lessons:
            - { title: Structured cabling, family: none, kind: article }
        - id: show-your-work
          title: Show your work
          summary: A free GitHub account, sample documentation and a small website.
          lessons:
            - { title: Show your work, family: none, kind: article }
```

- [ ] **Step 7: Add `getCourse()`** to `src/lib/content.js`. Change the import to `import { getCollection, getEntry } from 'astro:content';`, add `import { buildCourse } from './path.js';`, and append:

```js
/**
 * The course "How networking works" (spec section 12), built from path.yaml and the
 * learn collection. Throws on a bad path.yaml, so the build fails.
 * @returns {Promise<import('./path.js').Course>}
 */
export async function getCourse() {
  const entry = await getEntry('path', 'course');
  if (!entry) throw new Error('src/content/path.yaml is missing its `course` entry');
  const pages = Object.fromEntries(
    (await getLearn()).map((e) => [
      e.id,
      { id: e.id, title: e.data.title, href: learnHref(e), summary: e.data.summary, published: e.data.published },
    ]),
  );
  return buildCourse(/** @type {import('./path.js').CourseData} */ (entry.data), pages);
}
```

- [ ] **Step 8: Check the real file builds into the course.** Add to `src/lib/path.test.js` (it reads the YAML with `yaml`, which Astro already installs (2.9.1 on 27 October 2026), so this adds no dependency; if `ls node_modules/yaml` ever fails, drop this block and rely on the Playwright tests in Task 4):

```js
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

describe('src/content/path.yaml', () => {
  const raw = parse(readFileSync('src/content/path.yaml', 'utf8')).course;
  // Astro turns `entry: arp` into { id: 'arp' }; do the same here.
  for (const part of raw.parts) for (const ch of part.chapters) for (const l of ch.lessons) if (l.entry) l.entry = { id: l.entry };
  const course = buildCourse(raw, { arp: { id: 'arp', title: 'How IPv4 ARP works', href: '/learn/arp', summary: 's' } });

  it('has Part 0 with ten lessons and 34 numbered chapters after it', () => {
    expect(course.parts).toHaveLength(8);
    expect(course.parts[0].chapters).toHaveLength(10);
    expect(course.parts.slice(1).flatMap((p) => p.chapters).at(-1)?.number).toBe('34');
  });

  it('has ARP available in chapter 4 and IPv6 Neighbor Discovery up next', () => {
    expect(placeOf(/** @type {any} */ (lessonFor(course, 'arp')))).toBe('Part 1 · Chapter 4 · Finding your neighbours · IPv4');
    expect(course.next?.title).toBe('Neighbor Discovery');
  });
});
```

Run: `npx vitest run src/lib/path.test.js` — Expected: PASS, 14 tests.

- [ ] **Step 9: Checkpoint.** Run `npm run build` (the schema and `reference('learn')` must accept the file), then `npm run check`. Both must pass.

---

### Task 2: The journey picture and strip

**Files:**
- Create: `src/components/JourneyPicture.astro`, `src/components/JourneyStrip.astro`

**Interfaces:**
- Consumes: `JOURNEY` from `src/lib/path.js`.
- Produces: `<JourneyPicture />` (no props; decorative SVG, `aria-hidden`) and `<JourneyStrip hrefs={Record<string, string | undefined>} />` (an `<ol class="journey">` of the seven step labels; a step with an href is a link).

- [ ] **Step 1: Write `src/components/JourneyStrip.astro`**

```astro
---
/**
 * The photo's journey as text (spec section 12): seven steps in order. On /learn each
 * step links to the first chapter that explains it; on Home they are plain text.
 * @typedef {object} Props
 * @property {Record<string, string | undefined>} [hrefs]  Step id → link.
 */
import { JOURNEY } from '../lib/path.js';

const { hrefs = {} } = Astro.props;
---

<ol class="journey">
  {
    JOURNEY.map((step) => (
      <li>
        {hrefs[step.id] ? <a href={hrefs[step.id]}>{step.label}</a> : <span>{step.label}</span>}
      </li>
    ))
  }
</ol>

<style>
  .journey {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
  }
  /* An arrow between steps; decoration, so screen readers skip it. */
  .journey li:not(:last-child)::after {
    content: '→' / '';
    margin-inline-start: var(--space-2);
    color: var(--color-text-muted);
  }
</style>
```

- [ ] **Step 2: Write `src/components/JourneyPicture.astro`.** A 700 × 120 SVG: one icon per step at x = 50, 150, … 650, a line joining them, and a small photo that leaps from the laptop to Leapix once (CSS only, no script). Colours come from tokens through classes, never attributes.

```astro
---
/**
 * The photo's journey as a picture (spec section 12, "Home"): laptop, Wi-Fi or cable,
 * home router, provider, internet, Leapix (a made-up photo site, leapix.example, whose
 * mascot is a snow leopard) and friends. Decorative: the text beside it carries the
 * meaning. The photo leaps along once, in CSS; still with reduced motion or the >_ switch.
 */
---

<svg class="journey-picture" viewBox="0 0 700 120" aria-hidden="true" focusable="false">
  <line class="path" x1="50" y1="62" x2="650" y2="62"></line>
  <!-- Your laptop -->
  <g transform="translate(50 62)">
    <rect class="box" x="-22" y="-20" width="44" height="28" rx="3"></rect>
    <rect class="box" x="-28" y="8" width="56" height="6" rx="2"></rect>
  </g>
  <!-- Wi-Fi or cable: radio arcs above, a dashed cable below -->
  <g transform="translate(150 62)">
    <path class="wave" d="M-18 -10 A 26 26 0 0 1 18 -10"></path>
    <path class="wave" d="M-11 -3 A 16 16 0 0 1 11 -3"></path>
    <circle class="dot" cx="0" cy="3" r="3"></circle>
    <line class="cable" x1="-30" y1="24" x2="30" y2="24"></line>
  </g>
  <!-- Home router -->
  <g transform="translate(250 62)">
    <rect class="box" x="-24" y="-8" width="48" height="18" rx="4"></rect>
    <line class="stroke" x1="-14" y1="-8" x2="-18" y2="-22"></line>
    <line class="stroke" x1="14" y1="-8" x2="18" y2="-22"></line>
    <circle class="dot" cx="-12" cy="1" r="2"></circle>
    <circle class="dot" cx="-4" cy="1" r="2"></circle>
  </g>
  <!-- Your provider: a tower -->
  <g transform="translate(350 62)">
    <path class="stroke" d="M0 -26 L-14 18 M0 -26 L14 18 M-9 2 L9 2 M-5 -10 L5 -10"></path>
    <circle class="dot" cx="0" cy="-26" r="3"></circle>
  </g>
  <!-- The internet: a cloud -->
  <g transform="translate(450 62)">
    <path class="box" d="M-26 12 A 12 12 0 0 1 -18 -8 A 16 16 0 0 1 10 -14 A 13 13 0 0 1 26 2 A 10 10 0 0 1 22 12 Z"></path>
  </g>
  <!-- Leapix: a server with the snow leopard's head -->
  <g transform="translate(550 62)">
    <rect class="box" x="-16" y="-6" width="32" height="30" rx="3"></rect>
    <line class="stroke" x1="-10" y1="4" x2="10" y2="4"></line>
    <line class="stroke" x1="-10" y1="13" x2="10" y2="13"></line>
    <g class="leopard" transform="translate(0 -20)">
      <path class="coat" d="M-11 -6 L-8 -14 L-3 -9 L3 -9 L8 -14 L11 -6 A 12 11 0 1 1 -11 -6 Z"></path>
      <circle class="spot" cx="-6" cy="-2" r="1.6"></circle>
      <circle class="spot" cx="6" cy="-2" r="1.6"></circle>
      <circle class="spot" cx="-8" cy="4" r="1.3"></circle>
      <circle class="spot" cx="8" cy="4" r="1.3"></circle>
      <circle class="spot" cx="0" cy="5" r="1.4"></circle>
    </g>
  </g>
  <!-- Your friends see it: two phones -->
  <g transform="translate(650 62)">
    <rect class="box" x="-22" y="-16" width="16" height="28" rx="3"></rect>
    <rect class="box" x="4" y="-16" width="16" height="28" rx="3"></rect>
  </g>
  <!-- The photo, leaping from the laptop to Leapix -->
  <g class="photo">
    <rect x="38" y="20" width="24" height="18" rx="2"></rect>
    <path d="M41 35 L48 27 L53 32 L56 29 L60 35 Z"></path>
  </g>
</svg>

<style>
  .journey-picture {
    display: block;
    width: 100%;
    max-width: 44rem;
    height: auto;
    margin-block: var(--space-3) 0;
  }
  .path {
    stroke: var(--color-border);
    stroke-width: 2;
  }
  .box {
    fill: var(--color-surface);
    stroke: var(--color-heading);
    stroke-width: 2;
  }
  .stroke,
  .wave {
    fill: none;
    stroke: var(--color-heading);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .cable {
    stroke: var(--color-heading);
    stroke-width: 2;
    stroke-dasharray: 5 4;
  }
  .dot {
    fill: var(--color-accent);
  }
  .coat {
    fill: var(--color-text-muted);
  }
  .spot {
    fill: var(--iw-indigo);
  }
  .photo rect {
    fill: var(--color-accent);
  }
  .photo path {
    fill: var(--color-bg);
  }
  /* One leap, laptop to Leapix (500 units), then the photo stays there. */
  .photo {
    animation: leap 2.4s ease-in-out 0.6s 1 both;
  }
  @keyframes leap {
    from {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(250px, -14px);
    }
    to {
      transform: translate(500px, 0);
    }
  }
  /* Still, at Leapix, with reduced motion or the >_ switch off (N4). */
  @media (prefers-reduced-motion: reduce) {
    .photo {
      animation: none;
      transform: translate(500px, 0);
    }
  }
  :global(html[data-effects='off']) .photo {
    animation: none;
    transform: translate(500px, 0);
  }
</style>
```

- [ ] **Step 3: Checkpoint.** These components are drawn by Tasks 3 and 4, which test them. Run `npm run lint` now; it must pass.

---

### Task 3: Home teaser

**Files:**
- Modify: `src/pages/index.astro`, `src/content.config.js` (drop `featured`), `src/content/learn/arp.md` (drop `featured: true`)
- Test: `tests/smoke.spec.js`

**Interfaces:**
- Consumes: `getCourse()` (Task 1), `JourneyPicture`, `JourneyStrip` (Task 2).

- [ ] **Step 1: Write the failing Playwright test.** Add to `tests/smoke.spec.js`, after the `Home hero band (section 9)` describe block:

```js
test.describe('Home: the course teaser (section 12)', () => {
  test('asks the Leapix question, shows the journey, the latest game, Up next and the way in', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section.course');
    await expect(section.getByRole('heading', { name: 'How networking works' })).toBeVisible();
    await expect(section).toContainText('What happens when you upload a photo to Leapix?');
    await expect(section.locator('svg.journey-picture')).toHaveAttribute('aria-hidden', 'true');
    await expect(section.locator('ol.journey li')).toHaveCount(7);
    await expect(section.getByRole('link', { name: 'How IPv4 ARP works' })).toHaveAttribute('href', '/learn/arp');
    await expect(section).toContainText('Up next: Neighbor Discovery (IPv6)');
    await expect(section.getByRole('link', { name: 'Start the course' })).toHaveAttribute('href', '/learn');
  });

  test('the photo stays still with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const animation = await page.locator('svg.journey-picture .photo').evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe('none');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && npx playwright test -g "course teaser" --project=desktop-1280`
Expected: FAIL, `section.course` not found.

- [ ] **Step 3: Replace the featured-game block in `src/pages/index.astro`.** Change the doc comment to `/** Home: intro, the course teaser, latest Spark image, external links (R11, section 12). */`. Replace the imports of `getLearn, learnHref` and the `featured` line:

```js
import JourneyPicture from '../components/JourneyPicture.astro';
import JourneyStrip from '../components/JourneyStrip.astro';
import { getSpark, getCourse } from '../lib/content.js';
```

```js
const course = await getCourse();
const { latest: latestLesson, next } = course;
```

Replace the `{featured && (...)}` section with:

```astro
<section class="course">
  <h2 data-decrypt="mac">How networking works</h2>
  <p class="hook">What happens when you upload a photo to Leapix?</p>
  <JourneyPicture />
  <JourneyStrip />
  <p>
    Networks are the plumbing behind everything you do online: hidden, and noticed only when the hot water stops. This
    course shows the pipes, one step at a time, starting from scratch.
  </p>
  {
    latestLesson?.page && (
      <div class="latest">
        <p class="label">Latest game</p>
        <h3>
          <a href={latestLesson.page.href}>{latestLesson.page.title}</a>
        </h3>
        <p>{latestLesson.page.summary}</p>
      </div>
    )
  }
  {
    next && (
      <p class="next">
        Up next: {next.title}
        {next.familyLabel && ` (${next.familyLabel})`}
      </p>
    )
  }
  <p>
    <a href="/learn">Start the course</a>
  </p>
</section>
```

Add to the page's `<style>`:

```css
/* The course teaser spans the grid; the Spark image follows below it. */
.home-grid > .course {
  grid-column: 1 / -1;
}
.hook {
  font-size: var(--text-lg);
  color: var(--color-heading);
  margin-block-end: 0;
}
.latest {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: var(--space-3);
  max-width: 36rem;
}
.latest h3,
.latest p {
  margin: 0 0 var(--space-1);
}
.label,
.next {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
```

Note: the `latest` variable name already exists for the newest Spark image, which is why the lesson is `latestLesson`.

- [ ] **Step 4: Drop `featured`** (spec section 12, "Home": no longer needed). In `src/content.config.js` delete the line `featured: z.boolean().optional(),`. In `src/content/learn/arp.md` delete the line `featured: true`. In `docs/SPEC.md` section 4, delete the `featured` row of the `learn` collection table.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm run build && npx playwright test -g "course teaser|/ loads cleanly|Content Security"`
Expected: PASS on both projects (360 and 1280 px), with no CSP violations and no horizontal scroll.

- [ ] **Step 6: Look at it.** Screenshot Home at 390 and 1280 px in light and dark (Playwright in the scratchpad, `channel: 'chrome'`): the picture fits, the leopard reads as a cat, the strip wraps, nothing overflows. Fix anything that looks broken before moving on.

- [ ] **Step 7: Checkpoint.** `npm run check` must pass.

---

### Task 4: The `/learn` course map

**Files:**
- Modify: `src/pages/learn/index.astro`
- Test: `tests/smoke.spec.js`

**Interfaces:**
- Consumes: `getCourse()`, `JOURNEY`, `chaptersForStep` (Task 1); `JourneyPicture`, `JourneyStrip` (Task 2).

- [ ] **Step 1: Write the failing tests** in `tests/smoke.spec.js`, after the existing `/learn explains the documentation address ranges` test:

```js
test.describe('/learn: the course map (R4, R17, section 12)', () => {
  test('starts with the question and a way in, then the journey with links into the chapters', async ({ page }) => {
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How networking works');
    const start = page.getByRole('region', { name: 'Start here' });
    await expect(start).toContainText('What happens when I upload a photo to Leapix?');
    await expect(start.getByRole('link', { name: /How IPv4 ARP works/ })).toHaveAttribute('href', '/learn/arp');
    const journey = page.getByRole('region', { name: 'The photo’s journey' });
    await expect(journey.locator('ol.journey li')).toHaveCount(7);
    await expect(journey.getByRole('link', { name: 'Your laptop' })).toHaveAttribute('href', '#chapter-addresses');
  });

  test('lists eight parts, Part 0’s ten lessons and 34 chapters, with exactly one Up next', async ({ page }) => {
    await page.goto('/learn');
    await expect(page.locator('section.part')).toHaveCount(8);
    await expect(page.locator('#part-0 .chapter')).toHaveCount(10);
    await expect(page.locator('section.part:not(#part-0) .chapter')).toHaveCount(34);
    await expect(page.locator('#chapter-show-your-work .number')).toHaveText('34');
    await expect(page.locator('.lesson.next')).toHaveCount(1);
    await expect(page.locator('.lesson.next')).toContainText('Neighbor Discovery');
    await expect(page.locator('.lesson.next')).toContainText('Up next');
  });

  test('links only available lessons; the rest say "Not available yet" in words', async ({ page }) => {
    await page.goto('/learn');
    const available = page.locator('.lesson.available');
    await expect(available.getByRole('link')).toHaveCount(await available.count());
    await expect(page.locator('.lesson.planned a')).toHaveCount(0);
    await expect(page.locator('.lesson.planned').first()).toContainText('Not available yet');
    await expect(page.locator('#chapter-finding-your-neighbours')).toContainText('Why you’d care');
    await expect(page.locator('#chapter-why-a-network .deeper')).toHaveCount(0);
    await expect(page.locator('#chapter-where-to-go .deeper a').first()).toHaveAttribute('href', '#chapter-addresses');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && npx playwright test -g "the course map" --project=desktop-1280`
Expected: FAIL, the h1 is "Learn".

- [ ] **Step 3: Rewrite the page** `src/pages/learn/index.astro`. Keep the `RANGES` array and the whole `<section class="addresses">` and its styles exactly as they are. Replace the doc comment, imports and the `groups` code with:

```js
/** Learn: the course map for "How networking works" (R4, R17, spec section 12), then the documentation address ranges the games use (spec section 3). */
import BaseLayout from '../../layouts/BaseLayout.astro';
import { shareCards } from '../../site.config.js';
import BackHome from '../../components/BackHome.astro';
import JourneyPicture from '../../components/JourneyPicture.astro';
import JourneyStrip from '../../components/JourneyStrip.astro';
import { getCourse } from '../../lib/content.js';
import { JOURNEY, chaptersForStep } from '../../lib/path.js';

const course = await getCourse();
/** Each journey step links to the first chapter that explains it (like a dict comprehension). */
const stepHrefs = Object.fromEntries(
  JOURNEY.map((step) => {
    const [first] = chaptersForStep(course, step.id);
    return [step.id, first ? `#${first.anchor}` : undefined];
  }),
);
const STATUS = { available: 'Available', next: 'Up next', planned: 'Not available yet' };
```

Change the `<BaseLayout ...>` title and description to:

```astro
  title="Learn: How networking works"
  description="How networking works, a free course from scratch: follow one photo from your laptop to Leapix and your friends, with interactive games like the IPv4 ARP simulator."
```

Replace the `<h1>`, lede and `{groups.map(...)}` with:

```astro
<h1>How networking works</h1>

<section class="start" aria-labelledby="start-title">
  <h2 id="start-title">Start here</h2>
  <p class="lede">{course.question}</p>
  <p>
    Networks are like plumbing: hidden, and noticed only when the hot water stops. This course follows one photo from
    your laptop to Leapix, a made-up photo site, and on to your friends, and explains each part of the network as the
    photo reaches it. Each lesson builds on the ones before it.
  </p>
  <p>
    Lessons are <strong>Available</strong> (a link), <strong>Up next</strong> (being built now) or
    <strong>Not available yet</strong>. New games arrive one at a time.
  </p>
  {
    course.start?.page && (
      <p>
        <a class="start-link" href={course.start.page.href}>
          Start with {course.start.page.title} →
        </a>
      </p>
    )
  }
</section>

<section class="journey-section" aria-labelledby="journey-title">
  <h2 id="journey-title">The photo’s journey</h2>
  <JourneyPicture />
  <JourneyStrip hrefs={stepHrefs} />
</section>

{
  course.parts.map((part) => (
    <section class="part" id={part.anchor} aria-labelledby={`${part.anchor}-title`}>
      <h2 id={`${part.anchor}-title`}>
        Part {part.number}: {part.title}
      </h2>
      <ol class="chapters" role="list">
        {part.chapters.map((chapter) => (
          <li class="chapter" id={chapter.anchor}>
            <h3>
              <span class="number">{chapter.number}</span> {chapter.title}
            </h3>
            <p>{chapter.summary}</p>
            {chapter.why && (
              <p class="why">
                {part.number === 0 ? 'The problem: ' : 'Why you’d care: '}
                {chapter.why}
              </p>
            )}
            <ul class="lessons" role="list">
              {chapter.lessons.map((lesson) => (
                <li class={`lesson ${lesson.status}`}>
                  {lesson.familyLabel && <span class="family">{lesson.familyLabel}</span>}
                  {lesson.status === 'available' && lesson.page ? (
                    <a href={lesson.page.href}>{lesson.title}</a>
                  ) : (
                    <span class="title">{lesson.title}</span>
                  )}
                  <span class="kind">{lesson.kind}</span>
                  <span class="status">{STATUS[lesson.status]}</span>
                  {lesson.note && <span class="note">{lesson.note}</span>}
                </li>
              ))}
            </ul>
            {chapter.deeper.length > 0 && (
              <p class="deeper">
                Go deeper:{' '}
                {chapter.deeper.map((target, i) => (
                  <>
                    {i > 0 && ', '}
                    <a href={`#${target.anchor}`}>
                      Chapter {target.number}: {target.title}
                    </a>
                  </>
                ))}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  ))
}
```

Keep `<section class="addresses">…</section>` and `<BackHome />` after it. Add to the `<style>`:

```css
.chapters,
.lessons {
  list-style: none;
  margin: 0;
  padding: 0;
}
.chapter {
  border-top: 1px solid var(--color-border);
  padding-block: var(--space-3);
}
.chapter h3 {
  margin: 0 0 var(--space-1);
}
.chapter p {
  margin: 0 0 var(--space-1);
}
.number {
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  margin-inline-end: var(--space-1);
}
.why,
.deeper {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.lesson {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-2);
  padding-block: 0.15rem;
}
.lesson.planned .title {
  color: var(--color-text-muted);
}
.family,
.kind,
.status {
  font-size: var(--text-sm);
}
.family {
  font-family: var(--font-mono);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 0 var(--space-1);
}
.kind,
.status {
  color: var(--color-text-muted);
}
/* Up next: the accent colour, and the word "Up next" (never colour alone). */
.lesson.next .status {
  color: var(--color-accent);
  font-weight: 600;
}
.note {
  flex-basis: 100%;
  font-size: var(--text-sm);
  font-style: italic;
  color: var(--color-text-muted);
}
.start-link {
  font-weight: 600;
}
```

Delete any style rules left for the old category sections that no longer match anything.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm run build && npx playwright test -g "the course map|/learn explains|/learn loads|N11|Content Security"`
Expected: PASS on both projects.

- [ ] **Step 5: Look at it** at 390 and 1280 px, light and dark; fix crowding before moving on.

- [ ] **Step 6: Checkpoint.** `npm run check` must pass.

---

### Task 5: A lesson's place in the course, and the VLAN note

**Files:**
- Create: `src/components/LessonBreadcrumbs.astro`, `src/components/LessonPlace.astro`, `src/components/LessonNav.astro`
- Modify: `src/pages/learn/arp.astro`, `src/pages/learn/[slug].astro`, `src/games/arp/lesson.js`, `src/games/arp/lesson.test.js`
- Test: `tests/smoke.spec.js`

**Interfaces:**
- Consumes: `getCourse`, `lessonFor`, `placeOf`, `neighbours`, `lessonBreadcrumbs`, `JOURNEY` (Task 1).
- Produces: `<LessonBreadcrumbs crumbs={{name, path}[]} />`, `<LessonPlace lesson={Lesson} />`, `<LessonNav course={Course} lesson={Lesson} />`.

- [ ] **Step 1: Write the failing Vitest** in `src/games/arp/lesson.test.js`, inside `describe('the Learn lesson', …)`:

```js
  it('says a broadcast floods only within the VLAN, and points to chapter 5', () => {
    const flood = LESSON.find((step) => step.title === 'SW1 learns and floods');
    expect(flood?.caption).toContain('in the same VLAN');
    expect(flood?.caption).toContain('chapter 5');
  });
```

Run: `npx vitest run src/games/arp/lesson.test.js` — Expected: FAIL.

- [ ] **Step 2: Change the caption** in `src/games/arp/lesson.js` for `'SW1 learns and floods'` to:

```js
    caption:
      'SW1 notes that H1’s MAC is on port Gi0/1 (see its MAC address table). The destination is the broadcast address, so it floods a copy out every other port in the same VLAN, unchanged. This LAN has one VLAN; chapter 5, Broadcasts and VLANs, explains more.',
```

Run the Vitest again — Expected: PASS.

- [ ] **Step 3: Write the failing Playwright tests**, after the existing `the ARP page carries its lesson as text` test inside `Search and AI search (N11)` → `without JavaScript`:

```js
    test('the ARP page shows its place in the course, why you’d care, and the way back to the map', async ({ page }) => {
      await page.goto('/learn/arp');
      const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect(crumbs.getByRole('link', { name: 'Chapter 4: Finding your neighbours' })).toHaveAttribute(
        'href',
        '/learn#chapter-finding-your-neighbours',
      );
      await expect(page.locator('.place')).toContainText('Part 1 · Chapter 4 · Finding your neighbours · IPv4');
      await expect(page.locator('.place')).toContainText('On the photo’s journey: Wi-Fi or cable');
      await expect(page.locator('.lesson-why')).toContainText('Your laptop and the printer are on the same Wi-Fi');
      const nav = page.getByRole('navigation', { name: 'Course' });
      await expect(nav.getByRole('link', { name: 'The course map' })).toHaveAttribute('href', '/learn');
      await expect(nav).toContainText('Up next in the course: Neighbor Discovery');
      await page.getByText('Read the lesson as text').click();
      await expect(page.locator('.lesson-text')).toContainText('in the same VLAN');
    });
```

Run: `npm run build && npx playwright test -g "its place in the course" --project=desktop-1280` — Expected: FAIL.

- [ ] **Step 4: Write the three components.**

`src/components/LessonBreadcrumbs.astro`:

```astro
---
/**
 * Visible breadcrumbs for a lesson page: Learn › Part › Chapter › Lesson (spec section 12).
 * The same list goes to BaseLayout for structured data.
 * @typedef {object} Props
 * @property {{ name: string, path: string }[]} crumbs
 */
const { crumbs } = Astro.props;
---

<nav class="crumbs" aria-label="Breadcrumb">
  <ol>
    {
      crumbs.map((crumb, i) =>
        i === crumbs.length - 1 ? (
          <li aria-current="page">{crumb.name}</li>
        ) : (
          <li>
            <a href={crumb.path}>{crumb.name}</a>
          </li>
        ),
      )
    }
  </ol>
</nav>

<style>
  .crumbs ol {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-1);
    font-size: var(--text-sm);
  }
  .crumbs li:not(:last-child)::after {
    content: '›' / '';
    margin-inline-start: var(--space-1);
    color: var(--color-text-muted);
  }
  .crumbs [aria-current] {
    color: var(--color-text-muted);
  }
</style>
```

`src/components/LessonPlace.astro`:

```astro
---
/**
 * Under a lesson's title: where it sits in the course, its step on the photo's journey,
 * and why you'd care (spec section 12, "Lesson pages").
 * @typedef {object} Props
 * @property {import('../lib/path.js').Lesson} lesson
 */
import { JOURNEY, placeOf } from '../lib/path.js';

const { lesson } = Astro.props;
const step = JOURNEY.find((s) => s.id === lesson.chapter.journey);
---

<p class="place">
  <a href={`/learn#${lesson.chapter.anchor}`}>{placeOf(lesson)}</a>
  {step && <span> · On the photo’s journey: {step.label}</span>}
</p>
{lesson.chapter.why && <p class="lesson-why">Why you’d care: {lesson.chapter.why}</p>}

<style>
  .place,
  .lesson-why {
    margin: 0 0 var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
</style>
```

`src/components/LessonNav.astro`:

```astro
---
/**
 * At a lesson's foot: the previous and next available lessons, the map, and what's
 * coming (spec section 12, "Lesson pages").
 * @typedef {object} Props
 * @property {import('../lib/path.js').Course} course
 * @property {import('../lib/path.js').Lesson} lesson
 */
import { neighbours } from '../lib/path.js';

const { course, lesson } = Astro.props;
const { previous, next } = neighbours(course, lesson);
---

<nav class="lesson-nav" aria-label="Course">
  {
    previous?.page && (
      <a rel="prev" href={previous.page.href}>
        ← {previous.page.title}
      </a>
    )
  }
  <a href="/learn">The course map</a>
  {
    next?.page && (
      <a rel="next" href={next.page.href}>
        {next.page.title} →
      </a>
    )
  }
  {
    !next && course.next && (
      <p class="coming">
        Up next in the course: {course.next.title}
        {course.next.familyLabel && ` (${course.next.familyLabel})`}
      </p>
    )
  }
</nav>

<style>
  .lesson-nav {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
    margin-block-start: var(--space-5);
    padding-block-start: var(--space-3);
    border-top: 1px solid var(--color-border);
  }
  .coming {
    flex-basis: 100%;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
</style>
```

- [ ] **Step 5: Use them on the ARP page** (`src/pages/learn/arp.astro`). Add imports:

```js
import LessonBreadcrumbs from '../../components/LessonBreadcrumbs.astro';
import LessonPlace from '../../components/LessonPlace.astro';
import LessonNav from '../../components/LessonNav.astro';
import { getCourse } from '../../lib/content.js';
import { lessonFor, lessonBreadcrumbs } from '../../lib/path.js';
```

Change the existing `import { getTagNames } from '../../lib/content.js';` into the same import line as `getCourse`. After `const entry = …` checks, add:

```js
const course = await getCourse();
const lesson = lessonFor(course, 'arp');
if (!lesson) throw new Error('path.yaml has no lesson with entry: arp');
const crumbs = lessonBreadcrumbs(lesson);
```

Change `breadcrumbs={[ … ]}` on `<BaseLayout>` to `breadcrumbs={crumbs}`. Put `<LessonBreadcrumbs crumbs={crumbs} />` just before `<h1>`, and `<LessonPlace lesson={lesson} />` right after `<p class="dates">…</p>`. Put `<LessonNav course={course} lesson={lesson} />` just before `<BackHome />`.

- [ ] **Step 6: Same for other Learn pages** (`src/pages/learn/[slug].astro`), which are built only for entries without a `component`. Add the same three imports plus `import { lessonFor, lessonBreadcrumbs } from '../../lib/path.js';` and `getCourse` to the content import. After `const path = …`:

```js
const course = await getCourse();
const lesson = lessonFor(course, entry.id);
// Entries not yet placed in path.yaml keep simple breadcrumbs.
const crumbs = lesson
  ? lessonBreadcrumbs(lesson)
  : [
      { name: 'Learn', path: '/learn' },
      { name: entry.data.title, path },
    ];
```

Use `breadcrumbs={crumbs}`, and render `{lesson && <LessonBreadcrumbs crumbs={crumbs} />}` before `<h1>`, `{lesson && <LessonPlace lesson={lesson} />}` after the lede, and `{lesson && <LessonNav course={course} lesson={lesson} />}` before `<BackHome />`.

- [ ] **Step 7: Run the tests to see them pass**

Run: `npm test && npm run build && npx playwright test -g "its place in the course|How IPv4 ARP works|N11|Content Security"`
Expected: PASS. The N11 structured-data test still finds `BreadcrumbList`, now with four items.

- [ ] **Step 8: Checkpoint.** `npm run check` must pass.

---

### Task 6: Search: the course in structured data and `llms.txt`

**Files:**
- Modify: `src/lib/seo.js`, `src/lib/seo.test.js`, `src/pages/learn/index.astro`, `src/pages/learn/arp.astro`, `src/pages/llms.txt.js`
- Test: `tests/smoke.spec.js`

**Interfaces:**
- Consumes: `getCourse` (Task 1).
- Produces: `IDS.course`; `courseLd({ name: string, description: string, lessonPaths: string[] }): object`; `learningResourceLd({..., position?: number})` adds `isPartOf: { '@id': IDS.course }` and `position` when `position` is given.

- [ ] **Step 1: Write the failing Vitest** in `src/lib/seo.test.js`. Add `courseLd` to the import list, then:

```js
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
```

Run: `npx vitest run src/lib/seo.test.js` — Expected: FAIL.

- [ ] **Step 2: Implement in `src/lib/seo.js`.** Add to `IDS`: `course: \`${site.url}/learn#course\`,`. Add `position` to `learningResourceLd`'s JSDoc parameter type (`position?: number`) and destructuring, and to its returned object:

```js
    ...(position ? { isPartOf: { '@id': IDS.course }, position } : {}),
```

Append:

```js
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
```

Run the Vitest again — Expected: PASS.

- [ ] **Step 3: Use it.** In `src/pages/learn/index.astro`, import `courseLd` from `'../../lib/seo.js'`, and pass to `<BaseLayout>`:

```astro
  jsonLd={[
    courseLd({
      name: course.title,
      description: 'A free course from scratch: follow one photo from your laptop to Leapix and your friends.',
      lessonPaths: course.lessons.filter((l) => l.page).map((l) => /** @type {any} */ (l.page).href),
    }),
  ]}
```

In `src/pages/learn/arp.astro`, add `position: lesson.position,` to the `learningResourceLd({…})` call (move that call below the `lesson` lookup).

- [ ] **Step 4: Add the course outline to `llms.txt`** (`src/pages/llms.txt.js`). Import `getCourse` with the other content helpers. Inside `GET`, add `const course = await getCourse();`. Replace the `## Learn: interactive networking games` section's body with:

```js
## Learn: ${course.title}

The course starts from one question: ${course.question} Part 0 tells the whole journey for beginners; later parts go deeper. Lessons not yet written are listed without links.

${course.parts
  .map((part) =>
    [
      `### Part ${part.number}: ${part.title}`,
      ...part.chapters.map((chapter) => {
        const ready = chapter.lessons.filter((l) => l.page);
        const links = ready.map((l) => item(l.title, /** @type {any} */ (l.page).href, l.page?.summary)).join('\n');
        return `- ${chapter.number}. ${chapter.title}: ${chapter.summary}${links ? `\n${links.replace(/^/gm, '  ')}` : ''}`;
      }),
    ].join('\n'),
  )
  .join('\n\n')}
```

Delete the line `const learn = await getLearn();` and the now-unused `getLearn` and `learnHref` imports (nothing else in the file uses them).

- [ ] **Step 5: Extend the Playwright tests.** In the `llms.txt introduces the site…` test add:

```js
    expect(text).toContain('## Learn: How networking works');
    expect(text).toContain('### Part 0: How devices talk');
    expect(text).toContain('- 4. Finding your neighbours:');
```

In `every route has valid structured data…` add, after the `/learn/arp` check:

```js
    await page.goto('/learn');
    expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain('"Course"');
```

Run: `npm run build && npx playwright test -g "N11"` — Expected: PASS.

- [ ] **Step 6: Checkpoint.** `npm run check` must pass.

---

### Task 7: Spec, CLAUDE.md and a Lighthouse pass

**Files:**
- Modify: `docs/SPEC.md`, `CLAUDE.md`

- [ ] **Step 1: Tick M7** in `docs/SPEC.md` section 10: every `- [ ]` under `### M7: Learning path scaffold`, each with "Done <date>" and one line on what shipped.

- [ ] **Step 2: Record what the build decided** in section 12:
  - "Data": the file holds one entry, `course` (`title`, `question`, `parts`); part numbers are positions; `buildCourse` in `src/lib/path.js` throws on two `next` lessons, a `next` lesson that is already available, an unknown `entry`, a duplicate chapter id or an unknown `deeper` id.
  - "Lesson pages": the journey line reads "On the photo’s journey: <step label>" (not the longer phrase in "Content changes"); correct that bullet to match.
  - "Home": the teaser shipped; `featured` is gone from the `learn` schema.

- [ ] **Step 3: Update `CLAUDE.md` "Current state"**: move "the learning path scaffold" into **Done**, and add one line under Architecture rules: "**Learning path:** the course is `src/content/path.yaml` (spec section 12). To ship a lesson, add its `learn` entry, set `entry:` on its lesson, and move `next: true` to the new up-next lesson; `/learn`, Home, breadcrumbs, structured data and `llms.txt` follow."

- [ ] **Step 4: Lighthouse.** Run `npm run lighthouse`. Home, `/spark` and `/learn/arp` must keep Performance ≥ 95 and Accessibility 100 (N1, N3); `/learn` should too. Fix any regressions.

- [ ] **Step 5: Final checkpoint.** `npm run check` must pass. Report to the owner, who commits with "commit and push", then test the live site with `BASE_URL=https://indigowire.net npm run test:e2e`.
