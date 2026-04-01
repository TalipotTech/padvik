import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { boards, standards, subjects } from "../src/db/schema/curriculum";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client);

const ACADEMIC_YEAR = "2025-26";

// ---------------------------------------------------------------------------
// Phase 1 boards
// ---------------------------------------------------------------------------
const PHASE1_BOARDS = [
  {
    code: "CBSE",
    name: "CBSE",
    fullName: "Central Board of Secondary Education",
    state: null,
    websiteUrl: "https://www.cbse.gov.in",
    syllabusUrl: "https://cbseacademic.nic.in/curriculum_2026.html",
    metadata: {
      type: "national",
      grading: "9-point",
      medium: ["english", "hindi"],
      textbooks: "NCERT",
      exam_months: ["february", "march"],
      approx_schools: 27000,
      approx_students_millions: 18,
    },
  },
  {
    code: "ICSE",
    name: "ICSE",
    fullName:
      "Indian Certificate of Secondary Education (Council for the Indian School Certificate Examinations)",
    state: null,
    websiteUrl: "https://www.cisce.org",
    syllabusUrl: "https://www.cisce.org/publications.aspx",
    metadata: {
      type: "national",
      grading: "percentage",
      medium: ["english"],
      textbooks: "Multiple publishers",
      exam_months: ["february", "march"],
      note: "ISC for classes 11-12",
      approx_schools: 2600,
      approx_students_millions: 2.5,
    },
  },
  {
    code: "KL_SCERT",
    name: "Kerala State Board",
    fullName: "State Council of Educational Research and Training, Kerala",
    state: "Kerala",
    websiteUrl: "https://scert.kerala.gov.in",
    syllabusUrl: "https://scert.kerala.gov.in/curriculum",
    metadata: {
      type: "state",
      grading: "grade-based",
      medium: ["english", "malayalam"],
      textbooks: "SCERT Kerala",
      exam_months: ["march"],
      hse_board: "dhsekerala.gov.in",
      approx_students_millions: 4,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Phase 2 boards (seeded as inactive — ready for when scrapers are built)
// ---------------------------------------------------------------------------
const PHASE2_BOARDS = [
  {
    code: "KA_KSEAB",
    name: "Karnataka State Board",
    fullName: "Karnataka School Examination and Assessment Board",
    state: "Karnataka",
    websiteUrl: "https://kseab.karnataka.gov.in",
    metadata: { type: "state", medium: ["english", "kannada"], approx_students_millions: 8.5 },
  },
  {
    code: "TN_DGE",
    name: "Tamil Nadu State Board",
    fullName: "Directorate of Government Examinations, Tamil Nadu",
    state: "Tamil Nadu",
    websiteUrl: "https://dge.tn.gov.in",
    metadata: { type: "state", medium: ["english", "tamil"], approx_students_millions: 9 },
  },
  {
    code: "MH_MSBSHSE",
    name: "Maharashtra State Board",
    fullName: "Maharashtra State Board of Secondary and Higher Secondary Education",
    state: "Maharashtra",
    websiteUrl: "https://mahahsscboard.in",
    metadata: { type: "state", medium: ["english", "marathi"], approx_students_millions: 15 },
  },
  {
    code: "AP_BSEAP",
    name: "Andhra Pradesh State Board",
    fullName: "Board of Secondary Education, Andhra Pradesh",
    state: "Andhra Pradesh",
    websiteUrl: "https://bse.ap.gov.in",
    metadata: { type: "state", medium: ["english", "telugu"], approx_students_millions: 6 },
  },
  {
    code: "TS_BSETS",
    name: "Telangana State Board",
    fullName: "Board of Secondary Education, Telangana",
    state: "Telangana",
    websiteUrl: "https://bse.telangana.gov.in",
    metadata: {
      type: "state",
      medium: ["english", "telugu", "urdu"],
      approx_students_millions: 5,
    },
  },
];

// ---------------------------------------------------------------------------
// Subject definitions per grade range
// ---------------------------------------------------------------------------
interface SubjectDef {
  code: string;
  name: string;
  isElective: boolean;
  maxMarks: number;
}

const PRIMARY_SUBJECTS: SubjectDef[] = [
  { code: "ENG", name: "English", isElective: false, maxMarks: 100 },
  { code: "HIN", name: "Hindi", isElective: false, maxMarks: 100 },
  { code: "MATH", name: "Mathematics", isElective: false, maxMarks: 100 },
  { code: "EVS", name: "Environmental Studies", isElective: false, maxMarks: 100 },
  { code: "GK", name: "General Knowledge", isElective: true, maxMarks: 50 },
];

const UPPER_PRIMARY_SUBJECTS: SubjectDef[] = [
  { code: "ENG", name: "English", isElective: false, maxMarks: 100 },
  { code: "HIN", name: "Hindi", isElective: false, maxMarks: 100 },
  { code: "MATH", name: "Mathematics", isElective: false, maxMarks: 100 },
  { code: "SCI", name: "Science", isElective: false, maxMarks: 100 },
  { code: "SST", name: "Social Science", isElective: false, maxMarks: 100 },
  { code: "SANS", name: "Sanskrit", isElective: true, maxMarks: 100 },
  { code: "CS", name: "Computer Science", isElective: true, maxMarks: 100 },
];

const SECONDARY_SUBJECTS: SubjectDef[] = [
  { code: "ENG_CORE", name: "English (Core)", isElective: false, maxMarks: 100 },
  { code: "HIN_COURSE_A", name: "Hindi Course A", isElective: false, maxMarks: 100 },
  { code: "MATH_STD", name: "Mathematics (Standard)", isElective: false, maxMarks: 100 },
  { code: "MATH_BASIC", name: "Mathematics (Basic)", isElective: true, maxMarks: 100 },
  { code: "SCI", name: "Science", isElective: false, maxMarks: 100 },
  { code: "SST", name: "Social Science", isElective: false, maxMarks: 100 },
  { code: "CS_APP", name: "Computer Applications", isElective: true, maxMarks: 100 },
  { code: "AI", name: "Artificial Intelligence", isElective: true, maxMarks: 100 },
  { code: "IT", name: "Information Technology", isElective: true, maxMarks: 100 },
];

const SCIENCE_STREAM_SUBJECTS: SubjectDef[] = [
  { code: "ENG_CORE", name: "English (Core)", isElective: false, maxMarks: 100 },
  { code: "PHY", name: "Physics", isElective: false, maxMarks: 100 },
  { code: "CHEM", name: "Chemistry", isElective: false, maxMarks: 100 },
  { code: "MATH", name: "Mathematics", isElective: true, maxMarks: 100 },
  { code: "BIO", name: "Biology", isElective: true, maxMarks: 100 },
  { code: "CS", name: "Computer Science", isElective: true, maxMarks: 100 },
  { code: "PE", name: "Physical Education", isElective: true, maxMarks: 100 },
  { code: "ECO", name: "Economics", isElective: true, maxMarks: 100 },
  { code: "PSY", name: "Psychology", isElective: true, maxMarks: 100 },
];

const COMMERCE_STREAM_SUBJECTS: SubjectDef[] = [
  { code: "ENG_CORE", name: "English (Core)", isElective: false, maxMarks: 100 },
  { code: "ACC", name: "Accountancy", isElective: false, maxMarks: 100 },
  { code: "BST", name: "Business Studies", isElective: false, maxMarks: 100 },
  { code: "ECO", name: "Economics", isElective: false, maxMarks: 100 },
  { code: "MATH", name: "Mathematics", isElective: true, maxMarks: 100 },
  { code: "IP", name: "Informatics Practices", isElective: true, maxMarks: 100 },
  { code: "ENT", name: "Entrepreneurship", isElective: true, maxMarks: 100 },
];

const HUMANITIES_STREAM_SUBJECTS: SubjectDef[] = [
  { code: "ENG_CORE", name: "English (Core)", isElective: false, maxMarks: 100 },
  { code: "HIST", name: "History", isElective: false, maxMarks: 100 },
  { code: "POL_SCI", name: "Political Science", isElective: false, maxMarks: 100 },
  { code: "GEO", name: "Geography", isElective: true, maxMarks: 100 },
  { code: "SOC", name: "Sociology", isElective: true, maxMarks: 100 },
  { code: "PSY", name: "Psychology", isElective: true, maxMarks: 100 },
  { code: "ECO", name: "Economics", isElective: true, maxMarks: 100 },
  { code: "FA", name: "Fine Arts", isElective: true, maxMarks: 100 },
  { code: "PE", name: "Physical Education", isElective: true, maxMarks: 100 },
  { code: "MUSIC", name: "Music", isElective: true, maxMarks: 100 },
];

function getSubjectsForGrade(grade: number, stream: string | null): SubjectDef[] {
  if (grade >= 1 && grade <= 5) return PRIMARY_SUBJECTS;
  if (grade >= 6 && grade <= 8) return UPPER_PRIMARY_SUBJECTS;
  if (grade >= 9 && grade <= 10) return SECONDARY_SUBJECTS;
  if (grade >= 11 && grade <= 12) {
    if (stream === "Science") return SCIENCE_STREAM_SUBJECTS;
    if (stream === "Commerce") return COMMERCE_STREAM_SUBJECTS;
    if (stream === "Humanities") return HUMANITIES_STREAM_SUBJECTS;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------
async function seed() {
  console.log("=== Padvik Board Seed Script ===\n");

  // ---- 1. Seed Phase 1 boards (active) ----
  console.log("1. Seeding Phase 1 boards (CBSE, ICSE, Kerala SCERT)...");
  const insertedPhase1 = await db
    .insert(boards)
    .values(
      PHASE1_BOARDS.map((b) => ({
        code: b.code,
        name: b.name,
        fullName: b.fullName,
        state: b.state,
        websiteUrl: b.websiteUrl,
        syllabusUrl: b.syllabusUrl ?? null,
        isActive: true,
        metadata: b.metadata,
      }))
    )
    .onConflictDoNothing({ target: boards.code })
    .returning({ id: boards.id, code: boards.code });

  for (const b of insertedPhase1) {
    console.log(`   ✓ ${b.code} (id: ${b.id})`);
  }

  // ---- 2. Seed Phase 2 boards (inactive) ----
  console.log("\n2. Seeding Phase 2 boards (inactive, ready for future scrapers)...");
  const insertedPhase2 = await db
    .insert(boards)
    .values(
      PHASE2_BOARDS.map((b) => ({
        code: b.code,
        name: b.name,
        fullName: b.fullName,
        state: b.state,
        websiteUrl: b.websiteUrl,
        isActive: false,
        metadata: b.metadata,
      }))
    )
    .onConflictDoNothing({ target: boards.code })
    .returning({ id: boards.id, code: boards.code });

  for (const b of insertedPhase2) {
    console.log(`   ✓ ${b.code} (id: ${b.id}) [inactive]`);
  }

  // ---- 3. Get CBSE board id ----
  const [cbse] = await db.select().from(boards).where(eq(boards.code, "CBSE")).limit(1);
  if (!cbse) {
    console.error("ERROR: CBSE board not found after insert!");
    process.exit(1);
  }
  console.log(`\n3. CBSE board id: ${cbse.id}`);

  // ---- 4. Seed standards (Classes 1-12) for CBSE ----
  console.log("\n4. Seeding CBSE standards (Classes 1-12)...");

  type StandardRow = { id: number; grade: number; stream: string | null };
  const allStandards: StandardRow[] = [];

  // Classes 1-10: no stream
  for (let grade = 1; grade <= 10; grade++) {
    const [row] = await db
      .insert(standards)
      .values({
        boardId: cbse.id,
        grade,
        stream: null,
        academicYear: ACADEMIC_YEAR,
      })
      .onConflictDoNothing()
      .returning({ id: standards.id, grade: standards.grade, stream: standards.stream });

    if (row) {
      allStandards.push(row);
      console.log(`   ✓ Class ${grade} (id: ${row.id})`);
    }
  }

  // Classes 11-12: Science, Commerce, Humanities
  const STREAMS = ["Science", "Commerce", "Humanities"];
  for (let grade = 11; grade <= 12; grade++) {
    for (const stream of STREAMS) {
      const [row] = await db
        .insert(standards)
        .values({
          boardId: cbse.id,
          grade,
          stream,
          academicYear: ACADEMIC_YEAR,
        })
        .onConflictDoNothing()
        .returning({ id: standards.id, grade: standards.grade, stream: standards.stream });

      if (row) {
        allStandards.push(row);
        console.log(`   ✓ Class ${grade} — ${stream} (id: ${row.id})`);
      }
    }
  }

  console.log(`   Total standards: ${allStandards.length}`);

  // ---- 5. Seed subjects for each standard ----
  console.log("\n5. Seeding subjects for each CBSE standard...");
  let totalSubjects = 0;

  for (const std of allStandards) {
    const subjectDefs = getSubjectsForGrade(std.grade, std.stream);
    if (subjectDefs.length === 0) continue;

    const inserted = await db
      .insert(subjects)
      .values(
        subjectDefs.map((s) => ({
          standardId: std.id,
          code: s.code,
          name: s.name,
          isElective: s.isElective,
          maxMarks: s.maxMarks,
          subjectType: "theory" as const,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: subjects.id });

    const label = std.stream ? `Class ${std.grade} (${std.stream})` : `Class ${std.grade}`;
    console.log(`   ✓ ${label}: ${inserted.length} subjects`);
    totalSubjects += inserted.length;
  }

  console.log(`   Total subjects: ${totalSubjects}`);

  // ---- Summary ----
  console.log("\n=== Seed Complete ===");
  console.log(`   Boards:    ${insertedPhase1.length + insertedPhase2.length}`);
  console.log(`   Standards: ${allStandards.length}`);
  console.log(`   Subjects:  ${totalSubjects}`);
}

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
