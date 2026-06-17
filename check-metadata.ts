import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { db } from "./src/db";
import { subjects, standards, boards } from "./src/db/schema/curriculum";
import { eq, and, sql } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      id: subjects.id,
      name: subjects.name,
      code: subjects.code,
      metadata: subjects.metadata,
      academicYear: standards.academicYear,
      grade: standards.grade,
      boardCode: boards.code,
    })
    .from(subjects)
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .innerJoin(boards, eq(standards.boardId, boards.id))
    .where(
      and(
        eq(boards.code, "CBSE"),
        eq(standards.grade, 10),
        sql`lower(${subjects.name}) LIKE '%math%'`
      )
    );
  for (const r of rows) {
    console.log(`subj ${r.id} [${r.academicYear}] ${r.name} (${r.code})`);
    console.log(`  metadata:`, JSON.stringify(r.metadata, null, 2));
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
