"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Send, CheckCircle } from "lucide-react";
import { toast } from "sonner";

interface Response {
  id: number;
  responderId: number;
  responderName: string;
  responderAvatar: string | null;
  responseText: string;
  responseType: string;
  isAi: boolean;
  createdAt: string;
}

interface DoubtDetail {
  id: number;
  studentId: number;
  studentName: string;
  studentAvatar: string | null;
  questionText: string;
  questionImages: string[];
  status: string;
  upvoteCount: number;
  createdAt: string;
  responses: Response[];
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive",
  answered: "default",
  closed: "secondary",
};

export default function DoubtThreadPage() {
  const params = useParams();
  const [doubt, setDoubt] = useState<DoubtDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchDoubt();
  }, [params.id]);

  async function fetchDoubt() {
    const res = await fetch(`/api/doubts/${params.id}`);
    const data = await res.json();
    if (data.success) setDoubt(data.data);
    setLoading(false);
  }

  async function handleRespond(e: React.FormEvent) {
    e.preventDefault();
    if (!responseText.trim()) return;

    setSubmitting(true);
    const res = await fetch(`/api/doubts/${params.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responseText }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (data.success) {
      toast.success("Response posted");
      setResponseText("");
      fetchDoubt();
    } else {
      toast.error(data.error?.message || "Failed to post response");
    }
  }

  async function acceptAnswer(responseId: number) {
    const res = await fetch(`/api/doubts/${params.id}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responseId }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success("Answer accepted! Doubt closed.");
      fetchDoubt();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!doubt) {
    return <p className="text-muted-foreground py-10 text-center">Doubt not found.</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Question */}
      <Card>
        <CardContent className="py-6">
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src={doubt.studentAvatar || undefined} />
              <AvatarFallback>{doubt.studentName?.charAt(0) || "S"}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium">{doubt.studentName}</span>
                <Badge variant={STATUS_COLORS[doubt.status] || "outline"} className="text-xs">
                  {doubt.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(doubt.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{doubt.questionText}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Responses */}
      {doubt.responses.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            {doubt.responses.length} Response{doubt.responses.length !== 1 ? "s" : ""}
          </h3>
          {doubt.responses.map((resp) => (
            <Card key={resp.id}>
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={resp.responderAvatar || undefined} />
                    <AvatarFallback className="text-xs">
                      {resp.isAi ? "AI" : resp.responderName?.charAt(0) || "R"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">
                        {resp.isAi ? "AI Assistant" : resp.responderName}
                      </span>
                      {resp.isAi && <Badge variant="secondary" className="text-xs">AI</Badge>}
                      <span className="text-xs text-muted-foreground">
                        {new Date(resp.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{resp.responseText}</p>
                  </div>
                  {doubt.status !== "closed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 gap-1 text-xs"
                      onClick={() => acceptAnswer(resp.id)}
                    >
                      <CheckCircle className="h-3 w-3" />
                      Accept
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Response form */}
      {doubt.status !== "closed" && (
        <form onSubmit={handleRespond}>
          <Card>
            <CardContent className="py-4 space-y-3">
              <textarea
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder="Write your response..."
              />
              <Button type="submit" disabled={submitting || !responseText.trim()} className="gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Post Response
              </Button>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}
