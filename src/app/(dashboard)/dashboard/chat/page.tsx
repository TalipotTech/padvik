import { MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "AI Chat | Padvik",
};

export default function ChatPage() {
  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-bold text-foreground">AI Chat</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask questions and get instant help from AI
        </p>
      </div>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">Coming soon</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            The AI chat agent is being built. You&apos;ll be able to ask doubts, upload images for solving, and get contextual explanations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
