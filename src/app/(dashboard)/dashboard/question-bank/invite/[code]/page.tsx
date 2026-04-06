"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle, AlertCircle, Loader2, Share2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";

interface InviteDetails {
  questionCount: number;
  permission: string;
  expiresAt: string | null;
  usesRemaining: number | null;
}

export default function InviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptResult, setAcceptResult] = useState<{ questionsShared: number } | null>(null);

  useEffect(() => {
    async function fetchInvite() {
      try {
        const data = await apiFetch<InviteDetails>(
          `/api/questions/share/invite/${code}`
        );
        setInvite(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid or expired invite");
      } finally {
        setLoading(false);
      }
    }
    fetchInvite();
  }, [code]);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const result = await apiFetch<{ questionsShared: number; permission: string }>(
        `/api/questions/share/invite/${code}`,
        { method: "POST" }
      );
      setAccepted(true);
      setAcceptResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <div>
              <h2 className="text-lg font-semibold">Invite Not Available</h2>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
            </div>
            <Button variant="outline" onClick={() => router.push("/dashboard/question-bank")}>
              Go to Question Bank
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accepted && acceptResult) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <CheckCircle className="h-12 w-12 mx-auto text-green-600" />
            <div>
              <h2 className="text-lg font-semibold">Questions Added!</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {acceptResult.questionsShared} question{acceptResult.questionsShared !== 1 ? "s" : ""} have been
                shared with you.
              </p>
            </div>
            <Button onClick={() => router.push("/dashboard/question-bank?tab=shared")}>
              View Shared Questions
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-8 text-center space-y-5">
          <Share2 className="h-12 w-12 mx-auto text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Question Share Invite</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Someone has shared questions with you.
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Badge variant="secondary" className="text-sm">
              {invite?.questionCount} question{invite?.questionCount !== 1 ? "s" : ""}
            </Badge>
            <Badge variant="outline" className="text-sm">
              {invite?.permission === "copy" ? "View & Copy" : "View only"}
            </Badge>
          </div>

          {invite?.expiresAt && (
            <p className="text-xs text-muted-foreground">
              Expires: {new Date(invite.expiresAt).toLocaleDateString()}
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => router.push("/dashboard/question-bank")}>
              Cancel
            </Button>
            <Button onClick={handleAccept} disabled={accepting}>
              {accepting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Accepting...
                </>
              ) : (
                "Accept & View Questions"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
