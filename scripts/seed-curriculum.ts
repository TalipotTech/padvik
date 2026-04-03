/**
 * Seeds CBSE Class 10 chapters, topics, and sample content items.
 * Must run AFTER seed-boards.ts (which creates boards, standards, subjects).
 *
 * Usage: pnpm db:seed:curriculum
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNull } from "drizzle-orm";
import { boards, standards, subjects, chapters, topics } from "../src/db/schema/curriculum";
import { contentItems } from "../src/db/schema/content";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client);

// ---------------------------------------------------------------------------
// Chapter + Topic data for CBSE Class 10
// ---------------------------------------------------------------------------
interface TopicDef {
  title: string;
  description: string;
  learningObjectives: string[];
  bloomLevel: string;
  estimatedMinutes: number;
  sortOrder: number;
}

interface ChapterDef {
  chapterNumber: number;
  title: string;
  description: string;
  textbookRef: string;
  estimatedHours: string;
  weightagePct: string;
  sortOrder: number;
  topics: TopicDef[];
}

interface SubjectCurriculum {
  code: string;
  chapters: ChapterDef[];
}

const CBSE_CLASS10: SubjectCurriculum[] = [
  {
    code: "MATH_STD",
    chapters: [
      {
        chapterNumber: 1, title: "Real Numbers", description: "Euclid's division lemma, Fundamental Theorem of Arithmetic, irrational numbers, decimal expansions", textbookRef: "NCERT Mathematics Class 10", estimatedHours: "8.0", weightagePct: "6.00", sortOrder: 1,
        topics: [
          { title: "Euclid's Division Lemma", description: "Finding HCF using Euclid's algorithm", learningObjectives: ["Apply Euclid's division lemma", "Find HCF of two positive integers"], bloomLevel: "apply", estimatedMinutes: 45, sortOrder: 1 },
          { title: "Fundamental Theorem of Arithmetic", description: "Prime factorization and its applications", learningObjectives: ["State and prove FTA", "Find LCM and HCF using prime factorization"], bloomLevel: "understand", estimatedMinutes: 60, sortOrder: 2 },
          { title: "Irrational Numbers", description: "Proving irrationality of √2, √3, √5", learningObjectives: ["Prove that √2 is irrational", "Identify rational and irrational numbers"], bloomLevel: "analyze", estimatedMinutes: 40, sortOrder: 3 },
          { title: "Decimal Expansions of Rational Numbers", description: "Terminating and non-terminating recurring decimals", learningObjectives: ["Determine decimal expansion type", "Convert decimals to fractions"], bloomLevel: "apply", estimatedMinutes: 35, sortOrder: 4 },
        ],
      },
      {
        chapterNumber: 2, title: "Polynomials", description: "Zeros of a polynomial, relationship between zeros and coefficients, division algorithm", textbookRef: "NCERT Mathematics Class 10", estimatedHours: "7.0", weightagePct: "7.00", sortOrder: 2,
        topics: [
          { title: "Geometrical Meaning of Zeros", description: "Graphical representation of zeros of polynomials", learningObjectives: ["Find zeros from graphs", "Relate zeros to x-intercepts"], bloomLevel: "understand", estimatedMinutes: 40, sortOrder: 1 },
          { title: "Relationship Between Zeros and Coefficients", description: "Sum and product of zeros for quadratic polynomials", learningObjectives: ["Find sum and product of zeros", "Form polynomial given zeros"], bloomLevel: "apply", estimatedMinutes: 50, sortOrder: 2 },
          { title: "Division Algorithm for Polynomials", description: "Dividing polynomials and finding factors", learningObjectives: ["Apply division algorithm", "Find remaining zeros given one zero"], bloomLevel: "apply", estimatedMinutes: 55, sortOrder: 3 },
        ],
      },
      {
        chapterNumber: 3, title: "Pair of Linear Equations in Two Variables", description: "Graphical and algebraic methods of solving linear equations", textbookRef: "NCERT Mathematics Class 10", estimatedHours: "10.0", weightagePct: "8.00", sortOrder: 3,
        topics: [
          { title: "Graphical Method of Solution", description: "Solving linear equations by plotting graphs", learningObjectives: ["Plot linear equations", "Identify consistent/inconsistent systems"], bloomLevel: "apply", estimatedMinutes: 50, sortOrder: 1 },
          { title: "Algebraic Methods — Substitution", description: "Solving by substitution method", learningObjectives: ["Solve using substitution"], bloomLevel: "apply", estimatedMinutes: 40, sortOrder: 2 },
          { title: "Algebraic Methods — Elimination", description: "Solving by elimination method", learningObjectives: ["Solve using elimination"], bloomLevel: "apply", estimatedMinutes: 40, sortOrder: 3 },
          { title: "Cross-Multiplication Method", description: "Solving using determinants / cross multiplication", learningObjectives: ["Apply cross-multiplication formula"], bloomLevel: "apply", estimatedMinutes: 45, sortOrder: 4 },
        ],
      },
      {
        chapterNumber: 4, title: "Quadratic Equations", description: "Standard form, solutions by factorisation and formula, nature of roots", textbookRef: "NCERT Mathematics Class 10", estimatedHours: "9.0", weightagePct: "10.00", sortOrder: 4,
        topics: [
          { title: "Standard Form and Solutions by Factorisation", description: "Writing in standard form and solving by splitting middle term", learningObjectives: ["Convert to standard form", "Solve by factorisation"], bloomLevel: "apply", estimatedMinutes: 50, sortOrder: 1 },
          { title: "Quadratic Formula", description: "Using the quadratic formula to find roots", learningObjectives: ["Apply quadratic formula", "Simplify solutions"], bloomLevel: "apply", estimatedMinutes: 45, sortOrder: 2 },
          { title: "Nature of Roots (Discriminant)", description: "Using discriminant to determine nature without solving", learningObjectives: ["Calculate discriminant", "Classify roots"], bloomLevel: "analyze", estimatedMinutes: 35, sortOrder: 3 },
        ],
      },
      {
        chapterNumber: 5, title: "Arithmetic Progressions", description: "nth term, sum of first n terms, applications", textbookRef: "NCERT Mathematics Class 10", estimatedHours: "8.0", weightagePct: "8.00", sortOrder: 5,
        topics: [
          { title: "Introduction to AP", description: "Common difference, identifying APs", learningObjectives: ["Identify arithmetic progressions", "Find common difference"], bloomLevel: "understand", estimatedMinutes: 30, sortOrder: 1 },
          { title: "nth Term of an AP", description: "Formula for general term", learningObjectives: ["Find nth term", "Determine if a number belongs to an AP"], bloomLevel: "apply", estimatedMinutes: 40, sortOrder: 2 },
          { title: "Sum of First n Terms", description: "Formula and applications of sum", learningObjectives: ["Calculate sum of n terms", "Solve word problems"], bloomLevel: "apply", estimatedMinutes: 50, sortOrder: 3 },
        ],
      },
    ],
  },
  {
    code: "SCI",
    chapters: [
      {
        chapterNumber: 1, title: "Chemical Reactions and Equations", description: "Types of chemical reactions, balancing equations, effects of oxidation", textbookRef: "NCERT Science Class 10", estimatedHours: "8.0", weightagePct: "8.00", sortOrder: 1,
        topics: [
          { title: "Chemical Equations", description: "Writing and balancing chemical equations", learningObjectives: ["Write word and symbol equations", "Balance chemical equations"], bloomLevel: "apply", estimatedMinutes: 45, sortOrder: 1 },
          { title: "Types of Chemical Reactions", description: "Combination, decomposition, displacement, double displacement, redox", learningObjectives: ["Classify reaction types", "Predict reaction products"], bloomLevel: "understand", estimatedMinutes: 60, sortOrder: 2 },
          { title: "Oxidation and Reduction", description: "Corrosion and rancidity as everyday examples", learningObjectives: ["Define oxidation and reduction", "Identify oxidising and reducing agents"], bloomLevel: "understand", estimatedMinutes: 40, sortOrder: 3 },
        ],
      },
      {
        chapterNumber: 2, title: "Acids, Bases and Salts", description: "Properties, reactions, pH scale, common salts", textbookRef: "NCERT Science Class 10", estimatedHours: "9.0", weightagePct: "7.00", sortOrder: 2,
        topics: [
          { title: "Understanding Acids and Bases", description: "Properties and indicators for acids and bases", learningObjectives: ["Test acids and bases with indicators", "Write neutralization reactions"], bloomLevel: "understand", estimatedMinutes: 50, sortOrder: 1 },
          { title: "pH Scale", description: "Measuring acidity and basicity, pH of common substances", learningObjectives: ["Read pH scale", "Explain importance of pH in everyday life"], bloomLevel: "understand", estimatedMinutes: 40, sortOrder: 2 },
          { title: "Salts and Their Properties", description: "Preparation and uses of common salts", learningObjectives: ["Describe preparation of salts", "Explain uses of NaCl, NaOH, baking soda, washing soda"], bloomLevel: "remember", estimatedMinutes: 45, sortOrder: 3 },
        ],
      },
      {
        chapterNumber: 3, title: "Metals and Non-metals", description: "Physical and chemical properties, reactivity series, extraction, corrosion", textbookRef: "NCERT Science Class 10", estimatedHours: "10.0", weightagePct: "8.00", sortOrder: 3,
        topics: [
          { title: "Physical Properties of Metals and Non-metals", description: "Lustre, malleability, ductility, conductivity", learningObjectives: ["Compare physical properties", "Identify exceptions"], bloomLevel: "remember", estimatedMinutes: 35, sortOrder: 1 },
          { title: "Chemical Properties of Metals", description: "Reactions with oxygen, water, acids, salt solutions", learningObjectives: ["Write equations for metal reactions", "Arrange metals in reactivity series"], bloomLevel: "understand", estimatedMinutes: 50, sortOrder: 2 },
          { title: "Extraction of Metals", description: "Enrichment, reduction, refining based on reactivity", learningObjectives: ["Explain extraction methods for different metals"], bloomLevel: "understand", estimatedMinutes: 45, sortOrder: 3 },
        ],
      },
    ],
  },
  {
    code: "ENG_CORE",
    chapters: [
      {
        chapterNumber: 1, title: "A Letter to God", description: "First Flight — G.L. Fuentes", textbookRef: "NCERT First Flight Class 10", estimatedHours: "4.0", weightagePct: "5.00", sortOrder: 1,
        topics: [
          { title: "Summary and Theme", description: "Key events, characters, theme of faith", learningObjectives: ["Summarize the story", "Identify the central theme"], bloomLevel: "understand", estimatedMinutes: 30, sortOrder: 1 },
          { title: "Character Analysis", description: "Lencho's character, the postmaster's generosity", learningObjectives: ["Analyze Lencho's character traits"], bloomLevel: "analyze", estimatedMinutes: 25, sortOrder: 2 },
        ],
      },
      {
        chapterNumber: 2, title: "Nelson Mandela: Long Walk to Freedom", description: "First Flight — autobiography extract", textbookRef: "NCERT First Flight Class 10", estimatedHours: "5.0", weightagePct: "5.00", sortOrder: 2,
        topics: [
          { title: "Summary and Key Events", description: "Inauguration day, reflections on freedom", learningObjectives: ["Describe the inauguration ceremony", "Explain Mandela's idea of freedom"], bloomLevel: "understand", estimatedMinutes: 35, sortOrder: 1 },
        ],
      },
    ],
  },
  {
    code: "SST",
    chapters: [
      {
        chapterNumber: 1, title: "The Rise of Nationalism in Europe", description: "History — French Revolution to nation-states", textbookRef: "NCERT India and the Contemporary World II", estimatedHours: "7.0", weightagePct: "5.00", sortOrder: 1,
        topics: [
          { title: "The French Revolution and Nationalism", description: "Ideas of la patrie and le citoyen", learningObjectives: ["Explain how the French Revolution led to nationalism"], bloomLevel: "understand", estimatedMinutes: 40, sortOrder: 1 },
          { title: "The Making of Nationalism in Europe", description: "Romanticism, culture, and national identity", learningObjectives: ["Describe the role of culture in nation building"], bloomLevel: "understand", estimatedMinutes: 45, sortOrder: 2 },
        ],
      },
      {
        chapterNumber: 2, title: "Resources and Development", description: "Geography — types, conservation, land use", textbookRef: "NCERT Contemporary India II", estimatedHours: "6.0", weightagePct: "5.00", sortOrder: 2,
        topics: [
          { title: "Types of Resources", description: "Natural, human-made, human; renewable and non-renewable", learningObjectives: ["Classify resources", "Explain resource planning"], bloomLevel: "understand", estimatedMinutes: 35, sortOrder: 1 },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Sample content items (markdown notes)
// ---------------------------------------------------------------------------
const SAMPLE_CONTENT = [
  {
    topicTitle: "Euclid's Division Lemma",
    subjectCode: "MATH_STD",
    items: [
      {
        contentType: "notes",
        title: "Euclid's Division Lemma — Complete Notes",
        body: `# Euclid's Division Lemma

## Statement
For any two positive integers **a** and **b**, there exist unique integers **q** and **r** such that:

$$a = bq + r, \\quad 0 \\leq r < b$$

where **q** is the quotient and **r** is the remainder.

## Key Points
- This is used to find the **HCF** (Highest Common Factor) of two numbers
- The process is called **Euclid's Division Algorithm**
- It was first recorded in Euclid's *Elements* (around 300 BCE)

## Algorithm to Find HCF

1. Apply the division lemma to \`a\` and \`b\`: $a = bq + r$
2. If $r = 0$, then HCF = $b$
3. If $r \\neq 0$, apply the lemma to $b$ and $r$
4. Continue until the remainder is 0
5. The divisor at the last step is the HCF

## Example

Find HCF of 455 and 42:

\`\`\`
455 = 42 × 10 + 35
 42 = 35 × 1  + 7
 35 =  7 × 5  + 0
\`\`\`

**HCF(455, 42) = 7**

## Practice Problems
1. Find HCF of 4052 and 12576
2. Show that every positive even integer is of the form $2q$ and every odd integer is of the form $2q + 1$
3. Use Euclid's lemma to show that the cube of any positive integer is of the form $9m$, $9m + 1$, or $9m + 8$
`,
        qualityScore: "0.92",
      },
      {
        contentType: "summary",
        title: "Quick Summary — Euclid's Division Lemma",
        body: `## TL;DR

- **Euclid's Division Lemma**: $a = bq + r$ where $0 \\leq r < b$
- Used to find **HCF** by repeated division
- Keep dividing divisor by remainder until remainder = 0
- Last non-zero remainder = HCF
- Works for **any two positive integers**
`,
        qualityScore: "0.88",
      },
    ],
  },
  {
    topicTitle: "Chemical Equations",
    subjectCode: "SCI",
    items: [
      {
        contentType: "notes",
        title: "Chemical Equations — Complete Notes",
        body: `# Chemical Equations

## What is a Chemical Equation?

A **chemical equation** is a symbolic representation of a chemical reaction using formulas and symbols.

### Word Equation
\`\`\`
Magnesium + Oxygen → Magnesium Oxide
\`\`\`

### Symbol Equation
$$2Mg + O_2 \\rightarrow 2MgO$$

## Balancing Chemical Equations

A balanced equation has **equal number of atoms** of each element on both sides.

### Steps:
1. Write the unbalanced equation
2. Count atoms of each element on both sides
3. Balance one element at a time using coefficients
4. Start with the element that appears least often
5. Check: verify all elements are balanced

### Example: Balancing

**Unbalanced:** $Fe + H_2O \\rightarrow Fe_3O_4 + H_2$

**Balanced:** $3Fe + 4H_2O \\rightarrow Fe_3O_4 + 4H_2$

## Types of Chemical Reactions

| Type | Description | Example |
|------|-------------|---------|
| **Combination** | Two or more substances combine | $2H_2 + O_2 \\rightarrow 2H_2O$ |
| **Decomposition** | One substance breaks into simpler substances | $2H_2O \\rightarrow 2H_2 + O_2$ |
| **Displacement** | More reactive element displaces less reactive | $Zn + CuSO_4 \\rightarrow ZnSO_4 + Cu$ |
| **Double Displacement** | Exchange of ions between two compounds | $NaOH + HCl \\rightarrow NaCl + H_2O$ |
| **Redox** | Simultaneous oxidation and reduction | $CuO + H_2 \\rightarrow Cu + H_2O$ |

## Key Terms
- **Reactants**: Substances on the left side (before →)
- **Products**: Substances on the right side (after →)
- **Catalyst**: Speeds up reaction without being consumed
- **Precipitate**: Insoluble solid formed in a reaction (shown with ↓)
- **Gas**: Evolution shown with ↑
`,
        qualityScore: "0.90",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------
async function seedCurriculum() {
  console.log("=== Padvik Curriculum Seed Script ===\n");

  // 1. Get CBSE board
  const [cbse] = await db.select().from(boards).where(eq(boards.code, "CBSE")).limit(1);
  if (!cbse) {
    console.error("ERROR: CBSE board not found. Run `pnpm db:seed` first.");
    process.exit(1);
  }
  console.log(`1. CBSE board id: ${cbse.id}`);

  // 2. Get Class 10 standard (no stream)
  const [class10] = await db
    .select()
    .from(standards)
    .where(
      and(
        eq(standards.boardId, cbse.id),
        eq(standards.grade, 10),
        isNull(standards.stream),
      ),
    )
    .limit(1);

  if (!class10) {
    console.error("ERROR: CBSE Class 10 standard not found. Run `pnpm db:seed` first.");
    process.exit(1);
  }
  console.log(`2. Class 10 standard id: ${class10.id}`);

  // 3. Get subjects for Class 10
  const subjectRows = await db
    .select()
    .from(subjects)
    .where(eq(subjects.standardId, class10.id));

  const subjectMap = new Map<string, number>();
  for (const s of subjectRows) {
    subjectMap.set(s.code, s.id);
  }
  console.log(`3. Found ${subjectRows.length} subjects for Class 10`);

  // 4. Seed chapters and topics
  console.log("\n4. Seeding chapters and topics...");
  // Track topic IDs for content insertion: Map<"subjectCode:topicTitle", topicId>
  const topicIdMap = new Map<string, number>();
  let totalChapters = 0;
  let totalTopics = 0;

  for (const subjectCurr of CBSE_CLASS10) {
    const subjectId = subjectMap.get(subjectCurr.code);
    if (!subjectId) {
      console.warn(`   ⚠ Subject ${subjectCurr.code} not found, skipping`);
      continue;
    }

    for (const ch of subjectCurr.chapters) {
      // Insert chapter
      const [insertedChapter] = await db
        .insert(chapters)
        .values({
          subjectId,
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          description: ch.description,
          textbookRef: ch.textbookRef,
          estimatedHours: ch.estimatedHours,
          weightagePct: ch.weightagePct,
          sortOrder: ch.sortOrder,
        })
        .onConflictDoNothing()
        .returning({ id: chapters.id });

      if (!insertedChapter) {
        console.log(`   - Chapter "${ch.title}" already exists, skipping`);
        continue;
      }

      totalChapters++;
      console.log(`   ✓ Ch ${ch.chapterNumber}: ${ch.title} (id: ${insertedChapter.id})`);

      // Insert topics for this chapter
      for (const t of ch.topics) {
        const [insertedTopic] = await db
          .insert(topics)
          .values({
            chapterId: insertedChapter.id,
            title: t.title,
            description: t.description,
            learningObjectives: t.learningObjectives,
            bloomLevel: t.bloomLevel,
            estimatedMinutes: t.estimatedMinutes,
            sortOrder: t.sortOrder,
          })
          .returning({ id: topics.id });

        totalTopics++;
        topicIdMap.set(`${subjectCurr.code}:${t.title}`, insertedTopic.id);
        console.log(`     · ${t.title} (id: ${insertedTopic.id})`);
      }
    }
  }

  console.log(`\n   Total chapters: ${totalChapters}`);
  console.log(`   Total topics: ${totalTopics}`);

  // 5. Seed sample content items
  console.log("\n5. Seeding sample content items...");
  let totalContent = 0;

  for (const contentDef of SAMPLE_CONTENT) {
    const topicKey = `${contentDef.subjectCode}:${contentDef.topicTitle}`;
    const topicId = topicIdMap.get(topicKey);
    if (!topicId) {
      console.warn(`   ⚠ Topic "${contentDef.topicTitle}" not found, skipping content`);
      continue;
    }

    for (const item of contentDef.items) {
      await db.insert(contentItems).values({
        topicId,
        contentType: item.contentType,
        title: item.title,
        body: item.body,
        bodyFormat: "markdown",
        sourceType: "ai_generated",
        language: "en",
        qualityScore: item.qualityScore,
        reviewStatus: "approved",
        isPublished: true,
        viewCount: 0,
        upvoteCount: 0,
      });
      totalContent++;
      console.log(`   ✓ ${item.contentType}: ${item.title}`);
    }
  }

  console.log(`\n   Total content items: ${totalContent}`);

  // ---- Summary ----
  console.log("\n=== Curriculum Seed Complete ===");
  console.log(`   Chapters:      ${totalChapters}`);
  console.log(`   Topics:        ${totalTopics}`);
  console.log(`   Content items: ${totalContent}`);
}

seedCurriculum()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Curriculum seed failed:", err);
    process.exit(1);
  });
