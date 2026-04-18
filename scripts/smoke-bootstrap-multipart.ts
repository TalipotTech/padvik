#!/usr/bin/env tsx
/**
 * Smoke test: verify that bootstrap-core-content, when pointed at a
 * multi-part subject like Physics Gr11 with --max-chapters 1, produces one
 * runNcertDownload call PER book code, each of which passes `filterCatalog`
 * and would process exactly ch01 of that book.
 *
 * Before the bookCodes fix: `subjects: ["Physics"]` matched BOTH keph1 and
 * keph2 inside a single runNcertDownload call, and the global `maxChapters=1`
 * cap consumed its budget on keph1 ch01 and silently skipped keph2 entirely.
 *
 * This is a pure-logic smoke (no network, no DB).
 */
import {
  NCERT_BOOK_CATALOG,
  filterCatalog,
} from "../src/lib/scraper/ncert-downloader";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

// ---------------------------------------------------------------------------
// Context: reproduce the original bug signature to make the regression explicit
// ---------------------------------------------------------------------------

const oldStyleMatch = filterCatalog({
  grades: [11],
  subjects: ["Physics"],
  languages: ["en"],
});
const oldCodes = oldStyleMatch.map((b) => b.code).sort();
assert(
  oldCodes.includes("keph1") && oldCodes.includes("keph2"),
  `subjects:["Physics"] still matches BOTH keph1 + keph2 (got ${oldCodes.join(",")}) — this is the legacy behavior that broke --max-chapters`
);

// ---------------------------------------------------------------------------
// Reproduce bootstrap's main() target-selection, then simulate its per-book
// runNcertDownload invocation with the new bookCodes option.
// ---------------------------------------------------------------------------

const grade = 11;
const language = "en" as const;
const subjectName = "Physics";
const maxChapters = 1;

const targets = NCERT_BOOK_CATALOG.filter(
  (b) =>
    b.grade === grade &&
    b.language === language &&
    b.subject.toLowerCase() === subjectName.toLowerCase()
);
const targetCodes = targets.map((t) => t.code).sort();

assert(
  targetCodes.join(",") === "keph1,keph2",
  `bootstrap main() selects exactly keph1 + keph2 for Gr11 Physics (got ${targetCodes.join(",")})`
);

// Simulate per-book loop
const perBookPlans = targets.map((book) => {
  const filtered = filterCatalog({
    grades: [book.grade],
    bookCodes: [book.code],
    languages: [book.language as "en" | "hi"],
  });
  return {
    book,
    filtered,
    chaptersToDownload: Math.min(book.chapters, maxChapters),
  };
});

for (const plan of perBookPlans) {
  assert(
    plan.filtered.length === 1 && plan.filtered[0].code === plan.book.code,
    `filterCatalog({bookCodes:["${plan.book.code}"]}) returns exactly one book — "${plan.book.code}"`
  );
  assert(
    plan.chaptersToDownload === 1,
    `${plan.book.code}: maxChapters=${maxChapters} → chaptersToDownload=${plan.chaptersToDownload}`
  );
}

// The critical property the old code violated: BOTH books get budget for ch01.
const totalCh1Processed = perBookPlans.reduce(
  (n, p) => n + (p.chaptersToDownload >= 1 ? 1 : 0),
  0
);
assert(
  totalCh1Processed === 2,
  `With --max-chapters 1, both keph1 ch01 AND keph2 ch01 are scheduled for processing (total ch01-processed = ${totalCh1Processed})`
);

// Belt-and-braces: verify bookCodes wins over subjects when both are set.
const bothSet = filterCatalog({
  grades: [11],
  bookCodes: ["keph1"],
  subjects: ["Physics"],
  languages: ["en"],
});
assert(
  bothSet.length === 1 && bothSet[0].code === "keph1",
  `bookCodes takes precedence over subjects when both are supplied`
);

console.log("\nAll smoke assertions passed.");
process.exit(0);
