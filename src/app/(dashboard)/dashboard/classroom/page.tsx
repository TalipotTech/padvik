import { Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "Classroom | Padvik",
};

export default function ClassroomPage() {
  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Classroom</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Join classrooms and collaborate with teachers
        </p>
      </div>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Users className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">Coming soon</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Classroom features are under development. Teachers will be able to assign exams, share content, and track student progress.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
