import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "Analytics | Padvik",
};

export default function AnalyticsPage() {
  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track your learning progress and performance
        </p>
      </div>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">Coming soon</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Performance analytics are under development. You&apos;ll see subject mastery, exam trends, and AI-generated study recommendations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
