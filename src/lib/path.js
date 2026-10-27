/**
 * The course "How networking works" (spec section 12, R17) as plain data: numbers,
 * statuses, places and neighbours, worked out from src/content/path.yaml. DOM-free and
 * free of Astro imports, so Vitest can test it; getCourse() in content.js feeds it.
 */

/** The photo's journey: the spine of /learn and the picture on Home (spec section 12). */
export const JOURNEY = /** @type {const} */ ([
  {
    id: 'laptop',
    label: 'Your laptop',
    text: 'The laptop has an address, looks up leapix.example and packs the photo into messages.',
  },
  {
    id: 'link',
    label: 'Wi-Fi or cable',
    text: 'The messages cross the air to the access point, or a cable to the switch, onto the home network.',
  },
  { id: 'home-router', label: 'Home router', text: 'The router passes them out of the home network.' },
  { id: 'provider', label: 'Your provider', text: 'The internet provider carries them onward.' },
  { id: 'internet', label: 'The internet', text: 'Networks hand them from one to the next.' },
  {
    id: 'leapix',
    label: 'Leapix',
    text: 'They arrive, securely, at Leapix’s servers in a data center or the cloud, where the photo is put back together and stored.',
  },
  {
    id: 'friends',
    label: 'Your friends see it',
    text: 'Friends’ devices fetch the photo from Leapix over their own networks.',
  },
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
        if (l.entry && !page)
          throw new Error(`path.yaml: lesson "${l.title}" names entry "${l.entry.id}", which has no page`);
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
      if (!target)
        throw new Error(`path.yaml: chapter "${chapter.id}" says go deeper into "${id}", which doesn't exist`);
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
