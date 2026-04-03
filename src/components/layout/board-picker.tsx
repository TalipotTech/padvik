"use client";

import { useState } from "react";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { useData } from "@/hooks/use-data";
import { getBoards, getStandards } from "@/lib/data";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface BoardPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BoardPicker({ open, onOpenChange }: BoardPickerProps) {
  const { setSelection } = useBoardSelection();
  const { data: boards, loading: boardsLoading } = useData(() => getBoards(), []);

  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);

  const selectedBoard = boards?.find((b) => b.id === selectedBoardId) ?? null;
  const { data: standards } = useData(
    () => selectedBoardId ? getStandards(selectedBoardId) : Promise.resolve([]),
    [selectedBoardId],
  );

  function handleBoardSelect(boardId: number) {
    setSelectedBoardId(boardId);
    setSelectedGrade(null);
  }

  function handleConfirm() {
    if (!selectedBoard || !selectedGrade) return;
    setSelection({
      boardId: selectedBoard.id,
      boardName: selectedBoard.code,
      grade: selectedGrade,
      stream: null,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select your board & class</DialogTitle>
          <DialogDescription>
            Choose your education board and class to see relevant content.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Board selection */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Board</p>
          {boardsLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-2">
            {(boards ?? []).map((board) => (
              <button
                key={board.id}
                onClick={() => handleBoardSelect(board.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors min-h-11",
                  selectedBoardId === board.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-accent",
                )}
              >
                <span className="flex-1">
                  <span className="font-medium block">{board.code}</span>
                  <span className="text-xs text-muted-foreground">{board.name}</span>
                </span>
                {selectedBoardId === board.id && (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
          )}
        </div>

        {/* Step 2: Class selection */}
        {(standards ?? []).length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Class</p>
            <div className="flex flex-wrap gap-2">
              {(standards ?? []).map((std) => (
                <Badge
                  key={std.id}
                  variant={selectedGrade === std.grade ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 text-sm min-h-9",
                    selectedGrade === std.grade
                      ? ""
                      : "hover:bg-accent",
                  )}
                  onClick={() => setSelectedGrade(std.grade)}
                >
                  Class {std.grade}{std.stream ? ` (${std.stream})` : ""}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Confirm */}
        <div className="flex justify-end pt-2">
          <Button
            onClick={handleConfirm}
            disabled={!selectedBoardId || !selectedGrade}
          >
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
