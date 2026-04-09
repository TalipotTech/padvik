import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { eq } from "drizzle-orm";

export default async function CreatorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Check DB directly — the JWT may be stale after creator registration
  const userId = Number(session.user.id);
  let isCreator = (session.user as { isCreator?: boolean }).isCreator ?? false;

  if (!isCreator && userId) {
    const [dbUser] = await db
      .select({ isCreator: users.isCreator })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    isCreator = dbUser?.isCreator ?? false;
  }

  if (!isCreator) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-10 w-10 text-primary" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Become a Creator</h2>
          <p className="text-muted-foreground max-w-md">
            Share your knowledge with students across India. Upload video lessons,
            notes, question sets, and more — all mapped to the curriculum.
          </p>
        </div>
        <Link href="/dashboard/creator-register">
          <Button size="lg" className="gap-2">
            <Sparkles className="h-4 w-4" />
            Register as Creator
          </Button>
        </Link>
        <p className="text-sm text-muted-foreground">
          or <Link href="/creators" className="text-primary hover:underline">learn more about the Creator program</Link>
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
