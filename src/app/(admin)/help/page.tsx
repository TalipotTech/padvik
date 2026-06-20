/**
 * /help — Admin help & guides index.
 */
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { helpNav } from "../_nav";

export const metadata = { title: "Help & Guides — Padvik Admin" };

export default function HelpHomePage() {
  // Everything except the "Help Home" entry itself
  const guides = helpNav.filter((g) => g.href !== "/help");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-violet-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Help &amp; Guides</h1>
          <p className="text-sm text-muted-foreground">
            How the Padvik admin tools work. Reachable any time from the{" "}
            <span className="font-medium">Help</span> menu in the header.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {guides.map((g) => (
          <Link key={g.href} href={g.href} className="group">
            <Card className="h-full transition-colors hover:border-violet-500/60">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {g.label}
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-violet-600" />
                </CardTitle>
                {g.description && <CardDescription>{g.description}</CardDescription>}
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
