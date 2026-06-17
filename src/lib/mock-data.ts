/**
 * Mock data for frontend development before backend APIs are ready.
 * Gated by USE_MOCK flag — set NEXT_PUBLIC_API_READY=true in .env to disable.
 */

import type {
  Board,
  Standard,
  Subject,
  Chapter,
  Topic,
  SubjectWithChapters,
  ChapterWithTopics,
  TopicWithContext,
} from "@/types/curriculum";
import type { ContentItem } from "@/types/content";
import { DEFAULT_ACADEMIC_YEAR } from "./academic-year";

export const USE_MOCK = !process.env.NEXT_PUBLIC_API_READY;

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------
const now = new Date().toISOString();

export const mockBoards: Board[] = [
  {
    id: 1,
    code: "CBSE",
    name: "CBSE",
    fullName: "Central Board of Secondary Education",
    state: null,
    websiteUrl: "https://cbseacademic.nic.in",
    syllabusUrl: "https://cbseacademic.nic.in/curriculum_2026.html",
    isActive: true,
    metadata: { type: "national", medium: ["English", "Hindi"] },
    createdAt: new Date(now),
  },
  {
    id: 2,
    code: "ICSE",
    name: "ICSE / ISC",
    fullName: "Indian Certificate of Secondary Education / Indian School Certificate",
    state: null,
    websiteUrl: "https://cisce.org",
    syllabusUrl: "https://cisce.org/publications.aspx",
    isActive: true,
    metadata: { type: "national", medium: ["English"] },
    createdAt: new Date(now),
  },
  {
    id: 3,
    code: "KL_SCERT",
    name: "Kerala SCERT",
    fullName: "State Council of Educational Research and Training, Kerala",
    state: "Kerala",
    websiteUrl: "https://scert.kerala.gov.in",
    syllabusUrl: "https://scert.kerala.gov.in/syllabus",
    isActive: true,
    metadata: { type: "state", medium: ["English", "Malayalam"] },
    createdAt: new Date(now),
  },
  {
    id: 4,
    code: "KA_KSEAB",
    name: "Karnataka",
    fullName: "Karnataka School Examination and Assessment Board",
    state: "Karnataka",
    websiteUrl: "https://kseab.karnataka.gov.in",
    syllabusUrl: null,
    isActive: true,
    metadata: { type: "state", medium: ["English", "Kannada"] },
    createdAt: new Date(now),
  },
  {
    id: 5,
    code: "TN_DGE",
    name: "Tamil Nadu",
    fullName: "Directorate of Government Examinations, Tamil Nadu",
    state: "Tamil Nadu",
    websiteUrl: "https://dge.tn.gov.in",
    syllabusUrl: null,
    isActive: true,
    metadata: { type: "state", medium: ["English", "Tamil"] },
    createdAt: new Date(now),
  },
];

// ---------------------------------------------------------------------------
// Standards (CBSE Classes 1-12)
// ---------------------------------------------------------------------------
export const mockStandards: Standard[] = Array.from({ length: 12 }, (_, i) => {
  const grade = i + 1;
  const base: Standard = {
    id: 100 + grade,
    boardId: 1,
    grade,
    stream: null,
    academicYear: DEFAULT_ACADEMIC_YEAR,
    isActive: true,
    metadata: {},
    createdAt: new Date(now),
  };
  return base;
}).concat(
  // Streams for Class 11 & 12
  ...[11, 12].map((grade) =>
    ["Science", "Commerce", "Humanities"].map((stream, si) => ({
      id: 200 + grade * 10 + si,
      boardId: 1,
      grade,
      stream,
      academicYear: DEFAULT_ACADEMIC_YEAR,
      isActive: true,
      metadata: {},
      createdAt: new Date(now),
    })),
  ),
);

// ---------------------------------------------------------------------------
// CBSE Class 10 — Subjects, Chapters, Topics
// ---------------------------------------------------------------------------
const class10Subjects: SubjectWithChapters[] = [
  {
    id: 1001,
    standardId: 110,
    code: "MATH",
    name: "Mathematics",
    nameLocal: null,
    subjectType: "theory",
    isElective: false,
    maxMarks: 80,
    metadata: { practicalMarks: 20 },
    createdAt: new Date(now),
    chapters: [
      {
        id: 2001,
        subjectId: 1001,
        chapterNumber: 1,
        title: "Real Numbers",
        titleLocal: null,
        description: "Euclid's division lemma, Fundamental Theorem of Arithmetic, irrational numbers, decimal expansions",
        textbookRef: "NCERT Mathematics Class 10",
        estimatedHours: "8.0",
        weightagePct: "6.00",
        metadata: {},
        sortOrder: 1,
        createdAt: new Date(now),
        topics: [
          { id: 3001, chapterId: 2001, title: "Euclid's Division Lemma", titleLocal: null, description: "Finding HCF using Euclid's algorithm", learningObjectives: ["Apply Euclid's division lemma", "Find HCF of two positive integers"], bloomLevel: "apply", estimatedMinutes: 45, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3002, chapterId: 2001, title: "Fundamental Theorem of Arithmetic", titleLocal: null, description: "Prime factorization and its applications", learningObjectives: ["State and prove FTA", "Find LCM and HCF using prime factorization"], bloomLevel: "understand", estimatedMinutes: 60, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
          { id: 3003, chapterId: 2001, title: "Irrational Numbers", titleLocal: null, description: "Proving irrationality of √2, √3, √5", learningObjectives: ["Prove that √2 is irrational", "Identify rational and irrational numbers"], bloomLevel: "analyze", estimatedMinutes: 40, sortOrder: 3, metadata: {}, createdAt: new Date(now) },
          { id: 3004, chapterId: 2001, title: "Decimal Expansions of Rational Numbers", titleLocal: null, description: "Terminating and non-terminating recurring decimals", learningObjectives: ["Determine decimal expansion type", "Convert decimals to fractions"], bloomLevel: "apply", estimatedMinutes: 35, sortOrder: 4, metadata: {}, createdAt: new Date(now) },
        ],
      },
      {
        id: 2002,
        subjectId: 1001,
        chapterNumber: 2,
        title: "Polynomials",
        titleLocal: null,
        description: "Zeros of a polynomial, relationship between zeros and coefficients, division algorithm",
        textbookRef: "NCERT Mathematics Class 10",
        estimatedHours: "7.0",
        weightagePct: "7.00",
        metadata: {},
        sortOrder: 2,
        createdAt: new Date(now),
        topics: [
          { id: 3005, chapterId: 2002, title: "Geometrical Meaning of Zeros", titleLocal: null, description: "Graphical representation of zeros of polynomials", learningObjectives: ["Find zeros from graphs", "Relate zeros to x-intercepts"], bloomLevel: "understand", estimatedMinutes: 40, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3006, chapterId: 2002, title: "Relationship Between Zeros and Coefficients", titleLocal: null, description: "Sum and product of zeros for quadratic polynomials", learningObjectives: ["Find sum and product of zeros", "Form polynomial given zeros"], bloomLevel: "apply", estimatedMinutes: 50, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
          { id: 3007, chapterId: 2002, title: "Division Algorithm for Polynomials", titleLocal: null, description: "Dividing polynomials and finding factors", learningObjectives: ["Apply division algorithm", "Find remaining zeros given one zero"], bloomLevel: "apply", estimatedMinutes: 55, sortOrder: 3, metadata: {}, createdAt: new Date(now) },
        ],
      },
      {
        id: 2003,
        subjectId: 1001,
        chapterNumber: 3,
        title: "Pair of Linear Equations in Two Variables",
        titleLocal: null,
        description: "Graphical and algebraic methods of solving linear equations",
        textbookRef: "NCERT Mathematics Class 10",
        estimatedHours: "10.0",
        weightagePct: "8.00",
        metadata: {},
        sortOrder: 3,
        createdAt: new Date(now),
        topics: [
          { id: 3008, chapterId: 2003, title: "Graphical Method of Solution", titleLocal: null, description: "Solving linear equations by plotting graphs", learningObjectives: ["Plot linear equations", "Identify consistent/inconsistent systems"], bloomLevel: "apply", estimatedMinutes: 50, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3009, chapterId: 2003, title: "Algebraic Methods — Substitution", titleLocal: null, description: "Solving by substitution method", learningObjectives: ["Solve using substitution"], bloomLevel: "apply", estimatedMinutes: 40, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
          { id: 3010, chapterId: 2003, title: "Algebraic Methods — Elimination", titleLocal: null, description: "Solving by elimination method", learningObjectives: ["Solve using elimination"], bloomLevel: "apply", estimatedMinutes: 40, sortOrder: 3, metadata: {}, createdAt: new Date(now) },
          { id: 3011, chapterId: 2003, title: "Cross-Multiplication Method", titleLocal: null, description: "Solving using determinants / cross multiplication", learningObjectives: ["Apply cross-multiplication formula"], bloomLevel: "apply", estimatedMinutes: 45, sortOrder: 4, metadata: {}, createdAt: new Date(now) },
        ],
      },
      {
        id: 2004,
        subjectId: 1001,
        chapterNumber: 4,
        title: "Quadratic Equations",
        titleLocal: null,
        description: "Standard form, solutions by factorisation and formula, nature of roots",
        textbookRef: "NCERT Mathematics Class 10",
        estimatedHours: "9.0",
        weightagePct: "10.00",
        metadata: {},
        sortOrder: 4,
        createdAt: new Date(now),
        topics: [
          { id: 3012, chapterId: 2004, title: "Standard Form and Solutions by Factorisation", titleLocal: null, description: "Writing in standard form and solving by splitting middle term", learningObjectives: ["Convert to standard form", "Solve by factorisation"], bloomLevel: "apply", estimatedMinutes: 50, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3013, chapterId: 2004, title: "Quadratic Formula", titleLocal: null, description: "Using the quadratic formula to find roots", learningObjectives: ["Apply quadratic formula", "Simplify solutions"], bloomLevel: "apply", estimatedMinutes: 45, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
          { id: 3014, chapterId: 2004, title: "Nature of Roots (Discriminant)", titleLocal: null, description: "Using discriminant to determine nature without solving", learningObjectives: ["Calculate discriminant", "Classify roots"], bloomLevel: "analyze", estimatedMinutes: 35, sortOrder: 3, metadata: {}, createdAt: new Date(now) },
        ],
      },
      {
        id: 2005,
        subjectId: 1001,
        chapterNumber: 5,
        title: "Arithmetic Progressions",
        titleLocal: null,
        description: "nth term, sum of first n terms, applications",
        textbookRef: "NCERT Mathematics Class 10",
        estimatedHours: "8.0",
        weightagePct: "8.00",
        metadata: {},
        sortOrder: 5,
        createdAt: new Date(now),
        topics: [
          { id: 3015, chapterId: 2005, title: "Introduction to AP", titleLocal: null, description: "Common difference, identifying APs", learningObjectives: ["Identify arithmetic progressions", "Find common difference"], bloomLevel: "understand", estimatedMinutes: 30, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3016, chapterId: 2005, title: "nth Term of an AP", titleLocal: null, description: "Formula for general term", learningObjectives: ["Find nth term", "Determine if a number belongs to an AP"], bloomLevel: "apply", estimatedMinutes: 40, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
          { id: 3017, chapterId: 2005, title: "Sum of First n Terms", titleLocal: null, description: "Formula and applications of sum", learningObjectives: ["Calculate sum of n terms", "Solve word problems"], bloomLevel: "apply", estimatedMinutes: 50, sortOrder: 3, metadata: {}, createdAt: new Date(now) },
        ],
      },
    ],
  },
  {
    id: 1002,
    standardId: 110,
    code: "SCI",
    name: "Science",
    nameLocal: null,
    subjectType: "theory",
    isElective: false,
    maxMarks: 80,
    metadata: { practicalMarks: 20 },
    createdAt: new Date(now),
    chapters: [
      {
        id: 2010,
        subjectId: 1002,
        chapterNumber: 1,
        title: "Chemical Reactions and Equations",
        titleLocal: null,
        description: "Types of chemical reactions, balancing equations, effects of oxidation",
        textbookRef: "NCERT Science Class 10",
        estimatedHours: "8.0",
        weightagePct: "8.00",
        metadata: {},
        sortOrder: 1,
        createdAt: new Date(now),
        topics: [
          { id: 3020, chapterId: 2010, title: "Chemical Equations", titleLocal: null, description: "Writing and balancing chemical equations", learningObjectives: ["Write word and symbol equations", "Balance chemical equations"], bloomLevel: "apply", estimatedMinutes: 45, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3021, chapterId: 2010, title: "Types of Chemical Reactions", titleLocal: null, description: "Combination, decomposition, displacement, double displacement, redox", learningObjectives: ["Classify reaction types", "Predict reaction products"], bloomLevel: "understand", estimatedMinutes: 60, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
          { id: 3022, chapterId: 2010, title: "Oxidation and Reduction", titleLocal: null, description: "Corrosion and rancidity as everyday examples", learningObjectives: ["Define oxidation and reduction", "Identify oxidising and reducing agents"], bloomLevel: "understand", estimatedMinutes: 40, sortOrder: 3, metadata: {}, createdAt: new Date(now) },
        ],
      },
      {
        id: 2011,
        subjectId: 1002,
        chapterNumber: 2,
        title: "Acids, Bases and Salts",
        titleLocal: null,
        description: "Properties, reactions, pH scale, common salts",
        textbookRef: "NCERT Science Class 10",
        estimatedHours: "9.0",
        weightagePct: "7.00",
        metadata: {},
        sortOrder: 2,
        createdAt: new Date(now),
        topics: [
          { id: 3023, chapterId: 2011, title: "Understanding Acids and Bases", titleLocal: null, description: "Properties and indicators for acids and bases", learningObjectives: ["Test acids and bases with indicators", "Write neutralization reactions"], bloomLevel: "understand", estimatedMinutes: 50, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3024, chapterId: 2011, title: "pH Scale", titleLocal: null, description: "Measuring acidity and basicity, pH of common substances", learningObjectives: ["Read pH scale", "Explain importance of pH in everyday life"], bloomLevel: "understand", estimatedMinutes: 40, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
          { id: 3025, chapterId: 2011, title: "Salts and Their Properties", titleLocal: null, description: "Preparation and uses of common salts", learningObjectives: ["Describe preparation of salts", "Explain uses of NaCl, NaOH, baking soda, washing soda"], bloomLevel: "remember", estimatedMinutes: 45, sortOrder: 3, metadata: {}, createdAt: new Date(now) },
        ],
      },
      {
        id: 2012,
        subjectId: 1002,
        chapterNumber: 3,
        title: "Metals and Non-metals",
        titleLocal: null,
        description: "Physical and chemical properties, reactivity series, extraction, corrosion",
        textbookRef: "NCERT Science Class 10",
        estimatedHours: "10.0",
        weightagePct: "8.00",
        metadata: {},
        sortOrder: 3,
        createdAt: new Date(now),
        topics: [
          { id: 3026, chapterId: 2012, title: "Physical Properties of Metals and Non-metals", titleLocal: null, description: "Lustre, malleability, ductility, conductivity", learningObjectives: ["Compare physical properties", "Identify exceptions"], bloomLevel: "remember", estimatedMinutes: 35, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3027, chapterId: 2012, title: "Chemical Properties of Metals", titleLocal: null, description: "Reactions with oxygen, water, acids, salt solutions", learningObjectives: ["Write equations for metal reactions", "Arrange metals in reactivity series"], bloomLevel: "understand", estimatedMinutes: 50, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
          { id: 3028, chapterId: 2012, title: "Extraction of Metals", titleLocal: null, description: "Enrichment, reduction, refining based on reactivity", learningObjectives: ["Explain extraction methods for different metals"], bloomLevel: "understand", estimatedMinutes: 45, sortOrder: 3, metadata: {}, createdAt: new Date(now) },
        ],
      },
    ],
  },
  {
    id: 1003,
    standardId: 110,
    code: "ENG",
    name: "English",
    nameLocal: null,
    subjectType: "theory",
    isElective: false,
    maxMarks: 80,
    metadata: { practicalMarks: 20 },
    createdAt: new Date(now),
    chapters: [
      {
        id: 2020,
        subjectId: 1003,
        chapterNumber: 1,
        title: "A Letter to God",
        titleLocal: null,
        description: "First Flight — G.L. Fuentes",
        textbookRef: "NCERT First Flight Class 10",
        estimatedHours: "4.0",
        weightagePct: "5.00",
        metadata: {},
        sortOrder: 1,
        createdAt: new Date(now),
        topics: [
          { id: 3030, chapterId: 2020, title: "Summary and Theme", titleLocal: null, description: "Key events, characters, theme of faith", learningObjectives: ["Summarize the story", "Identify the central theme"], bloomLevel: "understand", estimatedMinutes: 30, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3031, chapterId: 2020, title: "Character Analysis", titleLocal: null, description: "Lencho's character, the postmaster's generosity", learningObjectives: ["Analyze Lencho's character traits"], bloomLevel: "analyze", estimatedMinutes: 25, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
        ],
      },
      {
        id: 2021,
        subjectId: 1003,
        chapterNumber: 2,
        title: "Nelson Mandela: Long Walk to Freedom",
        titleLocal: null,
        description: "First Flight — autobiography extract",
        textbookRef: "NCERT First Flight Class 10",
        estimatedHours: "5.0",
        weightagePct: "5.00",
        metadata: {},
        sortOrder: 2,
        createdAt: new Date(now),
        topics: [
          { id: 3032, chapterId: 2021, title: "Summary and Key Events", titleLocal: null, description: "Inauguration day, reflections on freedom", learningObjectives: ["Describe the inauguration ceremony", "Explain Mandela's idea of freedom"], bloomLevel: "understand", estimatedMinutes: 35, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
        ],
      },
    ],
  },
  {
    id: 1004,
    standardId: 110,
    code: "SST",
    name: "Social Science",
    nameLocal: null,
    subjectType: "theory",
    isElective: false,
    maxMarks: 80,
    metadata: {},
    createdAt: new Date(now),
    chapters: [
      {
        id: 2030,
        subjectId: 1004,
        chapterNumber: 1,
        title: "The Rise of Nationalism in Europe",
        titleLocal: null,
        description: "History — French Revolution to nation-states",
        textbookRef: "NCERT India and the Contemporary World II",
        estimatedHours: "7.0",
        weightagePct: "5.00",
        metadata: {},
        sortOrder: 1,
        createdAt: new Date(now),
        topics: [
          { id: 3040, chapterId: 2030, title: "The French Revolution and Nationalism", titleLocal: null, description: "Ideas of la patrie and le citoyen", learningObjectives: ["Explain how the French Revolution led to nationalism"], bloomLevel: "understand", estimatedMinutes: 40, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
          { id: 3041, chapterId: 2030, title: "The Making of Nationalism in Europe", titleLocal: null, description: "Romanticism, culture, and national identity", learningObjectives: ["Describe the role of culture in nation building"], bloomLevel: "understand", estimatedMinutes: 45, sortOrder: 2, metadata: {}, createdAt: new Date(now) },
        ],
      },
      {
        id: 2031,
        subjectId: 1004,
        chapterNumber: 2,
        title: "Resources and Development",
        titleLocal: null,
        description: "Geography — types, conservation, land use",
        textbookRef: "NCERT Contemporary India II",
        estimatedHours: "6.0",
        weightagePct: "5.00",
        metadata: {},
        sortOrder: 2,
        createdAt: new Date(now),
        topics: [
          { id: 3042, chapterId: 2031, title: "Types of Resources", titleLocal: null, description: "Natural, human-made, human; renewable and non-renewable", learningObjectives: ["Classify resources", "Explain resource planning"], bloomLevel: "understand", estimatedMinutes: 35, sortOrder: 1, metadata: {}, createdAt: new Date(now) },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Content Items (sample markdown notes for a few topics)
// ---------------------------------------------------------------------------
export const mockContentItems: ContentItem[] = [
  {
    id: 5001,
    topicId: 3001,
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

**HCF(455, 42) = 7** ✓

## Practice Problems
1. Find HCF of 4052 and 12576
2. Show that every positive even integer is of the form $2q$ and every odd integer is of the form $2q + 1$
3. Use Euclid's lemma to show that the cube of any positive integer is of the form $9m$, $9m + 1$, or $9m + 8$
`,
    bodyFormat: "markdown",
    sourceType: "ai_generated",
    sourceUrl: null,
    uploadedBy: null,
    language: "en",
    qualityScore: "0.92",
    reviewStatus: "approved",
    reviewedBy: null,
    viewCount: 234,
    upvoteCount: 18,
    isPublished: true,
    metadata: {},
    createdAt: new Date(now),
    updatedAt: new Date(now),
  },
  {
    id: 5002,
    topicId: 3001,
    contentType: "summary",
    title: "Quick Summary — Euclid's Division Lemma",
    body: `## TL;DR

- **Euclid's Division Lemma**: $a = bq + r$ where $0 \\leq r < b$
- Used to find **HCF** by repeated division
- Keep dividing divisor by remainder until remainder = 0
- Last non-zero remainder = HCF
- Works for **any two positive integers**
`,
    bodyFormat: "markdown",
    sourceType: "ai_generated",
    sourceUrl: null,
    uploadedBy: null,
    language: "en",
    qualityScore: "0.88",
    reviewStatus: "approved",
    reviewedBy: null,
    viewCount: 156,
    upvoteCount: 12,
    isPublished: true,
    metadata: {},
    createdAt: new Date(now),
    updatedAt: new Date(now),
  },
  {
    id: 5003,
    topicId: 3020,
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
    bodyFormat: "markdown",
    sourceType: "ai_generated",
    sourceUrl: null,
    uploadedBy: null,
    language: "en",
    qualityScore: "0.90",
    reviewStatus: "approved",
    reviewedBy: null,
    viewCount: 312,
    upvoteCount: 25,
    isPublished: true,
    metadata: {},
    createdAt: new Date(now),
    updatedAt: new Date(now),
  },
];

// ---------------------------------------------------------------------------
// Helper functions to query mock data
// ---------------------------------------------------------------------------

export function getMockBoards(): Board[] {
  return mockBoards;
}

export function getMockStandards(boardId: number): Standard[] {
  return mockStandards.filter((s) => s.boardId === boardId);
}

export function getMockSubjects(boardId: number, grade: number, stream?: string | null): SubjectWithChapters[] {
  // For CBSE Class 10, return our detailed mock data
  if (boardId === 1 && grade === 10) return class10Subjects;
  // For other combos, return empty (no data yet)
  return [];
}

export function getMockTopic(topicId: number): TopicWithContext | null {
  for (const subject of class10Subjects) {
    for (const chapter of subject.chapters) {
      const topic = chapter.topics.find((t) => t.id === topicId);
      if (topic) {
        const { topics: _t, ...chapterData } = chapter;
        const { chapters: _c, ...subjectData } = subject;
        return {
          ...topic,
          chapter: chapterData,
          subject: subjectData,
          standard: mockStandards.find((s) => s.id === subject.standardId)!,
          board: mockBoards.find((b) => b.id === 1)!,
        };
      }
    }
  }
  return null;
}

export function getMockContentForTopic(topicId: number): ContentItem[] {
  return mockContentItems.filter((c) => c.topicId === topicId);
}

export function getMockSubjectWithChapters(subjectId: number): SubjectWithChapters | null {
  return class10Subjects.find((s) => s.id === subjectId) ?? null;
}

/** Get all topics across all subjects (flat list) */
export function getAllMockTopics(): Topic[] {
  const topics: Topic[] = [];
  for (const subject of class10Subjects) {
    for (const chapter of subject.chapters) {
      topics.push(...chapter.topics);
    }
  }
  return topics;
}
