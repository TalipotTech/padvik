import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "Exams | Padvik",
};

export default function ExamsPage() {
  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Exams</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Take practice exams and mock tests
        </p>
      </div>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">Coming soon</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            The exam engine is under development. You&apos;ll be able to create custom exams, take timed tests, and review detailed results.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
