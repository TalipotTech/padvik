import { auth } from "@/lib/auth";
import { SyllabusExplorer } from "./_components/syllabus-explorer";

export const metadata = {
  title: "Curriculum | Padvik",
};

const DEV_BYPASS = process.env.NODE_ENV === "development" && process.env.SKIP_AUTH === "true";

export default async function SyllabusPage() {
  const session = await auth().catch(() => null);
  const role = (session?.user as { role?: string } | undefined)?.role ?? (DEV_BYPASS ? "admin" : "student");

  return <SyllabusExplorer userRole={role} />;
}
